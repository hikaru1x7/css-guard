import fs from 'node:fs/promises';
import path from 'node:path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { ensureProject, updateState } from './state.mjs';
import { preparePage, settle, withBrowser, renderedScreenshot } from './browser.mjs';

const slug = (route) => (route === '/' ? 'root' : route.replace(/^\/+|\/+$/g, '').replace(/[^a-zA-Z0-9_-]+/g, '-')) || 'root';

async function image(file) {
  // PNG ファイルを画素比較用に読み込む。
  return PNG.sync.read(await fs.readFile(file));
}

function croppedData(png, width, height) {
  // サイズが異なる画像を共通の左上領域へ切り詰める。
  if (png.width === width && png.height === height) {
    return png.data;
  }

  const data = Buffer.alloc(width * height * 4);

  for (let y = 0; y < height; y++) {
    png.data.copy(data, y * width * 4, y * png.width * 4, y * png.width * 4 + width * 4);
  }

  return data;
}

async function compare(baseline, latest, diffFile) {
  // 基準と今回の PNG を比較し、差分画像も保存する。
  const old = await image(baseline);
  const fresh = await image(latest);
  const width = Math.min(old.width, fresh.width);
  const height = Math.min(old.height, fresh.height);
  const out = new PNG({ width, height });
  const changed = pixelmatch(croppedData(old, width, height), croppedData(fresh, width, height), out.data, width, height, { threshold: 0.1 });
  await fs.mkdir(path.dirname(diffFile), { recursive: true });
  await fs.writeFile(diffFile, PNG.sync.write(out));

  return {
    changedPixels: changed,
    percent: Number(((changed / (width * height)) * 100).toFixed(4)),
    ...(old.width !== fresh.width || old.height !== fresh.height ? { sizeChange: `${old.width}x${old.height} → ${fresh.width}x${fresh.height}` } : {}),
    diff: diffFile
  };
}

export async function snap({ config, routes = config.routes, widths = config.widths, baseUrl, baseline = false }) {
  // 全 route と幅の画面画像を作り、基準との差分を保存する。
  if (!routes?.length) {
    throw new Error('snap requires routes in css-guard.json or --routes');
  }

  const dir = await ensureProject(config.root);
  const root = path.join(dir, 'snap');
  const result = { at: new Date().toISOString(), entries: [] };
  await Promise.all(['baseline', 'latest', 'diff'].map((name) => fs.mkdir(path.join(root, name), { recursive: true })));

  await withBrowser(async (browser) => {
    for (const route of routes) {
      for (const width of widths) {
        const name = `${slug(route)}-${width}.png`;
        const base = path.join(root, 'baseline', name);
        const latest = path.join(root, 'latest', name);
        const page = await preparePage(browser, width, config);

        try {
          await settle(page, new URL(route, baseUrl).href);
          await renderedScreenshot(page, latest, config);
          let entry = { route, width, latest };

          try {
            await fs.access(base);

            if (baseline) {
              await fs.copyFile(latest, base);
              entry = { ...entry, baseline: base, reset: true };
            } else {
              entry = {
                ...entry,
                baseline: base,
                ...(await compare(base, latest, path.join(root, 'diff', name)))
              };
            }
          } catch {
            await fs.copyFile(latest, base);
            entry = { ...entry, baseline: base, createdBaseline: true };
          }

          if (entry.changedPixels !== undefined) {
            entry.overThreshold = entry.changedPixels > config.snapThresholdPx;
          }

          result.entries.push(entry);
        } finally {
          await page.close();
        }
      }
    }
  });

  await updateState(config.root, (state) => ({ ...state, lastSnapCheckAt: result.at }));
  return result;
}
