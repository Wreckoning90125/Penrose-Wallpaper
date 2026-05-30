#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type Mode = 'serve' | 'preview';
type JsonArray = readonly JsonValue[];
type JsonObject = { readonly [key: string]: JsonValue | undefined };
type JsonValue = null | boolean | number | string | JsonObject | JsonArray;
type ParsedArgs = {
  mode: Mode;
  options: Map<string, string>;
  passthroughArgs: string[];
};
type ServerIdentity = {
  appId: string;
  repoRoot: string;
  mode: Mode;
  host: string;
  pid: number | null;
};

const APP_ID = 'penrose-wallpaper';
const IDENTITY_PATH = '/__penrose_dev_server.json';
const IDENTITY_ATTEMPTS = 6;
const IDENTITY_TIMEOUT_MS = 1000;
const IDENTITY_RETRY_DELAY_MS = 250;
const DEFAULT_DEV_PORT = 5174;
const DEFAULT_PREVIEW_PORT = 4174;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const viteBinName = process.platform === 'win32' ? 'vite.cmd' : 'vite';
const viteBin = path.join(repoRoot, 'node_modules', '.bin', viteBinName);
const controlledViteFlags = new Set(['host', 'port', 'strictPort']);

function parseArgs(argv: readonly string[]): ParsedArgs {
  const mode: Mode = argv[0] === 'preview' ? 'preview' : 'serve';
  const start = argv[0] === 'preview' || argv[0] === 'serve' ? 1 : 0;
  const options = new Map<string, string>();
  const passthroughArgs: string[] = [];

  for (let i = start; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined || !arg.startsWith('--')) {
      if (arg !== undefined) passthroughArgs.push(arg);
      continue;
    }

    const body = arg.slice(2);
    const equalsIndex = body.indexOf('=');
    const key = equalsIndex >= 0 ? body.slice(0, equalsIndex) : body;
    const inlineValue = equalsIndex >= 0 ? body.slice(equalsIndex + 1) : null;
    if (key.length === 0) {
      passthroughArgs.push(arg);
      continue;
    }

    const next = argv[i + 1];
    const consumesNext = inlineValue === null && next !== undefined && !next.startsWith('--');
    const value = inlineValue ?? (consumesNext ? next : key === 'host' ? '0.0.0.0' : 'true');
    if (consumesNext) i += 1;
    options.set(key, value);

    if (!controlledViteFlags.has(key)) {
      passthroughArgs.push(arg);
      if (consumesNext) passthroughArgs.push(value);
    }
  }

  return { mode, options, passthroughArgs };
}

function parsePort(raw: string | undefined, defaultPort: number): number {
  const parsed = Number(raw ?? defaultPort);
  if (Number.isInteger(parsed) && parsed > 0 && parsed < 65536) return parsed;
  throw new Error(`Invalid port: ${raw ?? String(defaultPort)}`);
}

function readPort(mode: Mode, options: Map<string, string>): number {
  return parsePort(
    options.get('port') ??
      (mode === 'preview' ? process.env['PENROSE_PREVIEW_PORT'] : process.env['PENROSE_DEV_PORT']),
    mode === 'preview' ? DEFAULT_PREVIEW_PORT : DEFAULT_DEV_PORT,
  );
}

function readHost(mode: Mode, options: Map<string, string>): string {
  return options.get('host')
    ?? (mode === 'preview' ? process.env['PENROSE_PREVIEW_HOST'] : process.env['PENROSE_DEV_HOST'])
    ?? '0.0.0.0';
}

function publicHost(host: string): string {
  return host === '0.0.0.0' ? 'localhost' : host;
}

function normalizeBindHost(host: string): string {
  if (host === 'localhost' || host === '::1') return '127.0.0.1';
  if (host === '::') return '0.0.0.0';
  return host;
}

function isLoopbackHost(host: string): boolean {
  return normalizeBindHost(host) === '127.0.0.1';
}

function hostRequestSatisfied(requestedHost: string, runningHost: string): boolean {
  const requested = normalizeBindHost(requestedHost);
  const running = normalizeBindHost(runningHost);
  if (requested === running) return true;
  return isLoopbackHost(requested) && running === '0.0.0.0';
}

function canBind(port: number, host: string): Promise<boolean> {
  return new Promise<boolean>(resolve => {
    const server = net.createServer();
    server.once('error', () => {
      resolve(false);
    });
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readJson(text: string): JsonValue | null {
  try {
    const value: JsonValue = JSON.parse(text);
    return value;
  } catch {
    return null;
  }
}

function readJsonString(record: JsonObject, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' ? value : null;
}

function readJsonMode(record: JsonObject): Mode | null {
  const value = record['mode'];
  return value === 'serve' || value === 'preview' ? value : null;
}

function readJsonNumber(record: JsonObject, key: string): number | null {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseServerIdentity(text: string): ServerIdentity | null {
  const value = readJson(text);
  if (!isJsonObject(value)) return null;

  const appId = readJsonString(value, 'appId');
  const identityRepoRoot = readJsonString(value, 'repoRoot');
  const mode = readJsonMode(value);
  const host = readJsonString(value, 'host');
  const pid = readJsonNumber(value, 'pid');
  if (appId === null || identityRepoRoot === null || mode === null || host === null) return null;
  return { appId, repoRoot: identityRepoRoot, mode, host, pid };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

async function readServerIdentityOnce(port: number): Promise<ServerIdentity | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}${IDENTITY_PATH}`, {
      signal: AbortSignal.timeout(IDENTITY_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return parseServerIdentity(await response.text());
  } catch {
    return null;
  }
}

async function readServerIdentity(port: number): Promise<ServerIdentity | null> {
  for (let attempt = 0; attempt < IDENTITY_ATTEMPTS; attempt += 1) {
    const identity = await readServerIdentityOnce(port);
    if (identity !== null) return identity;
    if (attempt < IDENTITY_ATTEMPTS - 1) await sleep(IDENTITY_RETRY_DELAY_MS);
  }
  return null;
}

function printPortConflict(mode: Mode, host: string, port: number, identity: ServerIdentity | null): void {
  const label = mode === 'preview' ? 'preview' : 'dev';
  const owner =
    identity === null
      ? 'an unidentified process'
      : `${identity.appId} ${identity.mode} server at ${identity.repoRoot} bound to ${identity.host}`;
  process.stderr.write([
    `[dev-port] ${label} port ${port} is already in use by ${owner}.`,
    '',
    `Default Penrose ports: dev=${DEFAULT_DEV_PORT} preview=${DEFAULT_PREVIEW_PORT}`,
    '',
    'For another intentional Penrose instance, choose an explicit port:',
    `  npm run ${mode === 'preview' ? 'web:preview' : 'web:dev'} -- --port ${
      mode === 'preview' ? 4274 : 5274
    } --host ${host}`,
    '',
  ].join('\n'));
}

function launchVite(mode: Mode, host: string, port: number, passthroughArgs: readonly string[]): void {
  const args = mode === 'preview' ? ['preview'] : [];
  args.push(...passthroughArgs, '--host', host, '--port', String(port), '--strictPort');
  const child = spawn(viteBin, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      PENROSE_VITE_MODE: mode,
      PENROSE_VITE_PORT: String(port),
      ...(mode === 'preview' ? { PENROSE_PREVIEW_PORT: String(port) } : { PENROSE_DEV_PORT: String(port) }),
      ...(mode === 'preview' ? { PENROSE_PREVIEW_HOST: host } : { PENROSE_DEV_HOST: host }),
    },
  });
  child.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
    if (signal !== null) process.exit(1);
    process.exit(code ?? 0);
  });
}

async function main(): Promise<void> {
  if (!existsSync(viteBin)) {
    process.stderr.write(`[dev-port] Missing vite binary at ${viteBin}\n`);
    process.exit(1);
  }

  const { mode, options, passthroughArgs } = parseArgs(process.argv.slice(2));
  const host = readHost(mode, options);
  const port = readPort(mode, options);
  const bindable = await canBind(port, host);

  if (!bindable) {
    const identity = await readServerIdentity(port);
    if (
      identity?.appId === APP_ID &&
      identity.repoRoot === repoRoot &&
      identity.mode === mode &&
      hostRequestSatisfied(host, identity.host)
    ) {
      const label = mode === 'preview' ? 'Preview' : 'Dev';
      process.stdout.write(
        `[dev-port] ${label} server already running for this repo at http://${publicHost(host)}:${port}/\n`,
      );
      return;
    }
    printPortConflict(mode, host, port, identity);
    process.exit(1);
  }

  launchVite(mode, host, port, passthroughArgs);
}

main().catch((error: Error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exit(1);
});
