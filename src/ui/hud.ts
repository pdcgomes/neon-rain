import type { Controls } from '../input/controls.ts';
import { currentObjective, missionOver, targetCanEscape } from '../sim/systems/objectives.ts';
import type { Entity, SimEvent } from '../sim/types.ts';
import type { World } from '../sim/world.ts';
import { Minimap } from './minimap.ts';

const WEAPON_KEYS = ['Z', 'X', 'C', 'V'];
const IPA: { key: 'a' | 'p' | 'i'; label: string; title: string }[] = [
  { key: 'a', label: 'ADR', title: 'Adrenaline: speed and rate of fire' },
  { key: 'p', label: 'PER', title: 'Perception: auto-targeting range' },
  { key: 'i', label: 'INT', title: 'Intelligence: accuracy' },
];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

interface Card {
  root: HTMLDivElement;
  hp: HTMLDivElement;
  hpText: HTMLSpanElement;
  weapon: HTMLSpanElement;
  team: HTMLSpanElement;
  ipa: Record<'a' | 'p' | 'i', HTMLDivElement>;
}

export class Hud {
  private root: HTMLElement;
  private world: World;
  private controls: Controls;
  private cards = new Map<number, Card>();
  private objective: HTMLDivElement;
  private timer: HTMLDivElement;
  private heat: HTMLDivElement;
  private heatLabel: HTMLDivElement;
  private log: HTMLDivElement;
  private banner: HTMLDivElement;
  private weapons: HTMLDivElement;
  private stats: HTMLDivElement;
  private overdrive: HTMLDivElement;
  private minimap: Minimap;
  private statsOn = false;
  private bannerUntil = 0;
  private fps = 0;
  private scale = 1;

  constructor(root: HTMLElement, world: World, controls: Controls) {
    this.root = root;
    this.world = world;
    this.controls = controls;
    root.innerHTML = '';

    const squad = el('div', 'squad');
    for (const a of world.agents()) squad.appendChild(this.makeCard(a));

    const top = el('div', 'topbar');
    this.objective = el('div', 'objective');
    this.timer = el('div', 'timer');
    const heatWrap = el('div', 'heat');
    this.heatLabel = el('div', 'heat-label', 'CALM');
    const heatBar = el('div', 'heat-bar');
    this.heat = el('div', 'heat-fill');
    heatBar.appendChild(this.heat);
    heatWrap.append(this.heatLabel, heatBar);
    top.append(this.objective, this.timer, heatWrap);

    this.minimap = new Minimap(world);
    const mapWrap = el('div', 'map-wrap');
    mapWrap.appendChild(this.minimap.el);

    this.weapons = el('div', 'weapons');
    this.log = el('div', 'comms');
    this.banner = el('div', 'banner');
    this.stats = el('div', 'stats hidden');
    this.overdrive = el('div', 'overdrive-tag', 'NEURAL OVERDRIVE');

    const help = el('div', 'help');
    help.innerHTML = [
      '<b>LMB</b> move / hold to steer',
      '<b>RMB</b> fire at cursor',
      '<b>LMB+RMB</b> grenade',
      '<b>1-4</b> agent · <b>Tab</b> all · <b>G</b> split · <b>T</b> team',
      '<b>Z X C V</b> weapons · <b>H</b> holster',
      '<b>Space</b> overdrive · <b>WASD</b> pan · <b>F</b> reset view',
      '<b>MMB/Alt+drag</b> orbit · <b>Q/E</b> rotate · <b>Shift+wheel</b> pitch · <b>Y</b> top-down',
    ].join('<br>');

    root.append(squad, top, mapWrap, this.weapons, this.log, this.banner, this.stats, this.overdrive, help);
    this.announce(currentObjective(world)?.text ?? world.content.mission.objectives[0]?.text ?? '');
  }

  private makeCard(a: Entity): HTMLDivElement {
    const root = el('div', 'card');
    const head = el('div', 'card-head');
    const num = el('span', 'card-num', String(a.slot + 1));
    const name = el('span', 'card-name', a.name.toUpperCase());
    const team = el('span', 'card-team', 'A');
    head.append(num, name, team);
    const hpBar = el('div', 'hp');
    const hp = el('div', 'hp-fill');
    const hpText = el('span', 'hp-text');
    hpBar.append(hp, hpText);
    const weapon = el('span', 'card-weapon');
    const ipaWrap = el('div', 'ipa');
    const ipa = {} as Record<'a' | 'p' | 'i', HTMLDivElement>;
    for (const ch of IPA) {
      const row = el('div', `ipa-row ipa-${ch.key}`);
      row.title = ch.title;
      const label = el('span', 'ipa-label', ch.label);
      const track = el('div', 'ipa-track');
      const fill = el('div', 'ipa-fill');
      track.appendChild(fill);
      row.append(label, track);
      ipaWrap.appendChild(row);
      ipa[ch.key] = fill;
      const setFrom = (ev: PointerEvent) => {
        const r = track.getBoundingClientRect();
        const v = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
        this.controls.setIpa(ch.key, v, [a.id]);
        fill.style.width = `${v * 100}%`;
      };
      track.addEventListener('pointerdown', (ev) => {
        ev.stopPropagation();
        track.setPointerCapture(ev.pointerId);
        setFrom(ev);
        const move = (e2: PointerEvent) => setFrom(e2);
        const up = () => {
          track.removeEventListener('pointermove', move);
          track.removeEventListener('pointerup', up);
        };
        track.addEventListener('pointermove', move);
        track.addEventListener('pointerup', up);
      });
    }
    root.append(head, hpBar, weapon, ipaWrap);
    root.addEventListener('mousedown', (ev) => {
      if ((ev.target as HTMLElement).closest('.ipa-track')) return;
      this.controls.selectSlot(a.slot, ev.shiftKey);
    });
    this.cards.set(a.id, { root, hp, hpText, weapon, team, ipa });
    return root;
  }

  show(on: boolean): void {
    this.root.classList.toggle('hidden', !on);
  }

  toggleStats(): void {
    this.statsOn = !this.statsOn;
    this.stats.classList.toggle('hidden', !this.statsOn);
  }

  private announce(text: string): void {
    this.banner.textContent = text;
    this.banner.classList.add('on');
    this.bannerUntil = performance.now() + 3200;
  }

  private chatter(text: string, tone: string): void {
    const line = el('div', `comm comm-${tone}`);
    const who = { police: 'SPD', enemy: 'INTERCEPT', hq: 'EUROCORP', civ: 'CIV' }[tone] ?? 'COMM';
    line.innerHTML = `<span class="who">${who}</span> ${text}`;
    this.log.appendChild(line);
    while (this.log.children.length > 5) this.log.firstChild?.remove();
    setTimeout(() => line.classList.add('old'), 7000);
  }

  onEvents(events: readonly SimEvent[]): void {
    for (const ev of events) {
      if (ev.t === 'bark') this.chatter(ev.text, ev.tone);
      else if (ev.t === 'objective') this.announce(ev.text);
      else if (ev.t === 'persuaded') {
        const e = this.world.get(ev.id);
        if (e && e.kind === 'guard' && this.world.content.mission.bonus) this.chatter(`Bodyguard persuaded (${this.world.stats.guardsPersuaded}/${this.world.content.mission.population.guards}).`, 'hq');
      } else if (ev.t === 'mission') this.announce(ev.result === 'success' ? 'MISSION ACCOMPLISHED' : 'MISSION FAILED');
    }
  }

  update(fps: number, scale: number, cam: { yaw: number; x: number; z: number }): void {
    const w = this.world;
    this.fps = fps;
    this.scale = scale;
    const sel = this.controls.selected;

    for (const a of w.agents()) {
      const c = this.cards.get(a.id);
      if (!c) continue;
      const hp = Math.max(0, a.hp / a.maxHp);
      c.root.classList.toggle('selected', sel.has(a.id));
      c.root.classList.toggle('dead', !a.alive);
      c.root.classList.toggle('bravo', a.team === 1);
      c.root.classList.toggle('od', a.overdrive);
      c.hp.style.width = `${hp * 100}%`;
      c.hp.classList.toggle('low', hp < 0.35);
      c.hpText.textContent = a.alive ? String(Math.ceil(a.hp)) : 'KIA';
      c.team.textContent = a.team === 0 ? 'ALPHA' : 'BRAVO';
      const wd = w.weapon(a);
      c.weapon.textContent = !a.alive ? 'SIGNAL LOST' : a.holstered ? `${wd?.name ?? ''} · HOLSTERED` : (wd?.name ?? '').toUpperCase();
      c.weapon.classList.toggle('drawn', a.alive && !a.holstered);
      for (const ch of IPA) c.ipa[ch.key].style.width = `${(a.overdrive ? 1 : a.ipa[ch.key]) * 100}%`;
    }

    // Weapon bar for the lead selected agent.
    const lead = w.agents().find((a) => sel.has(a.id) && a.alive);
    if (lead) {
      const html = lead.weapons
        .map((id, i) => {
          const d = w.content.weapons[id];
          const on = i === lead.weaponIdx && !lead.holstered;
          return `<div class="wslot ${on ? 'on' : ''}" data-slot="${i}"><span class="key">${WEAPON_KEYS[i] ?? ''}</span>${d.name}</div>`;
        })
        .join('');
      const grenades = w.agents().filter((a) => sel.has(a.id) && a.alive).reduce((s, a) => s + a.grenades, 0);
      const next = `${html}<div class="wslot grenade"><span class="key">L+R</span>Grenades ×${grenades}</div>`;
      if (this.weapons.innerHTML !== next) {
        this.weapons.innerHTML = next;
        this.weapons.querySelectorAll<HTMLDivElement>('.wslot[data-slot]').forEach((d) =>
          d.addEventListener('mousedown', () => this.controls.weapon(Number(d.dataset.slot))),
        );
      }
    }

    const m = w.content.mission;
    let obj: string;
    const cur = currentObjective(w);
    if (missionOver(w)) obj = w.phase === 'success' ? 'Mission accomplished' : 'Mission failed';
    else obj = `${cur?.text ?? ''}${targetCanEscape(w) && w.alarm ? ' · TARGET FLEEING' : ''}`;
    const bonus = m.bonus ? `${m.bonus.text} ${w.stats.guardsPersuaded}/${m.population.guards}` : '';
    const objHtml = `<span class="obj-main">${obj}</span>${bonus ? `<span class="obj-bonus">${bonus}</span>` : ''}`;
    if (this.objective.innerHTML !== objHtml) this.objective.innerHTML = objHtml;

    const t = Math.floor(w.time);
    this.timer.textContent = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;

    this.heat.style.width = `${w.heat}%`;
    const tier = w.heat >= m.enforcersAt ? 'ENFORCERS' : w.policeHostile ? 'HOSTILE' : w.heat > 12 ? 'SUSPICIOUS' : 'CALM';
    this.heatLabel.textContent = `POLICE · ${tier}`;
    this.heat.className = `heat-fill tier-${tier.toLowerCase()}`;

    this.overdrive.classList.toggle('on', w.timeScale < 1);
    if (performance.now() > this.bannerUntil) this.banner.classList.remove('on');

    this.minimap.draw(w, cam.yaw, cam.x, cam.z, performance.now() / 1000);

    if (this.statsOn) {
      this.stats.textContent = `${this.fps.toFixed(0)} fps · render scale ${(this.scale * 100).toFixed(0)}% · ${w.entities.length} entities · tick ${w.tick} · #${w.checksum().toString(16)}`;
    }
  }
}
