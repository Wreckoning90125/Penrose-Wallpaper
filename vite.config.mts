import { createReadStream, existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import type { Plugin, PreviewServer, ViteDevServer } from 'vite';

type Next = () => void;
type Middleware = (req: IncomingMessage, res: ServerResponse, next: Next) => void | Promise<void>;
type Mode = 'serve' | 'preview';

const APP_ID = 'penrose-wallpaper';
const IDENTITY_PATH = '/__penrose_dev_server.json';
const repoRoot = path.dirname(fileURLToPath(import.meta.url));
const devPort = readPort(process.env['PENROSE_DEV_PORT'], 5174);
const previewPort = readPort(process.env['PENROSE_PREVIEW_PORT'], 4174);
const activeMode: Mode = process.env['PENROSE_VITE_MODE'] === 'preview' ? 'preview' : 'serve';
const activePort = readPort(
  process.env['PENROSE_VITE_PORT'],
  activeMode === 'preview' ? previewPort : devPort,
);
const devHost = process.env['PENROSE_DEV_HOST'] ?? '0.0.0.0';
const previewHost = process.env['PENROSE_PREVIEW_HOST'] ?? '0.0.0.0';
const reactDevtoolsEnabled = process.env['PENROSE_REACT_DEVTOOLS'] === '1';

function readPort(raw: string | undefined, defaultValue: number): number {
  const parsed = Number(raw ?? defaultValue);
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : defaultValue;
}

function hostForMode(mode: Mode): string {
  return mode === 'preview' ? previewHost : devHost;
}

function writeIdentityResponse(res: ServerResponse, mode: Mode): void {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify({
    appId: APP_ID,
    repoRoot,
    mode,
    host: hostForMode(mode),
    pid: process.pid,
  }));
}

function serverIdentityPlugin(): Plugin {
  return {
    name: 'penrose-dev-server-identity',
    configureServer(server: ViteDevServer): void {
      server.middlewares.use(IDENTITY_PATH, (_req: IncomingMessage, res: ServerResponse) => {
        writeIdentityResponse(res, 'serve');
      });
    },
    configurePreviewServer(server: PreviewServer): void {
      server.middlewares.use(IDENTITY_PATH, (_req: IncomingMessage, res: ServerResponse) => {
        writeIdentityResponse(res, 'preview');
      });
    },
  };
}

function liveGeometryPlugin(): Plugin {
  const handle: Middleware = async (req, res, next) => {
    // A malformed request URL (e.g. a stray '//') must not crash the dev/preview
    // server — fall through to the next middleware instead of throwing.
    let url: URL;
    try {
      url = new URL(req.url ?? '/', 'http://localhost');
    } catch {
      next();
      return;
    }
    const match = url.pathname.match(/^\/generated\/live\/(\d+)\/(\d+)\/(\d+)\.ptg$/);
    if (match === null) {
      next();
      return;
    }

    const family = match[1] ?? '';
    const seed = match[2] ?? '';
    const generation = match[3] ?? '';
    const outputDir = path.join(repoRoot, '.cache', 'web-live-geometry');
    const output = path.join(outputDir, `${family}-${seed}-${generation}.ptg`);
    if (!existsSync(output)) {
      await mkdir(outputDir, { recursive: true });
      const result = spawnSync(
        'python3',
        ['tools/generate_web_geometry.py', '--live', family, seed, generation, output],
        { cwd: repoRoot, stdio: 'inherit' },
      );
      if (result.status !== 0) {
        res.statusCode = 500;
        res.end('geometry export failed');
        return;
      }
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    createReadStream(output).pipe(res);
  };

  return {
    name: 'penrose-live-geometry',
    configureServer(server: ViteDevServer): void {
      server.middlewares.use(handle);
    },
    configurePreviewServer(server: PreviewServer): void {
      server.middlewares.use(handle);
    },
  };
}

function reactDevtoolsPlugin(): Plugin {
  return {
    name: 'penrose-react-devtools',
    apply: 'serve',
    transformIndexHtml(html: string) {
      if (!reactDevtoolsEnabled || html.includes('localhost:8097')) return html;
      return html.replace('<head>', '<head>\n    <script src="http://localhost:8097"></script>');
    },
  };
}

export default defineConfig({
  root: 'web',
  publicDir: 'public',
  cacheDir: path.join(repoRoot, 'node_modules', '.vite', `penrose-${activeMode}-${activePort}`),
  plugins: [serverIdentityPlugin(), liveGeometryPlugin(), reactDevtoolsPlugin()],
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
    target: 'es2024',
    chunkSizeWarningLimit: 1000,
  },
  server: {
    host: devHost,
    port: devPort,
    strictPort: true,
  },
  preview: {
    host: previewHost,
    port: previewPort,
    strictPort: true,
  },
});
