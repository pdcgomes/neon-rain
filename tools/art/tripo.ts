/**
 * Tripo 3D pipeline: prompt / reference images -> model -> (voxel stylise) -> rig -> animations,
 * saved into public/lab/assets/tripo and registered in public/lab/manifest.json.
 *
 *   npm run art:tripo -- balance
 *   npm run art:tripo -- make agent --style lowpoly --from multiview --rig
 *   npm run art:tripo -- make agent --style voxel --from text --rig --anims idle,walk,run
 *   npm run art:tripo -- make police --dry-run
 *
 * Needs TRIPO_API_KEY in .env.local. Task ids are logged to tools/art/tripo-log.json, so an
 * interrupted run resumes from the last finished stage instead of paying twice.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRESETS, type Preset } from './presets.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const API = 'https://api.tripo3d.ai/v2/openapi';
const LAB = resolve(ROOT, 'public/lab');
const OUT = resolve(LAB, 'assets/tripo');
const LOG = resolve(ROOT, 'tools/art/tripo-log.json');

/** Tripo's preset animations, mapped onto the lab's clip catalogue. */
const ANIMS: Record<string, string> = {
  idle: 'preset:idle',
  walk: 'preset:walk',
  run: 'preset:run',
  shoot: 'preset:shoot',
  hurt: 'preset:hurt',
  fall: 'preset:fall',
  jump: 'preset:jump',
  turn: 'preset:turn',
};
const ANIM_TO_CLIP: Record<string, string> = { idle: 'idle', walk: 'walk', run: 'run', shoot: 'shoot_smg', hurt: 'hit', fall: 'death_a' };

function readKey(): string {
  if (process.env.TRIPO_API_KEY) return process.env.TRIPO_API_KEY;
  const env = resolve(ROOT, '.env.local');
  if (existsSync(env)) {
    for (const line of readFileSync(env, 'utf8').split('\n')) {
      const m = line.match(/^\s*TRIPO_API_KEY\s*=\s*(.+?)\s*$/);
      if (m) return m[1].replace(/^['"]|['"]$/g, '');
    }
  }
  throw new Error('TRIPO_API_KEY missing (set it in .env.local)');
}

interface Args {
  cmd: string;
  preset: string;
  style: 'lowpoly' | 'voxel';
  from: 'text' | 'image' | 'multiview';
  rig: boolean;
  anims: string[];
  dry: boolean;
  faces: number;
  block: number;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { cmd: argv[0] ?? 'help', preset: argv[1] ?? 'agent', style: 'lowpoly', from: 'text', rig: false, anims: ['idle', 'walk', 'run', 'shoot', 'hurt'], dry: false, faces: 6000, block: 56 };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === '--style') (a.style = v as Args['style']), i++;
    else if (k === '--from') (a.from = v as Args['from']), i++;
    else if (k === '--rig') a.rig = true;
    else if (k === '--anims') (a.anims = v.split(',').filter(Boolean)), i++;
    else if (k === '--faces') (a.faces = Number(v)), i++;
    else if (k === '--block') (a.block = Number(v)), i++;
    else if (k === '--dry-run') a.dry = true;
  }
  return a;
}

class Tripo {
  private key: string;
  dry: boolean;
  constructor(key: string, dry: boolean) {
    this.key = key;
    this.dry = dry;
  }

  private async req(path: string, init: RequestInit = {}): Promise<any> {
    const res = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${this.key}`, ...(init.headers ?? {}) } });
    const body = (await res.json().catch(() => ({}))) as { code?: number; message?: string; suggestion?: string; data?: unknown };
    if (!res.ok || body.code !== 0) throw new Error(`Tripo ${path}: ${res.status} ${body.code ?? ''} ${body.message ?? ''} ${body.suggestion ?? ''}`.trim());
    return body.data;
  }

  balance(): Promise<{ balance: number; frozen: number }> {
    return this.req('/user/balance');
  }

  async upload(file: string): Promise<string> {
    if (this.dry) return `dry-token:${file}`;
    const form = new FormData();
    form.append('file', new Blob([readFileSync(file)], { type: 'image/jpeg' }), file.split('/').pop());
    const d = await this.req('/upload', { method: 'POST', body: form });
    return d.image_token as string;
  }

  async task(payload: Record<string, unknown>): Promise<string> {
    if (this.dry) {
      console.log('  [dry-run] POST /task', JSON.stringify(payload));
      return `dry-${payload.type}`;
    }
    const d = await this.req('/task', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    return d.task_id as string;
  }

  async wait(id: string, label: string): Promise<any> {
    if (this.dry) return { output: {} };
    let last = -1;
    for (;;) {
      const d = await this.req(`/task/${id}`);
      if (d.progress !== last) {
        process.stdout.write(`\r  ${label}: ${d.status} ${d.progress ?? 0}%   `);
        last = d.progress;
      }
      if (d.status === 'success') {
        process.stdout.write('\n');
        return d;
      }
      if (['failed', 'banned', 'expired', 'cancelled', 'unknown'].includes(d.status)) throw new Error(`${label} ${d.status}: ${JSON.stringify(d)}`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

type Log = Record<string, Record<string, string>>;
const readLog = (): Log => (existsSync(LOG) ? (JSON.parse(readFileSync(LOG, 'utf8')) as Log) : {});
const writeLog = (l: Log) => writeFileSync(LOG, `${JSON.stringify(l, null, 2)}\n`);

async function download(url: string, file: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${url}: ${res.status}`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  console.log(`  saved ${file.replace(`${ROOT}/`, '')}`);
}

function modelUrl(task: any): string | undefined {
  const o = task.output ?? {};
  return o.pbr_model ?? o.model ?? o.base_model;
}

function upsertManifest(entry: Record<string, unknown>): void {
  const path = resolve(LAB, 'manifest.json');
  const m = JSON.parse(readFileSync(path, 'utf8')) as { assets: { id: string }[] };
  const i = m.assets.findIndex((a) => a.id === entry.id);
  if (i >= 0) m.assets[i] = entry as { id: string };
  else m.assets.push(entry as { id: string });
  writeFileSync(path, `${JSON.stringify(m, null, 2)}\n`);
}

async function make(t: Tripo, a: Args, p: Preset): Promise<void> {
  const tag = `${a.preset}_${a.style}_${a.from}`;
  const log = readLog();
  const done = (log[tag] ??= {});
  const stage = async (name: string, payload: () => Promise<Record<string, unknown>>) => {
    if (done[name] && !a.dry) {
      console.log(`  ${name}: reusing task ${done[name]}`);
      return { id: done[name], task: await t.wait(done[name], name) };
    }
    const id = await t.task(await payload());
    if (!a.dry) {
      done[name] = id;
      writeLog(log);
    }
    return { id, task: await t.wait(id, name) };
  };

  // 1. Generate the base model.
  const lowpoly = a.style === 'lowpoly';
  const common = { texture: true, pbr: true, face_limit: a.faces, smart_low_poly: lowpoly, auto_size: true };
  const subj = p.subject.replace(':', '_');
  // Style A references feed both styles: Style C is Tripo's voxel stylise on top of the base model.
  const ref = (view: string) => resolve(LAB, `assets/refs/${subj}_lowpoly_${view}.jpg`);
  const gen = await stage('generate', async () => {
    if (a.from === 'text') return { type: 'text_to_model', prompt: `${p.prompt}. ${lowpoly ? 'Stylized low poly, flat shaded facets.' : 'Blocky stylized proportions.'}`, ...common };
    if (a.from === 'image') return { type: 'image_to_model', file: { type: 'jpg', file_token: await t.upload(ref('front')) }, ...common };
    const files = [];
    for (const v of ['front', 'left', 'back', 'right']) files.push({ type: 'jpg', file_token: await t.upload(ref(v)) });
    return { type: 'multiview_to_model', files, ...common };
  });
  let modelTask = gen.id;

  // 2. Style C: Tripo's voxel stylisation on top of the base model.
  if (a.style === 'voxel') {
    const sty = await stage('stylize', async () => ({ type: 'stylize_model', style: 'minecraft', block_size: a.block, original_model_task_id: gen.id }));
    modelTask = sty.id;
    const url = modelUrl(sty.task);
    if (url) await download(url, resolve(OUT, `${a.preset}_${a.style}.glb`));
  } else {
    const url = modelUrl(gen.task);
    if (url) await download(url, resolve(OUT, `${a.preset}_${a.style}.glb`));
  }

  const entry: Record<string, unknown> = {
    id: `tripo-${a.preset}-${a.style}`,
    name: `${p.name} · Tripo ${a.style === 'voxel' ? 'C' : 'A'}`,
    file: `assets/tripo/${a.preset}_${a.style}.glb`,
    category: 'character',
    kind: p.kind,
    height: p.height,
    source: `Tripo ${a.from}-to-3D${a.style === 'voxel' ? ' + voxel stylise' : ''}`,
  };

  // 3. Rig (Mixamo skeleton) and retarget preset animations.
  if (a.rig) {
    const check = await stage('prerigcheck', async () => ({ type: 'animate_prerigcheck', original_model_task_id: modelTask }));
    if (!a.dry && check.task.output?.riggable === false) {
      console.log('  model is not riggable, keeping the static version');
    } else {
      const rig = await stage('rig', async () => ({ type: 'animate_rig', original_model_task_id: modelTask, out_format: 'glb', spec: 'mixamo' }));
      const rigUrl = modelUrl(rig.task);
      if (rigUrl) await download(rigUrl, resolve(OUT, `${a.preset}_${a.style}_rigged.glb`));
      entry.file = `assets/tripo/${a.preset}_${a.style}_rigged.glb`;
      const extra: { file: string; clip: string }[] = [];
      for (const anim of a.anims) {
        if (!ANIMS[anim]) continue;
        const r = await stage(`anim_${anim}`, async () => ({ type: 'animate_retarget', original_model_task_id: rig.id, out_format: 'glb', animation: ANIMS[anim], bake_animation: true }));
        const url = modelUrl(r.task);
        const f = `assets/tripo/${a.preset}_${a.style}_${anim}.glb`;
        if (url) await download(url, resolve(LAB, f));
        extra.push({ file: f, clip: ANIM_TO_CLIP[anim] ?? anim });
      }
      entry.extraAnimations = extra;
      entry.source = `${entry.source} + Mixamo rig`;
    }
  }
  if (!a.dry) upsertManifest(entry);
  console.log(a.dry ? '  dry run: nothing created' : `  registered ${entry.id} in public/lab/manifest.json`);
}

async function main(): Promise<void> {
  const a = parseArgs(process.argv.slice(2));
  const t = new Tripo(readKey(), a.dry);
  if (a.cmd === 'balance') {
    console.log(await t.balance());
    return;
  }
  if (a.cmd === 'presets') {
    for (const [k, p] of Object.entries(PRESETS)) console.log(`${k.padEnd(10)} ${p.name}`);
    return;
  }
  if (a.cmd === 'make') {
    const p = PRESETS[a.preset];
    if (!p) throw new Error(`Unknown preset '${a.preset}'. Try: ${Object.keys(PRESETS).join(', ')}`);
    if (!a.dry) {
      const b = await t.balance();
      console.log(`Tripo balance: ${b.balance} credits`);
      if (b.balance <= 0) throw new Error('No Tripo credits left. Top up at https://platform.tripo3d.ai and re-run (finished stages are reused).');
    }
    console.log(`Making ${p.name} (${a.style}, from ${a.from}${a.rig ? ', rigged' : ''})`);
    await make(t, a, p);
    return;
  }
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
}

main().catch((e: Error) => {
  console.error(`\n${e.message}`);
  process.exit(1);
});
