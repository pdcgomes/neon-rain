/** Finds Syndicate DATA folders on disk and loads them as datasets. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { SyndDataset } from '../../src/import/syndicate/dataset.ts';

export function findDataFolders(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    if (SyndDataset.looksLikeData(names)) out.push(dir);
    if (depth > 5) return;
    for (const n of names) {
      const p = join(dir, n);
      try {
        if (statSync(p).isDirectory()) walk(p, depth + 1);
      } catch {
        /* unreadable */
      }
    }
  };
  walk(root, 0);
  return out;
}

export function loadDataset(dir: string, root = dir): SyndDataset {
  const files = readdirSync(dir)
    .filter((n) => /\.(DAT|TAB|ANI)$/i.test(n))
    .map((n) => [n, new Uint8Array(readFileSync(join(dir, n)))] as [string, Uint8Array]);
  return new SyndDataset(files, SyndDataset.infoForPath(relative(root, dir) || dir));
}
