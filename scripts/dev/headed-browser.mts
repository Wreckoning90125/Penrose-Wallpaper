#!/usr/bin/env node
// Penrose-owned headed-browser client. Re-implements the connect path from the
// sibling render harness in this repo, so we own our render proof.
//
// Model: a Playwright `launchServer` runs on the WINDOWS side (its own managed
// Chromium, real GPU — never the user's real browser). WSL connects to it over
// `ws://<gateway-ip>:3333/<token>` and drives the app served from WSL. Keep the
// network asymmetry exact:
//   --connect-ws  → the WSL->Windows gateway IP (WSL reaching the Windows server)
//   --url         → http://localhost:4174/ (Windows reaching WSL via WSL2
//                   forwarding; `localhost` preserves the secure context so
//                   COOP/COEP/SharedArrayBuffer stay enabled)
//
// Windows side (user runs this, prints ws://0.0.0.0:3333/<TOKEN>):
//   node scripts/dev/playwright-server.mts --browser chromium --host 0.0.0.0 --port 3333
//
// Usage:
//   node scripts/dev/headed-browser.mts --connect-ws ws://<gw>:3333/<token> [--url http://localhost:4174/]
//   node scripts/dev/headed-browser.mts --connect-ws <TOKEN>   # bare token, expanded against gateway IP
//   node scripts/dev/headed-browser.mts --launch               # local headed fallback (no real GPU under WSL)
//
// Artifacts (all under output/playwright/, gitignored):
//   headed-screenshot.png, headed-report.json
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const args = process.argv.slice(2);
function flag(name: string, fallback = ''): string {
  const i = args.indexOf(name);
  const v = i >= 0 ? args[i + 1] : undefined;
  return v ? v : fallback;
}
const has = (name: string): boolean => args.includes(name);

interface Report {
  url: string;
  connectTo: string | null;
  mode: string;
  error?: string;
  gpu?: Record<string, string | number | boolean | null>;
  canvasCheck?: Record<string, string | number | boolean | null>;
  messages?: string[];
  errors?: string[];
}

const OUT = path.join(process.cwd(), 'output', 'playwright');
fs.mkdirSync(OUT, { recursive: true });

const url = flag('--url', 'http://localhost:4174/');
const viewportWidth = Number(flag('--viewport-width', '2560'));
const viewportHeight = Number(flag('--viewport-height', '1320'));
const waitMs = Number(flag('--wait-ms', '9000'));
const shotPath = path.join(OUT, 'headed-screenshot.png');
const reportPath = path.join(OUT, 'headed-report.json');

// Resolve --connect-ws. Accept a bare token and expand against the gateway IP,
// so `--connect-ws <TOKEN>` also works.
let connectTo = flag('--connect-ws', process.env['PW_CONNECT_WS'] || '');
if (connectTo && !connectTo.startsWith('ws://') && !connectTo.startsWith('wss://')) {
  let gw = '';
  try { gw = execSync("ip route show default | awk '{print $3}'").toString().trim(); } catch { /* ignore */ }
  connectTo = `ws://${gw}:${flag('--port', '3333')}/${connectTo}`;
}
const doLaunch = has('--launch') || !connectTo;

const msgs: string[] = [];
const report: Report = { url, connectTo: connectTo || null, mode: doLaunch ? 'launch' : 'connect' };

let browser;
try {
  if (doLaunch) {
    console.log('[headed] LOCAL launch (WSL has no real GPU; expect swiftshader — connect to Windows for real GPU proof).');
    browser = await chromium.launch({
      headless: false,
      args: ['--no-sandbox', '--enable-unsafe-webgpu', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
    });
  } else {
    console.log(`[headed] connecting to Windows Playwright server: ${connectTo}`);
    browser = await chromium.connect(connectTo);
  }
} catch (e) {
  // Print verbatim — a client/server version mismatch surfaces here and is a
  // one-line re-pin, not a guessing game.
  console.error('[headed] CONNECT/LAUNCH FAILED:\n' + (e instanceof Error ? e.stack || e.message : String(e)));
  report.error = e instanceof Error ? e.message : String(e);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  process.exit(2);
}

const page = await browser.newPage({ viewport: { width: viewportWidth, height: viewportHeight } });
page.on('console', (m) => msgs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => msgs.push(`[pageerror] ${e.message}`));

try {
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
} catch (e) {
  msgs.push('[nav] ' + (e instanceof Error ? e.message : String(e)));
}

const gpu = await page.evaluate(async () => {
  const gpuApi = Reflect.get(navigator, 'gpu');
  if (!gpuApi) return { webgpu: false };
  try {
    const a = await gpuApi.requestAdapter();
    if (!a) return { webgpu: true, adapter: null };
    const info = Reflect.get(a, 'info') || {};
    return {
      webgpu: true,
      adapter: `${info.vendor || ''} ${info.architecture || ''} ${info.description || ''}`.trim(),
      maxBufferSize: Number(a.limits?.maxBufferSize),
    };
  } catch (e) { return { webgpu: true, err: String(e) }; }
}).catch((e) => ({ err: String(e) }));

await page.waitForTimeout(waitMs);
await page.screenshot({ path: shotPath, fullPage: false }).catch((e) => msgs.push('[shot] ' + e.message));

// Canvas-nonblank check: sample the WebGPU canvas and see if any pixel deviates
// from a single flat color. Prevents "screenshot looks fine" false positives.
const canvasCheck = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  if (!c) return { canvas: false };
  const off = document.createElement('canvas');
  off.width = Math.min(c.width || c.clientWidth, 256);
  off.height = Math.min(c.height || c.clientHeight, 256);
  const ctx = off.getContext('2d');
  if (!ctx) return { canvas: true, sampled: false };
  try {
    ctx.drawImage(c, 0, 0, off.width, off.height);
    const d = ctx.getImageData(0, 0, off.width, off.height).data;
    let min = 255, max = 0;
    for (let i = 0; i < d.length; i += 4) {
      const lum = ((d[i] ?? 0) + (d[i + 1] ?? 0) + (d[i + 2] ?? 0)) / 3;
      if (lum < min) min = lum;
      if (lum > max) max = lum;
    }
    return { canvas: true, sampled: true, w: c.width, h: c.height, lumMin: min, lumMax: max, nonBlank: max - min > 4 };
  } catch (e) { return { canvas: true, sampled: false, err: String(e) }; }
}).catch(() => ({ canvas: false }));

report.gpu = gpu;
report.canvasCheck = canvasCheck;
report.messages = msgs;
const errors = msgs.filter((m) => /error|WGSL|createBuffer|RenderPipeline|exception|failed/i.test(m));
report.errors = errors;
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');

console.log('[headed] GPU     ', JSON.stringify(gpu));
console.log('[headed] canvas  ', JSON.stringify(canvasCheck));
console.log('[headed] errors  ', errors.length);
errors.slice(0, 20).forEach((b) => console.log('   ' + b));
console.log('[headed] screenshot →', path.relative(process.cwd(), shotPath));
console.log('[headed] report     →', path.relative(process.cwd(), reportPath));

await browser.close();
