import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { get } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { basename } from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type CdpResponse = { id: number; result?: JsonValue; error?: { message?: string; data?: string } };
type CdpEvent = { method?: string; params?: JsonValue };

function isCdpResponse(message: CdpResponse | CdpEvent): message is CdpResponse {
  return typeof Reflect.get(message, 'id') === 'number';
}
type ConsoleEntry = {
  source: string;
  level: string;
  text: string;
};

const DEFAULT_URLS = ['http://127.0.0.1:4174/', 'http://127.0.0.1:5174/'];
const APP_ID = 'penrose-wallpaper';
const CHROME_CANDIDATES = [
  process.env['CHROME_BIN'] ?? '',
  '/home/wreckoning90125/.cache/ms-playwright/chromium-1224/chrome-linux64/chrome',
  '/home/wreckoning90125/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome',
  'google-chrome',
  'chromium',
  'chromium-browser',
].filter(item => item.length > 0);

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

function httpText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const run = url.startsWith('https:') ? httpsRequest : get;
    const req = run(url, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        body += String(chunk);
      });
      response.on('end', () => {
        if ((response.statusCode ?? 500) >= 400) {
          reject(new Error(`${url} returned HTTP ${response.statusCode ?? 0}`));
          return;
        }
        resolve(body);
      });
    });
    req.on('error', reject);
    req.setTimeout(2500, () => {
      req.destroy(new Error(`${url} timed out`));
    });
  });
}

async function assertPenroseServer(appUrl: string): Promise<void> {
  const identityUrl = new URL('/__penrose_dev_server.json', appUrl).toString();
  const text = await httpText(identityUrl);
  const identity = JSON.parse(text);
  if (!identity || typeof identity !== 'object') throw new Error(`${identityUrl} did not return an object`);
  const appId = Reflect.get(identity, 'appId');
  if (appId !== APP_ID) throw new Error(`${identityUrl} is not ${APP_ID}`);
}

async function findRunningUrl(): Promise<string> {
  const requested = process.argv[2];
  const urls = requested ? [requested] : DEFAULT_URLS;
  for (const url of urls) {
    try {
      await assertPenroseServer(url);
      return url;
    } catch {
      // try the next known local port
    }
  }
  throw new Error(`No running Penrose dev/preview server found. Start one separately and pass its URL, e.g. npm run browser:console -- http://127.0.0.1:4174/`);
}

function cdpJsonUrl(port: number, path: string): string {
  return `http://127.0.0.1:${port}${path}`;
}

async function waitForCdp(port: number): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      await httpText(cdpJsonUrl(port, '/json/version'));
      return;
    } catch {
      await sleep(100);
    }
  }
  throw new Error(`Chrome DevTools endpoint on port ${port} did not become ready`);
}

async function launchChrome(port: number): Promise<ReturnType<typeof spawn>> {
  mkdirSync('output/playwright/browser-console-profile', { recursive: true });
  // Extra Chrome flags can be appended via PENROSE_BROWSER_ARGS (space-separated),
  // e.g. to force a WebGPU backend in a GPU-less sandbox where the default headless
  // adapter (SwiftShader) can't allocate the scene's buffers. Left opt-in so a real
  // GPU host keeps using its working default adapter.
  const extraArgs = (process.env['PENROSE_BROWSER_ARGS'] ?? '').split(' ').filter(Boolean);
  const width = Number(process.env['PENROSE_BROWSER_WIDTH'] ?? 1600);
  const height = Number(process.env['PENROSE_BROWSER_HEIGHT'] ?? 1000);
  const args = [
    `--remote-debugging-port=${port}`,
    '--user-data-dir=output/playwright/browser-console-profile',
    '--headless=new',
    '--no-first-run',
    '--disable-background-networking',
    '--enable-unsafe-webgpu',
    `--window-size=${width},${height}`,
    ...extraArgs,
    'about:blank',
  ];
  let lastError = '';
  for (const candidate of CHROME_CANDIDATES) {
    if (candidate.startsWith('/') && !existsSync(candidate)) continue;
    const child = spawn(candidate, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let failed = false;
    child.stderr?.on('data', chunk => {
      stderr += String(chunk);
    });
    child.on('error', error => {
      failed = true;
      stderr += error.message;
    });
    await sleep(250);
    if (!failed && child.exitCode === null) return child;
    lastError = `${basename(candidate)} exited: ${stderr.trim()}`;
  }
  throw new Error(`Could not launch Chrome. ${lastError}`);
}

function websocketAccept(key: string): string {
  return createHash('sha1')
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest('base64');
}

class CdpSocket {
  private socket: import('node:net').Socket;
  private nextId = 1;
  private pending = new Map<number, (value: CdpResponse) => void>();
  private eventHandlers: ((event: CdpEvent) => void)[] = [];
  private buffer = Buffer.alloc(0);
  private ready = false;

  constructor(socket: import('node:net').Socket) {
    this.socket = socket;
    socket.on('data', chunk => this.onData(typeof chunk === 'string' ? Buffer.from(chunk) : chunk));
  }

  static async connect(webSocketDebuggerUrl: string): Promise<CdpSocket> {
    const net = await import('node:net');
    const url = new URL(webSocketDebuggerUrl);
    const port = Number(url.port || 80);
    const key = Buffer.from(`${Date.now()}-${Math.random()}`).toString('base64');
    const socket = net.createConnection({ host: url.hostname, port });
    const cdp = new CdpSocket(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('error', reject);
      socket.once('connect', () => {
        socket.write(
          `GET ${url.pathname}${url.search} HTTP/1.1\r\n` +
          `Host: ${url.host}\r\n` +
          'Upgrade: websocket\r\n' +
          'Connection: Upgrade\r\n' +
          `Sec-WebSocket-Key: ${key}\r\n` +
          'Sec-WebSocket-Version: 13\r\n\r\n',
        );
      });
      const check = (chunk: Buffer): void => {
        const text = chunk.toString('utf8');
        if (!text.includes('\r\n\r\n')) return;
        socket.off('data', check);
        // Chrome's 101 status line varies ("Switching Protocols" vs "WebSocket
        // Protocol Handshake"); the Sec-WebSocket-Accept match is the real proof.
        const status101 = /^HTTP\/1\.[01]\s+101\b/i.test(text);
        if (!status101 || !text.includes(websocketAccept(key))) {
          reject(new Error(`Chrome DevTools WebSocket handshake failed. status101=${status101} hasAccept=${text.includes(websocketAccept(key))} head=${JSON.stringify(text.slice(0, 200))}`));
          return;
        }
        const rest = chunk.subarray(chunk.indexOf('\r\n\r\n') + 4);
        cdp.ready = true;
        if (rest.length > 0) cdp.onData(rest);
        resolve();
      };
      socket.on('data', check);
    });
    return cdp;
  }

  onEvent(handler: (event: CdpEvent) => void): void {
    this.eventHandlers.push(handler);
  }

  send(method: string, params: JsonValue = {}): Promise<CdpResponse> {
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params });
    this.socket.write(this.frame(Buffer.from(payload, 'utf8')));
    return new Promise(resolve => {
      this.pending.set(id, resolve);
    });
  }

  close(): void {
    this.socket.destroy();
  }

  private onData(chunk: Buffer): void {
    if (!this.ready) return;
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const b0 = this.buffer[0] ?? 0;
      const b1 = this.buffer[1] ?? 0;
      let offset = 2;
      let length = b1 & 0x7f;
      if (length === 126) {
        if (this.buffer.length < 4) return;
        length = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (this.buffer.length < 10) return;
        const high = this.buffer.readUInt32BE(2);
        const low = this.buffer.readUInt32BE(6);
        length = high * 2 ** 32 + low;
        offset = 10;
      }
      const masked = (b1 & 0x80) !== 0;
      const maskOffset = offset;
      if (masked) offset += 4;
      if (this.buffer.length < offset + length) return;
      const payload = this.buffer.subarray(offset, offset + length);
      const data = Buffer.from(payload);
      if (masked) {
        const mask = this.buffer.subarray(maskOffset, maskOffset + 4);
        for (let i = 0; i < data.length; i++) data[i] = (data[i] ?? 0) ^ (mask[i % 4] ?? 0);
      }
      this.buffer = this.buffer.subarray(offset + length);
      const opcode = b0 & 0x0f;
      if (opcode === 8) return;
      if (opcode !== 1) continue;
      const parsed = JSON.parse(data.toString('utf8'));
      this.handleMessage(parsed);
    }
  }

  private handleMessage(message: CdpResponse | CdpEvent): void {
    if (isCdpResponse(message)) {
      const resolve = this.pending.get(message.id);
      if (resolve) {
        this.pending.delete(message.id);
        resolve(message);
      }
      return;
    }
    for (const handler of this.eventHandlers) handler(message);
  }

  private frame(payload: Buffer): Buffer {
    const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
    const headerLength = payload.length < 126 ? 6 : 8;
    const header = Buffer.alloc(headerLength);
    header[0] = 0x81;
    if (payload.length < 126) {
      header[1] = 0x80 | payload.length;
      mask.copy(header, 2);
    } else {
      header[1] = 0x80 | 126;
      header.writeUInt16BE(payload.length, 2);
      mask.copy(header, 4);
    }
    const masked = Buffer.alloc(payload.length);
    for (let i = 0; i < payload.length; i++) masked[i] = (payload[i] ?? 0) ^ (mask[i % 4] ?? 0);
    return Buffer.concat([header, masked]);
  }
}

function eventObject(value: JsonValue): { [key: string]: JsonValue } | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

async function main(): Promise<void> {
  const appUrl = await findRunningUrl();
  const port = 9222 + Math.floor(Math.random() * 400);
  const chrome = await launchChrome(port);
  try {
    await waitForCdp(port);
    // Connect to the existing page target and navigate it. (/json/new now needs a
    // PUT in current Chrome; listing + Page.navigate is version-robust.)
    const listText = await httpText(cdpJsonUrl(port, '/json/list'));
    const targets = JSON.parse(listText);
    const page = Array.isArray(targets)
      ? targets.find(item => eventObject(item)?.['type'] === 'page')
      : null;
    const ws = page ? Reflect.get(page, 'webSocketDebuggerUrl') : undefined;
    if (typeof ws !== 'string') throw new Error('Chrome did not return a page WebSocket URL');
    const cdp = await CdpSocket.connect(ws);
    const entries: ConsoleEntry[] = [];
    cdp.onEvent(event => {
      if (event.method === 'Runtime.consoleAPICalled') {
        const params = eventObject(event.params ?? null);
        const type = typeof params?.['type'] === 'string' ? params['type'] : 'log';
        const args = Array.isArray(params?.['args']) ? params['args'] : [];
        const text = args.map(arg => {
          const object = eventObject(arg);
          const value = object?.['value'] ?? object?.['description'];
          return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
            ? String(value)
            : '';
        }).filter(Boolean).join(' ');
        entries.push({ source: 'console', level: type, text });
      }
      if (event.method === 'Log.entryAdded') {
        const params = eventObject(event.params ?? null);
        const entry = eventObject(params?.['entry'] ?? null);
        const level = typeof entry?.['level'] === 'string' ? entry['level'] : 'log';
        const text = typeof entry?.['text'] === 'string' ? entry['text'] : '';
        entries.push({ source: 'log', level, text });
      }
      if (event.method === 'Runtime.exceptionThrown') {
        const params = eventObject(event.params ?? null);
        entries.push({ source: 'exception', level: 'error', text: JSON.stringify(params) });
      }
    });
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Page.enable');
    const shotW = Number(process.env['PENROSE_BROWSER_WIDTH'] ?? 1600);
    const shotH = Number(process.env['PENROSE_BROWSER_HEIGHT'] ?? 1000);
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: shotW, height: shotH, deviceScaleFactor: 1, mobile: false,
    });
    await cdp.send('Page.navigate', { url: appUrl });
    await sleep(Number(process.env['PENROSE_BROWSER_PROBE_MS'] ?? 6000));
    const bad = entries.filter(entry => (
      entry.level === 'error'
      || /WGSL|WebGPU|Invalid ShaderModule|Invalid RenderPipeline|Device\.Create|uncaught|exception/i.test(entry.text)
    ));
    mkdirSync('output/playwright', { recursive: true });
    writeFileSync('output/playwright/browser-console.json', `${JSON.stringify({ appUrl, entries }, null, 2)}\n`);
    const shotPath = process.env['PENROSE_BROWSER_SHOT'];
    if (shotPath) {
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      const data = eventObject(shot.result ?? null)?.['data'];
      if (typeof data === 'string') {
        writeFileSync(shotPath, Buffer.from(data, 'base64'));
        process.stdout.write(`[browser-console] screenshot written to ${shotPath}\n`);
      }
    }
    cdp.close();
    if (bad.length > 0) {
      process.stderr.write(`[browser-console] ${bad.length} browser error(s)\n`);
      for (const entry of bad.slice(0, 20)) process.stderr.write(`[${entry.source}:${entry.level}] ${entry.text}\n`);
      process.exit(1);
    }
    process.stdout.write(`[browser-console] OK: ${entries.length} console/log entr${entries.length === 1 ? 'y' : 'ies'} captured from ${appUrl}\n`);
  } finally {
    chrome.kill();
  }
}

void main().catch(caught => {
  const message = caught instanceof Error ? caught.message : String(caught);
  process.stderr.write(`[browser-console] ${message}\n`);
  process.exit(1);
});
