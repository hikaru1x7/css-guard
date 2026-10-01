import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureProject, readState, updateState } from './state.mjs';
import { preparePage, runActions, settle, withBrowser } from './browser.mjs';

export const styleProperties = ['display', 'position', 'box-sizing', 'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width', 'top', 'right', 'bottom', 'left', 'transform', 'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis', 'align-items', 'align-self', 'justify-content', 'gap', 'row-gap', 'column-gap', 'grid-template-columns', 'grid-template-rows', 'grid-column', 'grid-row', 'overflow-x', 'overflow-y', 'font-family', 'font-size', 'line-height', 'text-align', 'white-space', 'z-index', 'opacity', 'visibility', 'color', 'background-color'];

const inheritedProperties = new Set(['font-family', 'font-size', 'line-height', 'color', 'text-align', 'white-space', 'visibility']);
const primaryStyles = ['display', 'width', 'height', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'gap', 'flex-direction', 'grid-template-columns'];
const safeTime = () => new Date().toISOString().replace(/[:.]/g, '-');

function sourceFor(header, property, rule) {
  // CDP のスタイルシート情報を人が追える出所と行番号にする。
  const origin = header?.origin || rule?.origin;
  const sourceName = header?.sourceURL || (origin === 'user-agent' ? 'user agent' : 'inline <style>');

  if (sourceName === 'user agent') {
    return sourceName;
  }

  const localLine = property.range?.startLine ?? rule?.style?.range?.startLine ?? 0;
  const line = (header?.startLine ?? 0) + localLine + 1;
  return `${sourceName}:${line}`;
}

function propertyTargets(property) {
  // ショートハンドを含む宣言が影響する長いプロパティを列挙する。
  const shorthand = {
    margin: ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
    padding: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left']
  };
  const names = [property.name, ...(property.longhandProperties || []).map((longhand) => longhand.name), ...(shorthand[property.name] || [])];
  return [...new Set(names.filter((name) => styleProperties.includes(name)))];
}

function declaredValue(declaration, shorthandEntries = []) {
  // CDP が展開した長いプロパティにも元のショートハンド値を戻す。
  const shorthand = declaration.name.startsWith('margin-') ? 'margin' : declaration.name.startsWith('padding-') ? 'padding' : null;
  const entry = shorthandEntries.find((item) => item.name === shorthand);
  const value = entry?.value || declaration.value || declaration.text?.replace(/^[^:]+:\s*/, '') || '';
  return value.replace(/\s*!\s*important\s*;?$/i, '').trim();
}

function chooseCandidate(best, candidate, inline = false) {
  // !important を優先し、通常宣言では inline style を最優先にする。
  const slot = candidate.important ? 'important' : 'normal';

  if (!best[slot] || inline) {
    best[slot] = candidate;
  }
}

function candidatesFromRules(rules, headers, inheritedFrom) {
  // 優先度が低い順の CDP 規則を逆順に走査して宣言候補を選ぶ。
  const found = new Map();

  for (const item of [...(rules || [])].reverse()) {
    const rule = item.rule || item;
    const selector = rule.selectorList?.text || 'style attribute';
    const header = headers.get(rule.styleSheetId || rule.style?.styleSheetId);
    const properties = rule.style?.cssProperties || [];
    const shorthandEntries = rule.style?.shorthandEntries || [];

    for (const declaration of [...properties].reverse()) {
      if (declaration.disabled) {
        continue;
      }

      for (const property of propertyTargets(declaration)) {
        const best = found.get(property) || {};
        chooseCandidate(best, {
          property,
          declared: declaredValue(declaration, shorthandEntries),
          selector,
          source: sourceFor(header, declaration, rule),
          important: Boolean(declaration.important),
          ...(inheritedFrom ? { inheritedFrom } : {})
        });
        found.set(property, best);
      }
    }
  }

  return found;
}

function candidatesFromInline(style) {
  // style 属性を通常宣言の最優先候補として読む。
  const found = new Map();

  const shorthandEntries = style?.shorthandEntries || [];

  for (const declaration of [...(style?.cssProperties || [])].reverse()) {
    if (declaration.disabled) {
      continue;
    }

    for (const property of propertyTargets(declaration)) {
      const best = found.get(property) || {};
      chooseCandidate(best, {
        property,
        declared: declaredValue(declaration, shorthandEntries),
        selector: 'style attribute',
        source: 'inline style',
        important: Boolean(declaration.important)
      }, true);
      found.set(property, best);
    }
  }

  return found;
}

function selectedCandidates(ruleCandidates, inlineCandidates) {
  // 規則候補と style 属性候補から最終宣言を一つ選ぶ。
  const selected = new Map();

  for (const property of styleProperties) {
    const rule = ruleCandidates.get(property) || {};
    const inline = inlineCandidates.get(property) || {};
    const candidate = inline.important || rule.important || inline.normal || rule.normal;

    if (candidate) {
      selected.set(property, candidate);
    }
  }

  return selected;
}

async function cascadeFor(page, selector) {
  // CDP の適用規則から計算後スタイルの原因候補を求める。
  const cdp = await page.context().newCDPSession(page);
  const headers = new Map();
  cdp.on('CSS.styleSheetAdded', ({ header }) => headers.set(header.styleSheetId, header));

  try {
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const document = await cdp.send('DOM.getDocument');
    const query = await cdp.send('DOM.querySelector', { nodeId: document.root.nodeId, selector });

    if (!query.nodeId) {
      return [];
    }

    const matched = await cdp.send('CSS.getMatchedStylesForNode', { nodeId: query.nodeId });
    const computed = new Map((await cdp.send('CSS.getComputedStyleForNode', { nodeId: query.nodeId })).computedStyle.map(({ name, value }) => [name, value]));
    const direct = selectedCandidates(candidatesFromRules(matched.matchedCSSRules, headers), candidatesFromInline(matched.inlineStyle));
    const inherited = new Map();

    for (const ancestor of matched.inherited || []) {
      const inheritedRules = candidatesFromRules(ancestor.matchedCSSRules, headers);
      const inheritedInline = candidatesFromInline(ancestor.inlineStyle);
      const selected = selectedCandidates(inheritedRules, inheritedInline);

      for (const property of inheritedProperties) {
        if (!inherited.has(property) && selected.has(property)) {
          const candidate = selected.get(property);
          inherited.set(property, { ...candidate, inheritedFrom: candidate.selector });
        }
      }
    }

    const cascade = [];

    for (const property of styleProperties) {
      const candidate = direct.get(property) || (inheritedProperties.has(property) ? inherited.get(property) : null);

      if (candidate) {
        cascade.push({ ...candidate, computed: computed.get(property) || '' });
      }
    }

    return cascade;
  } finally {
    await cdp.detach();
  }
}

function recordChange(changes, width, path, before, after) {
  // 値が変わった項目だけを差分結果へ追加する。
  if (before !== after) {
    changes.push({ width, path, before, after });
  }
}

function compare(previous, current) {
  // 同じ対象・画面幅の計測結果から位置と主要スタイルの差分を作る。
  if (!previous?.widths) {
    return undefined;
  }

  const changes = [];

  for (const entry of current.widths) {
    const before = previous.widths.find((item) => item.width === entry.width);

    if (!before) {
      continue;
    }

    for (const property of styleProperties) {
      recordChange(changes, entry.width, `target.styles.${property}`, before.target?.styles?.[property], entry.target?.styles?.[property]);
    }

    for (const property of ['x', 'y', 'width', 'height']) {
      recordChange(changes, entry.width, `target.rect.${property}`, before.target?.rect?.[property], entry.target?.rect?.[property]);
    }

    for (const parent of entry.parents || []) {
      const oldParent = before.parents?.find((item) => item.depth === parent.depth);

      for (const property of ['x', 'y', 'width', 'height']) {
        recordChange(changes, entry.width, `parents.${parent.depth}.rect.${property}`, oldParent?.rect?.[property], parent.rect?.[property]);
      }

      for (const property of primaryStyles) {
        recordChange(changes, entry.width, `parents.${parent.depth}.styles.${property}`, oldParent?.styles?.[property], parent.styles?.[property]);
      }
    }
  }

  return { at: previous.at, label: previous.label, changes };
}

export async function measure({ config, url, selector, widths = config.widths, parents = 2, actions, label, baseUrl, comparisonKey = url }) {
  // 画面幅ごとに対象・親・カスケード・画像を実測して保存する。
  const dir = await ensureProject(config.root);
  const at = new Date().toISOString();
  const stamp = safeTime();
  const shots = path.join(dir, 'shots');
  await fs.mkdir(shots, { recursive: true });

  const result = {
    at,
    url,
    selector,
    ...(label ? { label } : {}),
    widths: []
  };

  await withBrowser(async (browser) => {
    for (const width of widths) {
      const page = await preparePage(browser, width, config);

      try {
        const settled = await settle(page, url);
        await runActions(page, actions, baseUrl);
        const data = await page.evaluate(({ selected, count, properties }) => {
          const describe = (node, depth = 0) => {
            const rect = node.getBoundingClientRect();
            const css = getComputedStyle(node);
            const styles = Object.fromEntries(properties.map((name) => [name, css.getPropertyValue(name)]));
            return {
              depth,
              tag: node.tagName.toLowerCase(),
              id: node.id,
              class: typeof node.className === 'string' ? node.className : '',
              rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
              styles
            };
          };
          const nodes = [...document.querySelectorAll(selected)];

          if (!nodes.length) {
            return { matched: 0 };
          }

          const target = nodes[0];
          const targetData = describe(target);
          targetData.visible = typeof target.checkVisibility === 'function'
            ? target.checkVisibility({ visibilityProperty: true })
            : targetData.styles.display !== 'none' && !['hidden', 'collapse'].includes(targetData.styles.visibility) && target.getClientRects().length > 0;
          delete targetData.depth;
          const parentList = [];
          let parent = target.parentElement;

          for (let depth = 1; parent && depth <= count; depth++, parent = parent.parentElement) {
            parentList.push(describe(parent, depth));
          }

          return { matched: nodes.length, target: targetData, parents: parentList };
        }, { selected: selector, count: parents, properties: styleProperties });

        if (!data.matched) {
          throw new Error('No element matches the selector');
        }

        const screenshot = path.join(shots, `${stamp}-${width}.png`);
        const elementShot = data.target.visible ? path.join(shots, `${stamp}-${width}-el.png`) : null;
        await page.screenshot({ path: screenshot, fullPage: true });

        if (elementShot) {
          await page.locator(selector).first().screenshot({ path: elementShot });
        }

        result.widths.push({
          width,
          height: await page.evaluate(() => innerHeight),
          settled,
          target: { matched: data.matched, ...data.target },
          parents: data.parents,
          cascade: await cascadeFor(page, selector),
          screenshot,
          elementShot
        });
      } finally {
        await page.close();
      }
    }
  });

  const state = await readState(config.root);
  let previous;

  if ((state.lastMeasure?.comparisonKey || state.lastMeasure?.url) === comparisonKey && state.lastMeasure?.selector === selector && state.lastMeasure.path) {
    try {
      previous = JSON.parse(await fs.readFile(state.lastMeasure.path, 'utf8'));
    } catch {
      // begin 後に前回の結果が消えている場合は差分なしにする。
    }
  }

  const comparison = compare(previous, result);

  if (comparison) {
    result.previous = comparison;
  }

  const output = path.join(dir, 'measures', `${stamp}.json`);
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
  await updateState(config.root, (current) => ({
    ...current,
    lastMeasureAt: at,
    lastMeasure: { url, comparisonKey, selector, widths, actions: actions || '', path: output },
    pendingMeasure: current.pendingMeasure && !(
      (current.pendingMeasure.comparisonKey || current.pendingMeasure.url) === comparisonKey &&
      current.pendingMeasure.selector === selector &&
      (current.pendingMeasure.actions || '') === (actions || '') &&
      current.pendingMeasure.widths.every((width) => widths.includes(width)) &&
      Date.parse(at) >= Date.parse(current.lastCssEditAt)
    ) ? current.pendingMeasure : null
  }));
  return result;
}
