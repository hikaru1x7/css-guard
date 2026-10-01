import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';

export const svgStyleProperties = ['fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'vector-effect', 'paint-order', 'clip-path', 'mask', 'filter', 'font-weight', 'font-style', 'letter-spacing', 'text-anchor', 'dominant-baseline'];

export async function svgElementScreenshot(page, selector, file) {
  const clip = await page.locator(selector).evaluate((node) => {
    const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
    const matrix = node.getScreenCTM?.();
    const scale = style.getPropertyValue('vector-effect') === 'non-scaling-stroke' ? 1 : matrix ? Math.max(Math.hypot(matrix.a, matrix.b), Math.hypot(matrix.c, matrix.d)) : 1;
    const stroke = style.getPropertyValue('stroke') === 'none' ? 0 : (parseFloat(style.getPropertyValue('stroke-width')) || 0) * scale;
    const padding = Math.ceil(stroke / 2) + 2;
    const x = Math.max(0, Math.floor(rect.left + scrollX - padding)), y = Math.max(0, Math.floor(rect.top + scrollY - padding));
    return { x, y, width: Math.max(1, Math.ceil(rect.right + scrollX + padding) - x), height: Math.max(1, Math.ceil(rect.bottom + scrollY + padding) - y), scale: 1 };
  });
  const cdp = await page.context().newCDPSession(page);
  try {
    const result = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: true, clip });
    await fs.writeFile(file, Buffer.from(result.data, 'base64'));
  } finally { await cdp.detach(); }
}

export async function comparisonPixels(page, comparison, file) {
  await svgElementScreenshot(page, comparison.selector, file);
  const image = PNG.sync.read(await fs.readFile(file));
  return createHash('sha256').update(`${image.width}x${image.height}:`).update(image.data).digest('hex');
}

export function svgChanges(before, after, prefix = 'target.svg') {
  const changes = [];
  function visit(left, right, name) {
    if (left && right && typeof left === 'object' && typeof right === 'object') {
      for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) visit(left[key], right[key], `${name}.${key}`);
    } else if (JSON.stringify(left) !== JSON.stringify(right)) changes.push({ path: name, before: left, after: right });
  }
  visit(before, after, prefix);
  return changes;
}

export function validateSvgComparison(previous, current) {
  if (!previous) return;
  if (JSON.stringify(previous.svgConditions) !== JSON.stringify(current.svgConditions)) throw new Error('SVG comparison conditions changed. Keep URL, target, comparison targets, viewport widths, actions and measurement version fixed.');
  for (const entry of current.widths) {
    const old = previous.widths.find((item) => item.width === entry.width);
    if (!old) throw new Error('SVG baseline viewport is missing.');
    if (svgChanges(old.comparisons, entry.comparisons).length) throw new Error('SVG comparison target changed outside the requested target. Inspect the before/after images and restore the unintended change.');
  }
}
