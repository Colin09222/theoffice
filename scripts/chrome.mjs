// Starts a headless Chromium with remote debugging on, for the launch card camera (server/shooter.js) outside the server: the command-line
// script and the tests. The office server itself never starts a process; it talks to a running browser at SHOTS_CDP_URL.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { makeShooter } from '../server/shooter.js';

/** Where a Chromium might be: the setting, then the places the Playwright images and this repo's test machines keep one. */
export function findChrome(setting = '') {
  if (setting) return existsSync(setting) ? setting : null;
  const fixed = ['/opt/pw-browsers/chromium', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  for (const p of fixed) if (existsSync(p)) return p;
  // Playwright's own layout: /ms-playwright/chromium_headless_shell-NNNN/chrome-linux/headless_shell (the office-runner/browser image), or chromium-NNNN/chrome-linux/chrome.
  for (const root of [process.env.PLAYWRIGHT_BROWSERS_PATH, '/ms-playwright', '/opt/pw-browsers'].filter(Boolean)) {
    let dirs = []; try { dirs = readdirSync(root); } catch { continue; }
    for (const d of dirs.sort().reverse()) {
      for (const rel of ['chrome-linux/headless_shell', 'chrome-headless-shell-linux64/chrome-headless-shell', 'chrome-linux/chrome', 'chrome-linux64/chrome']) {
        const p = join(root, d, rel);
        if (existsSync(p)) return p;
      }
    }
  }
  return null;
}
const freePort = () => new Promise((resolve, reject) => { const s = createServer(); s.on('error', reject); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });

/** { cdpUrl, stop() } for a fresh headless Chromium, or null when there is none on this machine. */
export async function startChrome({ chrome = '' } = {}) {
  const exe = findChrome(chrome);
  if (!exe) return null;
  const port = await freePort();
  const dir = mkdtempSync(join(tmpdir(), 'office-shots-'));
  const proc = spawn(exe, ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--mute-audio', '--no-first-run', '--disable-extensions', '--disable-background-networking',
    `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, 'about:blank'], { stdio: 'ignore' });
  proc.on('error', () => {});
  let stopped = false;
  const stop = () => { if (stopped) return; stopped = true; proc.kill('SIGKILL'); setTimeout(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } }, 500); };
  return { cdpUrl: `http://127.0.0.1:${port}`, stop };
}
/** A camera on a Chromium of its own, closed with the shooter. SHOTS_CDP_URL, when set, is used instead. */
export async function localShooter({ chrome = '', cdpUrl = '' } = {}) {
  if (cdpUrl) return makeShooter({ cdpUrl });
  const c = await startChrome({ chrome });
  if (!c) return null;
  return makeShooter({ cdpUrl: c.cdpUrl, onClose: c.stop });
}
