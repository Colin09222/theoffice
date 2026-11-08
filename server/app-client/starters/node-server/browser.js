// Only for pages office.scrape can't read: needs "tier": "browser" in office.json and "playwright-core": "1.65.0" in package.json.
// Chromium under gVisor: Playwright's headless shell, no Chromium sandbox (gVisor is the sandbox), and /tmp instead of a small /dev/shm.
export async function scrapeWithBrowser(url) {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ headless: true, chromiumSandbox: false, args: ['--disable-dev-shm-usage'] });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    return { url, title: await page.title(), text: (await page.locator('body').innerText()).slice(0, 20000) };
  } finally { await browser.close(); }
}
