// Chromium under gVisor: Playwright's headless shell, no Chromium sandbox (gVisor is the sandbox,
// and the container has no capabilities for Chromium's own), /tmp instead of a small /dev/shm.
const { chromium } = require('playwright-core');
exports.scrape = async (url) => {
  const t0 = Date.now();
  const browser = await chromium.launch({ headless: true, chromiumSandbox: false, args: ['--disable-dev-shm-usage'] });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    return { url, title: await page.title(), h1: await page.locator('h1').first().textContent().catch(() => null), ms: Date.now() - t0, chromium: browser.version() };
  } finally {
    await browser.close();
  }
};
