/**
 * Headless Chrome screenshot driver over the DevTools pipe (no dependencies).
 *
 *   node scripts/shot.ts --url "http://localhost:5173/?autostart" --wait 4000 \
 *     --eval "window.game.view.rig.zoom(-400)" --shot 1500:shots/a.png --shot 3000:shots/b.png
 *
 * Steps run in order: --wait ms, --eval js, --shot delay:path. Console output and errors are printed.
 * Set CHROME to override the browser binary.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname } from 'node:path';
import type { Readable, Writable } from 'node:stream';

const CANDIDATES = [
  process.env.CHROME,
  `${homedir()}/Library/Caches/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-mac-arm64/chrome-headless-shell`,
  `${homedir()}/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean) as string[];
const CHROME = CANDIDATES.find((p) => existsSync(p))!;

const args = process.argv.slice(2);
let url = 'http://localhost:5173/?autostart';
let width = 1600;
let height = 900;
const steps: { kind: 'wait' | 'eval' | 'shot'; value: string }[] = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  const v = args[++i];
  if (a === '--url') url = v;
  else if (a === '--size') [width, height] = v.split('x').map(Number);
  else if (a === '--wait') steps.push({ kind: 'wait', value: v });
  else if (a === '--eval') steps.push({ kind: 'eval', value: v });
  else if (a === '--shot') steps.push({ kind: 'shot', value: v });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(
  CHROME,
  [
    ...(CHROME.includes('headless-shell') ? [] : ['--headless=new']),
    '--remote-debugging-pipe',
    '--no-sandbox',
    '--use-angle=swiftshader',
    `--window-size=${width},${height}`,
    `--user-data-dir=/tmp/synd-chrome-${process.pid}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--mute-audio',
    '--autoplay-policy=no-user-gesture-required',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--no-proxy-server',
  ],
  { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] },
);
const hardStop = setTimeout(() => {
  console.log('[timeout] giving up');
  chrome.kill('SIGKILL');
  process.exit(2);
}, Number(process.env.SHOT_TIMEOUT ?? 120000));

const toChrome = chrome.stdio[3] as Writable;
const fromChrome = chrome.stdio[4] as Readable;
let id = 0;
let session = '';
const pending = new Map<number, (v: any) => void>();
let buf = '';
fromChrome.on('data', (d: Buffer) => {
  buf += d.toString('utf8');
  let i: number;
  while ((i = buf.indexOf('\0')) >= 0) {
    const msg = JSON.parse(buf.slice(0, i));
    buf = buf.slice(i + 1);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)!(msg);
      pending.delete(msg.id);
    } else if (msg.method === 'Runtime.consoleAPICalled') {
      const text = msg.params.args.map((a: any) => a.value ?? a.description ?? '').join(' ');
      console.log(`[console.${msg.params.type}] ${text.slice(0, 500)}`);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      console.log(`[exception] ${(d.exception?.description ?? d.text).slice(0, 1500)}`);
    }
  }
});

const send = (method: string, params: object = {}, useSession = true) =>
  new Promise<any>((resolve) => {
    const i = ++id;
    pending.set(i, resolve);
    const msg: Record<string, unknown> = { id: i, method, params };
    if (useSession && session) msg.sessionId = session;
    toChrome.write(JSON.stringify(msg) + '\0');
  });

try {
  const t = await send('Target.createTarget', { url: 'about:blank' }, false);
  const a = await send('Target.attachToTarget', { targetId: t.result.targetId, flatten: true }, false);
  session = a.result.sessionId;
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url });
  const t0 = Date.now();
  for (const s of steps) {
    if (s.kind === 'wait') await sleep(Number(s.value));
    else if (s.kind === 'eval') {
      const r = await send('Runtime.evaluate', { expression: s.value, awaitPromise: true, returnByValue: true });
      if (r.result?.exceptionDetails) console.log('[eval error]', r.result.exceptionDetails.exception?.description);
      else if (r.result?.result?.value !== undefined) {
        const v = r.result.result.value;
        console.log('[eval]', typeof v === 'string' ? v : JSON.stringify(v));
      }
    } else {
      const [delay, path] = s.value.split(':');
      await sleep(Number(delay));
      const r = await send('Page.captureScreenshot', { format: 'png' });
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, Buffer.from(r.result.data, 'base64'));
      console.log(`[shot] ${path} @ ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    }
  }
} finally {
  clearTimeout(hardStop);
  chrome.kill('SIGKILL');
  process.exit(0);
}
