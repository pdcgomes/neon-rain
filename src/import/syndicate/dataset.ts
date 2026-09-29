/**
 * A Syndicate DATA folder as a set of named files, with parsed and cached views. Used by the Lab's
 * Import tool (files dropped into the browser) and by the CLI (files read from disk).
 */
import { convertMission, DEFAULT_CONVERT, type ConvertOptions, type ConvertResult } from './convert.ts';
import { parseGame, type SyndGame } from './gameFile.ts';
import { parseMap, type SyndMap } from './mapFile.ts';
import { parseBriefing, type SyndBriefing } from './missFile.ts';
import { unrnc } from './rnc.ts';
import { defaultTileTable } from './tileClasses.ts';

export interface DatasetInfo {
  /** 'syndicate' for the original campaign, 'revolt' for the American Revolt data disk. */
  key: string;
  label: string;
}

export interface MissionSummary {
  mission: number;
  mapId: number;
  title: string;
  kind: string;
  multiplayer: boolean;
  people: number;
  objectives: string[];
}

const pad2 = (n: number) => String(n).padStart(2, '0');

export class SyndDataset {
  readonly info: DatasetInfo;
  private files = new Map<string, Uint8Array>();
  private games = new Map<number, SyndGame>();
  private maps = new Map<number, SyndMap>();
  private colCache: Uint8Array | null = null;

  /** `files` maps file names (any case) to their raw bytes. */
  constructor(files: Map<string, Uint8Array> | [string, Uint8Array][], info?: DatasetInfo) {
    for (const [name, data] of files) this.files.set(name.toUpperCase().split(/[\\/]/).pop()!, data);
    this.info = info ?? { key: 'syndicate', label: 'Syndicate' };
  }

  /** A folder is a usable dataset when it has the tile types and at least one mission. */
  static looksLikeData(names: string[]): boolean {
    const up = new Set(names.map((n) => n.toUpperCase().split(/[\\/]/).pop()!));
    return up.has('COL01.DAT') && [...up].some((n) => /^GAME\d\d\.DAT$/.test(n)) && [...up].some((n) => /^MAP\d\d\.DAT$/.test(n));
  }

  /** Dataset identity from its folder path: the data disk lives under DATADISK/. */
  static infoForPath(path: string): DatasetInfo {
    return /datadisk/i.test(path) ? { key: 'revolt', label: 'American Revolt' } : { key: 'syndicate', label: 'Syndicate' };
  }

  has(name: string): boolean {
    return this.files.has(name.toUpperCase());
  }

  raw(name: string): Uint8Array {
    const d = this.files.get(name.toUpperCase());
    if (!d) throw new Error(`Missing ${name}`);
    return unrnc(d);
  }

  missions(): number[] {
    return [...this.files.keys()]
      .map((n) => /^GAME(\d\d)\.DAT$/.exec(n)?.[1])
      .filter((n): n is string => !!n)
      .map(Number)
      .filter((n) => this.game(n) !== null && this.has(`MAP${pad2(this.game(n)!.mapId)}.DAT`))
      .sort((a, b) => a - b);
  }

  col(): Uint8Array {
    return (this.colCache ??= this.raw('COL01.DAT'));
  }

  game(n: number): SyndGame | null {
    if (!this.games.has(n)) {
      try {
        this.games.set(n, parseGame(this.raw(`GAME${pad2(n)}.DAT`)));
      } catch {
        return null;
      }
    }
    return this.games.get(n)!;
  }

  map(id: number): SyndMap {
    if (!this.maps.has(id)) this.maps.set(id, parseMap(this.raw(`MAP${pad2(id)}.DAT`)));
    return this.maps.get(id)!;
  }

  /** English briefing (MISSxx; MISS1xx..4xx are the French, German, Italian and Spanish versions). */
  briefing(n: number): SyndBriefing | null {
    const name = `MISS${pad2(n)}.DAT`;
    return this.has(name) ? parseBriefing(this.raw(name)) : null;
  }

  summary(n: number): MissionSummary {
    const g = this.game(n)!;
    const b = this.briefing(n);
    return {
      mission: n,
      mapId: g.mapId,
      title: b?.title ?? (n >= 90 ? `Multiplayer ${n - 89}` : `Mission ${n}`),
      kind: b?.kind ?? '',
      multiplayer: n >= 90,
      people: g.people.filter((p) => p.onMap).length,
      objectives: g.objectives.map((o) => o.kind),
    };
  }

  convert(n: number, opts?: Partial<ConvertOptions>): ConvertResult {
    const game = this.game(n);
    if (!game) throw new Error(`Mission ${n} not found`);
    const full: ConvertOptions = { ...DEFAULT_CONVERT, tiles: defaultTileTable(), ...opts };
    const res = convertMission({ mission: n, game, map: this.map(game.mapId), col: this.col(), briefing: this.briefing(n) }, full);
    if (this.info.key !== 'syndicate') {
      res.mission.id = `${this.info.key}_${pad2(n)}`;
      res.mission.city = res.mission.city.replace('Syndicate', this.info.label);
    }
    // American Revolt's enemies "react at least twice as fast as anything encountered before".
    if (this.info.key === 'revolt') res.mission.enemyReaction = 0.5;
    return res;
  }
}
