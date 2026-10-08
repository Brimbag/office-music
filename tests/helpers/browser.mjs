import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

export async function startBrowserHarness() {
  const server = createServer(async (request, response) => {
    const path = new URL(request.url, 'http://local').pathname;
    const file = (/^\/[A-Za-z0-9_-]+\.js$/.test(path) ? path.slice(1) : null) || ({ '/': 'index.html', '/index.html': 'index.html', '/taste': 'taste.html', '/taste.html': 'taste.html' })[path];
    if (!file) { response.writeHead(404).end(); return; }
    try {
      const html = await readFile(new URL(`../../${file}`, import.meta.url));
      response.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8' }).end(html);
    } catch { response.writeHead(500).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
      (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
    browser = await chromium.launch({ executablePath, headless: true });
  } catch (error) { await new Promise(resolve => server.close(resolve)); throw error; }
  const baseURL = `http://127.0.0.1:${server.address().port}`;
  return {
    async page(path = '/', storage = {}) {
      const context = await browser.newContext();
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        return url.origin === baseURL ? route.continue() : route.abort();
      });
      await context.addInitScript(initial => {
        // Initialize once per context, preserving mutations through reloads.
        if (!sessionStorage.getItem('test_initialized')) {
          for (const [key, value] of Object.entries(initial)) localStorage.setItem(key, value);
          sessionStorage.setItem('test_initialized', '1');
        }
      }, storage);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${baseURL}${path}`);
      return { page, errors, close: () => context.close() };
    },
    async close() {
      try { await browser.close(); } finally { await new Promise(resolve => server.close(resolve)); }
    }
  };
}
