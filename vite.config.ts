import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));
const labDir = resolve(root, 'public/lab');
const localDir = resolve(root, 'content-local');
const MISSION_DIRS = { bundled: resolve(root, 'src/content/missions'), local: resolve(localDir, 'missions') } as const;
type MissionSource = keyof typeof MISSION_DIRS;

const json = (res: ServerResponse, v: unknown) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(v));
const safeId = (id: string | null) => (id && /^[a-z0-9_-]{1,64}$/i.test(id) ? id : null);
const source = (s: string | null): MissionSource => (s === 'bundled' ? 'bundled' : 'local');

function listMissions() {
  const out: { id: string; source: MissionSource; codename: string; city: string; kind: string; size: number; mtime: number; objectives: string[] }[] = [];
  for (const [src, dir] of Object.entries(MISSION_DIRS) as [MissionSource, string][]) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
      const path = join(dir, f);
      try {
        const m = JSON.parse(readFileSync(path, 'utf8'));
        const st = statSync(path);
        out.push({
          id: f.replace(/\.json$/, ''),
          source: src,
          codename: m.codename ?? '',
          city: m.city ?? '',
          kind: m.map?.kind === 'authored' ? 'authored' : 'procedural',
          size: st.size,
          mtime: st.mtimeMs,
          objectives: (m.objectives ?? []).map((o: { type?: string; id: string }) => o.type ?? o.id),
        });
      } catch {
        /* skip unreadable files */
      }
    }
  }
  return out;
}

/** Folders under content-local/ that hold Syndicate data (COL01.DAT plus GAME/MAP files). */
function syndFolders(): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    const up = names.map((n) => n.toUpperCase());
    if (up.includes('COL01.DAT') && up.some((n) => /^GAME\d\d\.DAT$/.test(n))) out.push(relative(localDir, dir));
    if (depth < 5) for (const n of names) if (n !== 'missions' && statSync(join(dir, n), { throwIfNoEntry: false })?.isDirectory()) walk(join(dir, n), depth + 1);
  };
  if (existsSync(localDir)) walk(localDir, 0);
  return out;
}

/** Dev-only endpoints the Lab uses: saving exported models into public/lab, and reading/writing missions. */
function labSave(): Plugin {
  return {
    name: 'lab-save',
    apply: 'serve',
    // Saving a mission from the Lab must not reload every open page. Drop the stale module so the
    // game picks the new file up on its next load instead.
    hotUpdate({ file, modules }) {
      if (!file.endsWith('.json') || !Object.values(MISSION_DIRS).some((d) => file.startsWith(d))) return;
      for (const m of modules) this.environment.moduleGraph.invalidateModule(m);
      return [];
    },
    configureServer(server) {
      server.middlewares.use('/__lab/', (req, res) => {
        const url = new URL(req.url ?? '', 'http://x');
        if (req.method === 'GET') {
          if (url.pathname === '/missions') return void json(res, listMissions());
          if (url.pathname === '/mission') {
            const id = safeId(url.searchParams.get('id'));
            const path = id && join(MISSION_DIRS[source(url.searchParams.get('source'))], `${id}.json`);
            if (!path || !existsSync(path)) return void res.writeHead(404).end('not found');
            return void res.writeHead(200, { 'content-type': 'application/json' }).end(readFileSync(path));
          }
          if (url.pathname === '/synd/folders') {
            return void json(
              res,
              syndFolders().map((dir) => ({ dir, files: readdirSync(join(localDir, dir)).filter((n) => /\.(DAT|TAB|ANI)$/i.test(n)) })),
            );
          }
          if (url.pathname === '/synd/file') {
            const path = resolve(localDir, url.searchParams.get('path') ?? '');
            if (!path.startsWith(localDir + '/') || !existsSync(path)) return void res.writeHead(404).end('not found');
            return void res.writeHead(200, { 'content-type': 'application/octet-stream' }).end(readFileSync(path));
          }
          return void res.writeHead(404).end();
        }
        if (req.method !== 'POST') return void res.writeHead(405).end();
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
          const id = safeId(url.searchParams.get('id'));
          if (!id) return void res.writeHead(400).end('bad id');
          const src = source(url.searchParams.get('source'));
          const path = join(MISSION_DIRS[src], `${id}.json`);
          if (url.pathname === '/mission') {
            const mission = JSON.parse(body.toString('utf8')) as { id?: string };
            if (mission.id !== id) return void res.writeHead(400).end('id mismatch');
            mkdirSync(MISSION_DIRS[src], { recursive: true });
            // Bundled missions are reviewed in git, so keep them readable; local ones can be compact.
            writeFileSync(path, src === 'bundled' ? `${JSON.stringify(mission, null, 2)}\n` : JSON.stringify(mission));
            return void json(res, { ok: true, path: relative(root, path) });
          }
          if (url.pathname === '/mission-delete') {
            if (existsSync(path)) rmSync(path);
            return void json(res, { ok: true });
          }
          if (url.pathname === '/mission-promote') {
            const from = join(MISSION_DIRS.local, `${id}.json`);
            const to = join(MISSION_DIRS.bundled, `${id}.json`);
            if (!existsSync(from)) return void res.writeHead(404).end('not found');
            if (existsSync(to)) return void res.writeHead(409).end('a bundled mission with that id exists');
            writeFileSync(to, `${JSON.stringify(JSON.parse(readFileSync(from, 'utf8')), null, 2)}\n`);
            rmSync(from);
            return void json(res, { ok: true, path: relative(root, to) });
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