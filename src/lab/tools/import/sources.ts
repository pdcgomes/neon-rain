/**
 * Getting Syndicate data into the browser: from the dev server's content-local/ folder, a picked
 * folder, or a drag-and-drop, then cached in IndexedDB so it only has to be done once. The files
 * never leave the machine.
 */
import { SyndDataset, type DatasetInfo } from '../../../import/syndicate/dataset.ts';

/** Only the files the importer reads (English briefings; MISS1xx..4xx are translations). */
const WANTED = /^(GAME\d\d|MAP\d\d|COL01|MISS\d\d)\.DAT$/i;

export interface StoredDataset {
  info: DatasetInfo;
  files: [string, Uint8Array][];
}

const DB = 'lab-synd-import';
const STORE = 'datasets';

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function cacheDatasets(sets: StoredDataset[]): Promise<void> {
  const d = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = d.transaction(STORE, 'readwrite');
    const st = tx.objectStore(STORE);
    st.clear();
    for (const s of sets) st.put(s, s.info.key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function cachedDatasets(): Promise<StoredDataset[]> {
  try {
    const d = await db();
    return await new Promise((resolve, reject) => {
      const r = d.transaction(STORE).objectStore(STORE).getAll();
      r.onsuccess = () => resolve(r.result as StoredDataset[]);
      r.onerror = () => reject(r.error);
    });
  } catch {
    return [];
  }
}

export async function clearCache(): Promise<void> {
  await cacheDatasets([]);
}

/** Groups loose files by folder and keeps the folders that hold a dataset (first of each kind wins). */
function toDatasets(files: { path: string; data: () => Promise<Uint8Array> }[]): Promise<StoredDataset[]> {
  const byDir = new Map<string, typeof files>();
  for (const f of files) {
    const dir = f.path.split('/').slice(0, -1).join('/');
    (byDir.get(dir) ?? byDir.set(dir, []).get(dir)!).push(f);
  }
  const out: Promise<StoredDataset>[] = [];
  const seen = new Set<string>();
  for (const [dir, list] of [...byDir].sort((a, b) => a[0].length - b[0].length)) {
    const names = list.map((f) => f.path.split('/').pop()!);
    if (!SyndDataset.looksLikeData(names)) continue;
    const info = SyndDataset.infoForPath(dir);
    if (seen.has(info.key)) continue;
    seen.add(info.key);
    out.push(
      Promise.all(list.filter((f) => WANTED.test(f.path.split('/').pop()!)).map(async (f) => [f.path.split('/').pop()!.toUpperCase(), await f.data()] as [string, Uint8Array])).then((fs) => ({ info, files: fs })),
    );
  }
  return Promise.all(out);
}

/** content-local/ via the dev server. */
export async function fromDevServer(progress: (done: number, total: number) => void): Promise<StoredDataset[]> {
  const folders = (await (await fetch('/__lab/synd/folders')).json()) as { dir: string; files: string[] }[];
  // Pick one folder per dataset from the listing (SB16/ holds a duplicate copy), then fetch only its wanted files.
  const chosen = new Set<string>();
  const seen = new Set<string>();
  for (const f of folders.sort((a, b) => a.dir.length - b.dir.length)) {
    if (!SyndDataset.looksLikeData(f.files)) continue;
    const key = SyndDataset.infoForPath(f.dir).key;
    if (seen.has(key)) continue;
    seen.add(key);
    chosen.add(f.dir);
  }
  const wanted = folders.filter((f) => chosen.has(f.dir)).flatMap((f) => f.files.filter((n) => WANTED.test(n)).map((n) => `${f.dir}/${n}`));
  let done = 0;
  const cache = new Map<string, Uint8Array>();
  const queue = [...wanted];
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      for (let p = queue.shift(); p; p = queue.shift()) {
        const r = await fetch(`/__lab/synd/file?path=${encodeURIComponent(p)}`);
        cache.set(p, new Uint8Array(await r.arrayBuffer()));
        progress(++done, wanted.length);
      }
    }),
  );
  return toDatasets(
    folders.filter((f) => chosen.has(f.dir)).flatMap((f) => f.files.map((n) => ({ path: `${f.dir}/${n}`, data: async () => cache.get(`${f.dir}/${n}`) ?? new Uint8Array() }))),
  );
}

/** An <input type=file webkitdirectory> selection. */
export function fromFileList(list: FileList): Promise<StoredDataset[]> {
  return toDatasets([...list].map((f) => ({ path: (f as File & { webkitRelativePath: string }).webkitRelativePath || f.name, data: async () => new Uint8Array(await f.arrayBuffer()) })));
}

/** A drag-and-drop of folders and/or files. */
export async function fromDrop(dt: DataTransfer): Promise<StoredDataset[]> {
  const files: { path: string; data: () => Promise<Uint8Array> }[] = [];
  const walk = async (entry: FileSystemEntry, path: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
      files.push({ path: `${path}${entry.name}`, data: async () => new Uint8Array(await file.arrayBuffer()) });
      return;
    }
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
      if (!batch.length) break;
      for (const e of batch) await walk(e, `${path}${entry.name}/`);
    }
  };
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry()).filter((e): e is FileSystemEntry => !!e);
  for (const e of entries) await walk(e, '');
  return toDatasets(files);
}
