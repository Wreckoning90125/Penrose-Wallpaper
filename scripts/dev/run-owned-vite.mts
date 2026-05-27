#!/usr/bin/env node

import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type Mode = 'serve' | 'preview';
type CliArgs = {
  mode: Mode;
  options: Map<string, string>;
};
type ServerIdentity = {
  appId: string;
  repoRoot: string;
  pid: number;
};

const APP_ID = 'penrose-wallpaper';
const IDENTITY_PATH = '/__penrose_dev_server.json';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const viteBin = path.join(repoRoot, 'node_modules', '.bin', 'vite');

function readArgs(): CliArgs {
  const args = process.argv.slice(2);
  const mode: Mode = args[0] === 'preview' ? 'preview' : 'serve';
  const options = new Map<string, string>();
  for (let i = 1; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg?.startsWith('--')) continue;

    const body = arg.slice(2);
    const equals = body.indexOf('=');
    if (equals >= 0) {
      options.set(body.slice(0, equals), body.slice(equals + 1));
      continue;
    }

    const next = args[i + 1];
    if (next === undefined || next.startsWith('--')) {
      throw new Error(`Missing value for --${body}`);
    }
    options.set(body, next);
    i += 1;
  }
  return { mode, options };
}

function readPort(mode: Mode, options: Map<string, string>): number {
  const raw = options.get('port')
    ?? (mode === 'preview' ? process.env['PENROSE_PREVIEW_PORT'] : process.env['PENROSE_DEV_PORT'])
    ?? (mode === 'preview' ? '4174' : '5174');
  const parsed = Number(raw);
  if (Number.isInteger(parsed) && parsed > 0 && parsed < 65536) return parsed;
  throw new Error(`Invalid ${mode} port: ${raw}`);
}

function readHost(mode: Mode, options: Map<string, string>): string {
  return options.get('host')
    ?? (mode === 'preview' ? process.env['PENROSE_PREVIEW_HOST'] : process.env['PENROSE_DEV_HOST'])
    ?? '0.0.0.0';
}

function publicHost(host: string): string {
  return host === '0.0.0.0' ? 'localhost' : host;
}

function canBind(port: number, host: string): Promise<boolean> {
  return new Promise<boolean>(resolve => {
    const server = net.createServer();
    server.once('error', (error: NodeJS.ErrnoException) => {
      resolve(error.code !== 'EADDRINUSE' && error.code !== 'EACCES');
    });
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

function readJsonString(text: string, key: string): string | null {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = text.match(new RegExp(`"${escapedKey}"\\s*:\\s*"([^"]*)"`));
  return match?.[1] ?? null;
}

function readJsonNumber(text: string, key: string): number | null {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = text.match(new RegExp(`"${escapedKey}"\\s*:\\s*(\\d+)`));
  const raw = match?.[1];
  if (raw === undefined) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseServerIdentity(text: string): ServerIdentity | null {
  const appId = readJsonString(text, 'appId');
  const identityRepoRoot = readJsonString(text, 'repoRoot');
  const pid = readJsonNumber(text, 'pid');
  if (appId === null || identityRepoRoot === null || pid === null) return null;
  return { appId, repoRoot: identityRepoRoot, pid };
}

async function readServerIdentity(port: number): Promise<ServerIdentity | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}${IDENTITY_PATH}`, { signal: AbortSignal.timeout(600) });
    if (!response.ok) return null;
    return parseServerIdentity(await response.text());
  } catch {
    return null;
  }
}

function printPortConflict(mode: Mode, host: string, port: number, identity: ServerIdentity | null): void {
  const label = mode === 'preview' ? 'preview' : 'dev';
  const known = identity === null ? 'an unidentified process' : `${identity.appId} at ${identity.repoRoot}`;
  process.stderr.write([
    `[dev-port] ${label} port ${port} is already in use by ${known}.`,
    '',
    'Canonical local ports:',
    '  PrismicHolonomy dev=5173 preview=4173',
    '  Penrose-Wallpaper dev=5174 preview=4174',
    '',
    'For another intentional Penrose instance, choose an explicit port:',
    `  npm run web:dev -- --port 5274 --host ${host}`,
    '',
  ].join('\n'));
}

function launchVite(mode: Mode, host: string, port: number): void {
  const args = mode === 'preview' ? ['preview'] : [];
  args.push('--host', host, '--port', String(port), '--strictPort');
  const child = spawn(viteBin, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      PENROSE_DEV_PORT: String(port),
      PENROSE_PREVIEW_PORT: String(port),
    },
  });
  child.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
    if (signal !== null) process.kill(process.pid, signal);
    process.exit(code ?? 0);
  });
}

async function main(): Promise<void> {
  const { mode, options } = readArgs();
  const host = readHost(mode, options);
  const port = readPort(mode, options);
  const bindable = await canBind(port, host);

  if (!bindable) {
    const identity = await readServerIdentity(port);
    if (identity?.appId === APP_ID && identity.repoRoot === repoRoot) {
      const label = mode === 'preview' ? 'Preview' : 'Dev';
      process.stdout.write(`[dev-port] ${label} server already running at http://${publicHost(host)}:${port}/\n`);
      return;
    }
    printPortConflict(mode, host, port, identity);
    process.exit(1);
  }

  launchVite(mode, host, port);
}

main().catch((error: Error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exit(1);
});
