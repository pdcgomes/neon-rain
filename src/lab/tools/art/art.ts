import * as THREE from 'three';
import { AnimOverlays } from '../../anim/overlays.ts';
import { AnimPlayer } from '../../anim/player.ts';
import { Timeline } from '../../anim/timeline.ts';
import { castMotionBoard, clipGridBoard, gameScaleBoard, treadmillBoard } from '../../boards/animation.ts';
import { castBoard, lineupBoard, referenceBoard } from '../../boards/characters.ts';
import { compareAC, compareAll } from '../../boards/compare.ts';
import { allPropsBoard, buildingsBoard, propBoards, signageBoard, streetBoard } from '../../boards/environment.ts';
import { importedBoard, importedOverview } from '../../boards/imported.ts';
import { baselineKit } from '../../kits/baseline.ts';
import { addDropped, importedEntries, importedKit, loadManifest } from '../../kits/imported.ts';
import { lowpolyKit } from '../../kits/lowpoly.ts';
import { buildingUniforms } from '../../kits/shared.ts';
import type { StyleId, StyleKit } from '../../kits/types.ts';
import { voxelKit } from '../../kits/voxel.ts';
import { DEFAULT_CHARACTERS, DEFAULT_PROPS, exportCharacter, exportProp, type CharacterJob, type PropJob } from '../../export/models.ts';
import { Inspector } from '../../shell/inspector.ts';
import { Registry, type BoardItem, type BoardResult } from '../../shell/registry.ts';
import { Sidebar } from '../../shell/sidebar.ts';
import { Toolbar } from '../../shell/toolbar.ts';
import type { LabTool, ToolContext } from '../../shell/tools.ts';
import type { Stage } from '../../stage.ts';
import { readState, writeState, type LabState } from '../../state.ts';
import { Viewport, type Pickable } from '../../viewport.ts';

const kits: Record<StyleId, StyleKit> = { baseline: baselineKit, lowpoly: lowpolyKit, voxel: voxelKit, imported: importedKit };
const STYLE_ORDER: StyleId[] = ['baseline', 'lowpoly', 'voxel', 'imported'];

const LAYOUT = `
  <div id="lab">
    <aside id="sidebar"></aside>
    <main id="center">
      <header id="toolbar"></header>
      <section id="viewport">
        <div id="labels"></div>
        <div id="board-title"></div>
        <div id="drop-hint">Drop .glb / .gltf / .vox files to preview them</div>
      </section>
      <footer id="timeline"></footer>
    </main>
    <aside id="inspector"></aside>
  </div>`;

interface Art {
  activate(ctx: ToolContext): void;
  deactivate(): void;
  onKey(e: KeyboardEvent): void;
}

/** The Style Lab boards: characters, environment, props, animation, comparisons and imported assets. */
function build(root: HTMLElement, stage: Stage): Art {
  root.innerHTML = LAYOUT;
  const state: LabState = readState();
  const urlHadView = new URLSearchParams(location.search).has('view');
  const urlHadCam = !!state.cam;

  const registry = new Registry();
  for (const g of ['agents', 'rivals', 'law', 'civilians']) registry.add(castBoard(g));
  registry.add(lineupBoard);
  registry.add(referenceBoard);
  registry.add(buildingsBoard);
  registry.add(signageBoard);
  registry.add(streetBoard);
  registry.add(allPropsBoard);
  for (const b of propBoards) registry.add(b);
  registry.add(clipGridBoard);
  registry.add(castMotionBoard);
  registry.add(treadmillBoard);
  registry.add(gameScaleBoard);
  registry.add(compareAC);
  registry.add(compareAll);

  const labEl = root.querySelector<HTMLElement>('#lab')!;
  const canvas = stage.canvas;
  const viewportEl = root.querySelector<HTMLElement>('#viewport')!;
  const labelsEl = root.querySelector<HTMLElement>('#labels')!;
  const titleEl = root.querySelector<HTMLElement>('#board-title')!;
  viewportEl.prepend(canvas);

  const anim = new AnimPlayer();
  const overlays = new AnimOverlays();
  stage.scene.add(overlays.group);
  const viewport = new Viewport(stage.camera, canvas, stage.scene);

  let current: BoardResult | null = null;
  let selected: BoardItem | null = null;
  let token = 0;
  let firstLoad = true;
  let readyResolve: () => void = () => {};
  let ready = new Promise<void>((r) => (readyResolve = r));
  let active = true;
  let raf = 0;
  /** Board content parked while another tool borrows the stage. */
  let parked: THREE.Object3D[] = [];

  const sidebar = new Sidebar(root.querySelector('#sidebar')!, registry);
  const toolbar = new Toolbar(root.querySelector('#toolbar')!, {
    style: (s) => change({ style: s }),
    light: (l) => change({ light: l }),
    view: (v) => change({ view: v }),
    frame: () => viewport.frameSelection(),
    toggleInspector: () => change({ inspector: !state.inspector }),
  });
  const inspector = new Inspector(root.querySelector('#inspector')!, {
    change: (p) => change(p),
    exportPNG,
    copyLink: () => {
      writeState(state);
      setTimeout(() => navigator.clipboard?.writeText(location.href), 300);
    },
  });
  const timeline = new Timeline(root.querySelector('#timeline')!, anim, {
    clip: (id) => change({ clip: id, cf: false }),
    change: (p) => change(p),
  });

  sidebar.onSelect = (id) => change({ board: id });
  viewport.onSelect = (p) => {
    selected = p ? current?.items.find((it) => it.id === p.id) ?? null : null;
    const entry = selected ? anim.entries.find((e) => e.target === selected!.asset.object) ?? null : null;
    overlays.setGhostTarget(entry);
    renderInspector();
  };
  viewport.onChange = () => {
    state.cam = viewport.serialize();
    writeState(state);
  };

  function renderInspector(): void {
    inspector.render(state, kits[state.style], current, selected, state.board);
  }

  function applyAnimState(): void {
    anim.speed = state.speed;
    anim.loop = state.loop;
    anim.playing = state.playing;
    anim.clip = state.clip;
    anim.crossfade.enabled = state.cf;
    anim.crossfade.a = state.cfa;
    anim.crossfade.b = state.cfb;
    anim.crossfade.blend = state.cfblend;
    timeline.sync();
  }

  function applyReview(): void {
    stage.setPreset(state.light);
    stage.setRain(state.rain);
    stage.setWet(state.wet);
    stage.setSilhouette(state.sil);
    const px = current?.pixel ?? state.px;
    stage.setPixel(px);
    labEl.classList.toggle('no-inspector', !state.inspector);
    overlays.skeleton = state.skel;
    overlays.contactsOn = state.contact;
    overlays.ghostsOn = state.ghost;
  }

  async function loadBoard(): Promise<void> {
    const my = ++token;
    ready = new Promise<void>((r) => (readyResolve = r));
    const def = registry.get(state.board) ?? registry.get('agents')!;
    state.board = def.id;
    sidebar.setCurrent(def.id);
    titleEl.innerHTML = `${def.title}<small>Loading…</small>`;
    anim.clear();
    const bctx = { kit: kits[state.style], kits, stage, anim, state };
    let result: BoardResult;
    try {
      result = await def.build(bctx);
    } catch (err) {
      console.error(err);
      titleEl.innerHTML = `${def.title}<small style="color:#ff453a">Failed to build: ${(err as Error).message}</small>`;
      readyResolve();
      return;
    }
    if (my !== token) return;
    if (!active) {
      parked = [result.group];
      current = result;
      readyResolve();
      return;
    }
    stage.content.clear();
    stage.content.add(result.group);
    current = result;
    selected = null;
    if (!firstLoad || !new URLSearchParams(location.search).has('clip')) {
      if (result.clip) state.clip = result.clip;
    }
    if (!(firstLoad && urlHadView)) state.view = result.view ?? 'threeq';
    applyAnimState();
    applyReview();
    anim.time = 0;
    if (firstLoad && state.t >= 0) {
      anim.playing = false;
      state.playing = false;
      anim.seek(state.t);
      timeline.sync();
    }
    anim.apply();
    overlays.rebuild(anim);
    overlays.setGhostTarget(null);
    timeline.enable(result.animated && anim.entries.length > 0);

    viewport.setBounds(result.bounds);
    viewport.setPickables(result.items.map<Pickable>((it) => ({ root: it.root, id: it.id })));
    stage.frame(result.bounds);
    stage.camera.zoom = 1;
    if (firstLoad && urlHadCam && viewport.restore(state.cam)) {
      /* restored from the link */
    } else viewport.applyPreset(state.view, state.view === result.view ? result.polar : undefined);
    if (result.zoom) {
      stage.camera.zoom = result.zoom;
      stage.camera.updateProjectionMatrix();
    }
    buildLabels(result);
    titleEl.innerHTML = `${def.title}<small>${result.subtitle ?? ''}</small>`;
    toolbar.set(state, def);
    renderInspector();
    writeState(state);
    firstLoad = false;
    readyResolve();
  }

  // ---------------------------------------------------------------- labels

  interface LabelEl {
    el: HTMLElement;
    pos: THREE.Vector3;
    item?: BoardItem;
  }
  let labels: LabelEl[] = [];

  function buildLabels(r: BoardResult): void {
    labelsEl.innerHTML = '';
    labels = [];
    for (const it of r.itemLabels === false ? [] : r.items) {
      const el = document.createElement('div');
      el.className = `lbl${it.asset.notes && /No imported|Unmapped/.test(it.asset.notes) ? ' warn' : ''}`;
      el.innerHTML = `${it.label}${it.sublabel ? `<small>${it.sublabel}</small>` : ''}`;
      labelsEl.appendChild(el);
      labels.push({ el, pos: new THREE.Vector3(), item: it });
    }
    for (const l of r.labels ?? []) {
      const el = document.createElement('div');
      el.className = `lbl${l.head ? ' head' : ''}`;
      el.innerHTML = `${l.text}${l.sub ? `<small>${l.sub}</small>` : ''}`;
      labelsEl.appendChild(el);
      labels.push({ el, pos: l.at.clone() });
    }
  }

  const proj = new THREE.Vector3();
  function updateLabels(): void {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    for (const l of labels) {
      if (l.item) {
        l.item.root.getWorldPosition(l.pos);
        l.pos.y += l.item.labelY;
        l.el.classList.toggle('sel', l.item === selected);
      }
      proj.copy(l.pos).project(stage.camera);
      const visible = proj.z < 1 && proj.x > -1.1 && proj.x < 1.1 && proj.y > -1.1 && proj.y < 1.1;
      l.el.style.display = visible ? '' : 'none';
      if (visible) {
        l.el.style.left = `${((proj.x + 1) / 2) * w}px`;
        l.el.style.top = `${((1 - proj.y) / 2) * h}px`;
      }
    }
  }

  // ---------------------------------------------------------------- state changes

  const REBUILD: (keyof LabState)[] = ['board', 'style', 'subject', 'weapon'];

  function change(patch: Partial<LabState>): void {
    const rebuild = REBUILD.some((k) => k in patch && patch[k] !== state[k]);
    Object.assign(state, patch);
    if (rebuild) {
      if ('board' in patch) state.cam = '';
      void loadBoard();
      return;
    }
    if ('view' in patch) {
      stage.camera.zoom = 1;
      viewport.applyPreset(state.view, state.view === current?.view ? current?.polar : undefined);
      if (current?.zoom && state.view === 'game') {
        stage.camera.zoom = current.zoom;
        stage.camera.updateProjectionMatrix();
      }
    }
    applyAnimState();
    applyReview();
    if ('skel' in patch || 'ghost' in patch) {
      overlays.rebuild(anim);
      const entry = selected ? anim.entries.find((e) => e.target === selected!.asset.object) ?? null : null;
      overlays.setGhostTarget(entry);
    }
    if ('clip' in patch || 'cf' in patch || 'cfa' in patch || 'cfb' in patch) anim.seek(0);
    if (current) toolbar.set(state, registry.get(state.board)!);
    renderInspector();
    writeState(state);
  }

  function exportPNG(): void {
    const url = stage.capturePNG(0, viewport.controls.target);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stylelab-${state.board}-${state.style}.png`;
    a.click();
  }

  // ---------------------------------------------------------------- input

  function onKey(e: KeyboardEvent): void {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    const mod = e.metaKey || e.ctrlKey;
    if (e.altKey && /^Digit[1-4]$/.test(e.code)) {
      e.preventDefault();
      change({ style: STYLE_ORDER[Number(e.code.slice(5)) - 1] });
      return;
    }
    if (mod && e.code === 'KeyF') {
      e.preventDefault();
      sidebar.focusSearch();
      return;
    }
    if (mod) return;
    switch (e.code) {
      case 'ArrowUp':
        e.preventDefault();
        sidebar.move(-1);
        break;
      case 'ArrowDown':
        e.preventDefault();
        sidebar.move(1);
        break;
      case 'ArrowLeft':
        sidebar.collapseCurrent(true);
        break;
      case 'ArrowRight':
        sidebar.collapseCurrent(false);
        break;
      case 'Space':
        e.preventDefault();
        change({ playing: !anim.playing });
        break;
      case 'Comma':
        anim.step(-1);
        state.playing = false;
        timeline.sync();
        break;
      case 'Period':
        anim.step(1);
        state.playing = false;
        timeline.sync();
        break;
      case 'KeyF':
        viewport.frameSelection();
        break;
      case 'KeyR':
        viewport.applyPreset(state.view, state.view === current?.view ? current?.polar : undefined);
        break;
      case 'KeyI':
        change({ inspector: !state.inspector });
        break;
      case 'KeyS':
        change({ sil: !state.sil });
        break;
      case 'KeyP':
        change({ px: state.px >= 4 ? 1 : state.px + 1 });
        break;
      case 'KeyT':
        change({ turn: !state.turn });
        break;
      case 'KeyK':
        change({ skel: !state.skel });
        break;
      case 'Slash':
        e.preventDefault();
        sidebar.focusSearch();
        break;
      case 'Escape':
        viewport.select(null);
        break;
    }
  }

  viewportEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    viewportEl.classList.add('dragging');
  });
  viewportEl.addEventListener('dragleave', () => viewportEl.classList.remove('dragging'));
  viewportEl.addEventListener('drop', (e) => {
    e.preventDefault();
    viewportEl.classList.remove('dragging');
    let last = '';
    for (const f of Array.from(e.dataTransfer?.files ?? [])) {
      if (!/\.(glb|gltf|fbx|vox)$/i.test(f.name)) continue;
      const entry = addDropped(f);
      const b = importedBoard(entry);
      registry.add(b);
      last = b.id;
    }
    sidebar.render();
    if (last) change({ board: last });
  });

  new ResizeObserver(() => {
    if (active) stage.resize();
  }).observe(viewportEl);

  // ---------------------------------------------------------------- loop

  let last = performance.now();
  let clock = 0;
  function frame(now: number): void {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    clock += dt;
    if (current) {
      if (current.animated) anim.tick(dt);
      current.update?.(dt, anim.time);
      if (state.turn && current.turntable) for (const it of current.items) it.spin.rotation.y += dt * 0.6;
    }
    overlays.update(anim);
    viewport.update();
    viewport.updateHighlights();
    buildingUniforms.uTime.value = clock;
    stage.render(dt, viewport.controls.target);
    updateLabels();
    timeline.update();
  }

  // ---------------------------------------------------------------- boot

  async function boot(): Promise<void> {
    await loadManifest();
    registry.add(importedOverview);
    for (const e of importedEntries()) registry.add(importedBoard(e));
    sidebar.render();
    await loadBoard();
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  (window as unknown as { lab: unknown }).lab = {
    state,
    registry,
    anim,
    viewport,
    stage,
    get ready() {
      return ready;
    },
    set: (patch: Partial<LabState>) => {
      change(patch);
      return ready;
    },
    /**
     * Dev only: renders the reference board from four sides (front, left, back, right) and saves
     * the images to public/lab/assets/refs, the inputs for Tripo multiview-to-3D.
     */
    async captureRefs(subject = 'agent:0', style: StyleId = 'lowpoly') {
      change({ board: 'reference', subject, style, light: 'studio', sil: false, rain: false, turn: false, px: 1 });
      await ready;
      const it = current!.items[0];
      stage.setReferenceBackdrop(true);
      const out: string[] = [];
      const views: [string, number][] = [['front', 0], ['left', Math.PI / 2], ['back', Math.PI], ['right', -Math.PI / 2]];
      for (const [name, yaw] of views) {
        it.spin.rotation.y = yaw;
        const url = stage.captureClean();
        const bin = Uint8Array.from(atob(url.split(',')[1]), (c) => c.charCodeAt(0));
        const file = `assets/refs/${subject.replace(':', '_')}_${style}_${name}.jpg`;
        await fetch(`/__lab/save?file=${encodeURIComponent(file)}`, { method: 'POST', body: bin });
        out.push(file);
      }
      it.spin.rotation.y = 0;
      stage.setReferenceBackdrop(false);
      return out.join('\n');
    },
    /** Dev only: bakes kit characters and props to GLB (+ .vox) under public/lab/assets/generated. */
    async exportModels(chars: CharacterJob[] = DEFAULT_CHARACTERS, props: PropJob[] = DEFAULT_PROPS) {
      const log: string[] = [];
      for (const j of chars) log.push(await exportCharacter(kits[j.style], j));
      for (const j of props) log.push(await exportProp(kits[j.style], j));
      return log.join('\n');
    },
  };

  void boot();

  return {
    activate() {
      if (active) return;
      active = true;
      viewportEl.prepend(canvas);
      stage.setFloor(true);
      stage.content.clear();
      for (const o of parked) stage.content.add(o);
      parked = [];
      overlays.group.visible = true;
      viewport.enabled = true;
      applyReview();
      stage.resize();
      if (current) {
        stage.frame(current.bounds);
        viewport.setBounds(current.bounds);
        if (!viewport.restore(state.cam)) viewport.applyPreset(state.view, state.view === current.view ? current.polar : undefined);
      }
      last = performance.now();
      raf = requestAnimationFrame(frame);
    },
    deactivate() {
      if (!active) return;
      active = false;
      cancelAnimationFrame(raf);
      viewport.enabled = false;
      viewport.select(null);
      overlays.group.visible = false;
      parked = [...stage.content.children];
      stage.content.clear();
    },
    onKey,
  };
}

let art: Art | null = null;

export const artTool: LabTool = {
  mount(root, ctx) {
    if (!art) art = build(root, ctx.stage);
    else art.activate(ctx);
    ctx.setSubtitle('Style boards');
  },
  unmount() {
    art?.deactivate();
  },
  onKey(e) {
    art?.onKey(e);
  },
};
