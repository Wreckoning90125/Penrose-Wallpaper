import { createReadStream, existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const repoRoot = path.dirname(fileURLToPath(import.meta.url));

function liveGeometryPlugin() {
  const handle = async (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const match = url.pathname.match(/^\/generated\/live\/(\d+)\/(\d+)\/(\d+)\.ptg$/);
    if (!match) {
      next();
      return;
    }

    const [, family, seed, generation] = match;
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
    configureServer(server) {
      server.middlewares.use(handle);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handle);
    },
  };
}

export default defineConfig({
  root: 'web',
  publicDir: 'public',
  plugins: [liveGeometryPlugin()],
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
    target: 'es2024',
    chunkSizeWarningLimit: 1000,
  },
  server: {
    host: '0.0.0.0',
    port: 5174,
    strictPort: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 4174,
    strictPort: true,
  },
});
