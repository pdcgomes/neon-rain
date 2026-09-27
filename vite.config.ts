import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));
const labDir = resolve(root, 'public/lab');

/** Dev-only endpoints the Style Lab uses to save exported models into public/lab. */
function labSave(): Plugin {
  return {
    name: 'lab-save',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__lab/', (req, res) => {
        if (req.method !== 'POST') return void res.writeHead(405).end();
        const url = new URL(req.url ?? '', 'http://x');
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          const body = Buffer.concat(chunks);
          if (url.pathname === '/save') {
            const file = resolve(labDir, url.searchParams.get('file') ?? '');
            if (!file.startsWith(resolve(labDir, 'assets'))) return void res.writeHead(400).end('bad path');
            mkdirSync(dirname(file), { recursive: true });
            writeFileSync(file, body);
            return void res.writeHead(200).end('ok');
          }
          if (url.pathname === '/manifest') {
            const entry = JSON.parse(body.toString('utf8')) as { id: string };
            const path = resolve(labDir, 'manifest.json');
            const m = JSON.parse(readFileSync(path, 'utf8')) as { assets: { id: string }[] };
            const i = m.assets.findIndex((a) => a.id === entry.id);
            if (i >= 0) m.assets[i] = entry;
            else m.assets.push(entry);
            writeFileSync(path, `${JSON.stringify(m, null, 2)}\n`);
            return void res.writeHead(200).end('ok');
          }
          res.writeHead(404).end();
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [labSave()],
  server: { port: 5173, open: false },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        lab: fileURLToPath(new URL('./lab.html', import.meta.url)),
      },
    },
  },
});
