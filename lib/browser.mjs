import fs from 'node:fs/promises';
import fssync from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

export async function serveStatic(root) {
  // 指定ディレクトリを一時 HTTP サーバとして配信する。
  const base = path.resolve(root);
  const server = http.createServer((req, res) => {
    let raw;

    try {
      raw = decodeURIComponent(new URL(req.url, 'http://local').pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }

    if (raw === '/') {
      raw = '/index.html';
    }

    const target = path.resolve(base, `.${raw}`);

    if (!target.startsWith(`${base}${path.sep}`) && target !== base) {
      res.writeHead(403).end('forbidden');
      return;
    }

    fssync.readFile(target, (error, body) => {
      if (error) {
        res.writeHead(error.code === 'ENOENT' ? 404 : 500).end('not found');
        return;
      }

      res.writeHead(200, {
        'content-type': mime[path.extname(target).toLowerCase()] || 'application/octet-stream'
      });
      res.end(body);
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

export async function withBrowser(fn) {
  // Chromium の起動と終了を呼び出し元へ隠す。
  const browser = await chromium.launch({ headless: true });

  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}

export function heightFor(width, config) {
  // 画面幅と設定から viewport の高さを決める。
  return config.heights?.[String(width)] || config.heights?.[width] || (width < 600 ? 800 : 900);
}

export async function preparePage(browser, width, config) {
  // 数値比較に使う scale 1 のページを作る。
  return browser.newPage({
    viewport: { width, height: heightFor(width, config) },
    deviceScaleFactor: 1
  });
}

export async function settle(page, url) {
  // 通常は通信待ちまで待ち、終わらない画面は表示後に続行する。
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
    await page.evaluate(() => document.fonts?.ready);
    return true;
  } catch (error) {
    if (!/Timeout/i.test(error.message)) {
      throw error;
    }

    await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1000);
    return false;
  }
}

export async function runActions(page, actions, baseUrl) {
  // 許可された画面操作を指定順に実行する。
  if (!actions) {
    return;
  }

  for (const action of actions.split(';').filter(Boolean)) {
    if (action.startsWith('click:')) {
      await page.click(action.slice(6));
    } else if (action.startsWith('hover:')) {
      await page.hover(action.slice(6));
    } else if (action.startsWith('wait:')) {
      await page.waitForTimeout(Number(action.slice(5)));
    } else if (action.startsWith('fill:')) {
      const index = action.indexOf('=', 5);

      if (index < 0) {
        throw new Error(`Invalid fill action: ${action}`);
      }

      await page.fill(action.slice(5, index), action.slice(index + 1));
    } else if (action.startsWith('goto:')) {
      await settle(page, new URL(action.slice(5), baseUrl).href);
    } else {
      throw new Error(`Unsupported action: ${action}`);
    }
  }
}

export async function pathExists(file) {
  // ファイルまたはディレクトリの有無を返す。
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}
