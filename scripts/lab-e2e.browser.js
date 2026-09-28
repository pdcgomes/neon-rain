// Loaded into the Lab page by scripts/lab-e2e.ts. Drives the Missions tool with synthetic input and
// returns a PASS/FAIL report. Leaves content-local/missions/e2e_test.json behind for inspection.
export async function run() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const log = [];
  const check = (name, ok, extra = '') => {
    const line = `${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` (${extra})` : ''}`;
    log.push(line);
    console.log(line);
  };
  console.log('e2e start');
  const key = (code, opts = {}) => window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, ...opts }));
  const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));

  await fetch('/__lab/mission-delete?id=e2e_test&source=local', { method: 'POST' });
  await window.labHost.open('missions', { mission: null });
  await sleep(600);
  click([...document.querySelectorAll('.ab-actions button')].find((b) => b.textContent.startsWith('New mission')));
  await sleep(100);
  const dlg = document.querySelector('.mt-dialog');
  dlg.querySelector('input[value=blank]').checked = true;
  dlg.querySelector('[data-f=id]').value = 'e2e_test';
  dlg.querySelector('[data-f=size]').value = '80';
  click(dlg.querySelector('[data-a=ok]'));
  await sleep(600);

  const tool = window.labMissions;
  const ed = tool.editor;
  const doc = tool.doc;
  const view = ed.view;
  const cv = view.canvas;
  check('editor opened on new mission', doc && doc.id === 'e2e_test' && doc.layout && doc.layout.w === 80);
  const at = (x, y) => {
    const p = view.toPx(x, y);
    const r = cv.getBoundingClientRect();
    return { clientX: r.left + p.x, clientY: r.top + p.y, button: 0, buttons: 1, pointerId: 1, bubbles: true };
  };
  const drag = async (pts, opts = {}) => {
    cv.dispatchEvent(new PointerEvent('pointerdown', { ...at(...pts[0]), ...opts }));
    for (const p of pts.slice(1)) cv.dispatchEvent(new PointerEvent('pointermove', { ...at(...p), ...opts }));
    cv.dispatchEvent(new PointerEvent('pointerup', { ...at(...pts.at(-1)), ...opts }));
    await sleep(30);
  };

  // Paint a road across the map.
  key('KeyB');
  click([...document.querySelectorAll('.me-sw')].find((b) => b.textContent.includes('Road')));
  await drag([[5, 40], [40, 40], [75, 40]]);
  const road = doc.layout.ground[40 * 80 + 40];
  check('ground brush paints road', road === 0, `cell=${road}`);

  // Obstacle rectangle with shift-drag.
  click([...document.querySelectorAll('.me-sw')].find((b) => b.textContent === 'Obstacle'));
  await drag([[60, 10], [66, 14]], { shiftKey: true });
  check('shift-drag fills an obstacle rectangle', doc.layout.blocked[12 * 80 + 62] === 1);

  // A building.
  key('KeyG');
  await drag([[20, 10], [32, 22]]);
  check('building tool adds a building', doc.layout.buildings.length === 1, JSON.stringify(doc.layout.buildings[0]));

  // Units: a target and a guard.
  key('KeyE');
  click([...document.querySelectorAll('.me-sw')].find((b) => b.textContent === 'target'));
  await drag([[45, 20]]);
  click([...document.querySelectorAll('.me-sw')].find((b) => b.textContent === 'guard'));
  await drag([[50, 25]]);
  check('unit tool places a target and a guard', doc.spawns.length === 2, doc.spawns.map((s) => `${s.id}:${s.kind}`).join(','));

  // Patrol route for the guard (selected after placing).
  key('KeyW');
  await drag([[55, 25]]);
  await drag([[55, 32]]);
  await drag([[48, 32]]);
  key('Escape');
  const guard = doc.spawns.find((s) => s.kind === 'guard');
  check('route tool adds waypoints', guard.patrol?.length === 3, `${guard.patrol?.length} waypoints`);

  // Select and move the target.
  key('KeyV');
  await drag([[45, 20], [47, 21]]);
  const target = doc.spawns.find((s) => s.kind === 'target');
  check('select tool drags a unit', Math.abs(target.x - 47) < 0.6 && Math.abs(target.y - 21) < 0.6, `${target.x},${target.y}`);

  // Objective: eliminate the target, before the extraction.
  click([...document.querySelectorAll('[data-a=add-obj]')][0]);
  await sleep(50);
  let rows = document.querySelectorAll('.me-obj');
  const typeSel = rows[1].querySelector('[data-f=type]');
  typeSel.value = 'eliminate';
  typeSel.dispatchEvent(new Event('change'));
  await sleep(50);
  rows = document.querySelectorAll('.me-obj');
  const multi = rows[1].querySelector('[data-f=targets]');
  [...multi.options].forEach((o) => (o.selected = o.value === target.id));
  multi.dispatchEvent(new Event('change'));
  click(rows[1].querySelector('[data-a=up]'));
  await sleep(50);
  check('objectives: eliminate target, then extract', doc.mission.objectives.map((o) => o.type).join('>') === 'eliminate>extract' && doc.mission.objectives[0].targets?.[0] === target.id);

  // Undo / redo.
  const before = doc.layout.buildings.length;
  // Four steps: add objective, change its type, set its target, move it up.
  for (let k = 0; k < 4; k++) key('KeyZ', { metaKey: true });
  const afterUndo = doc.mission.objectives.length;
  for (let k = 0; k < 4; k++) key('KeyZ', { metaKey: true, shiftKey: true });
  check('undo and redo', afterUndo === 1 && doc.mission.objectives.length === 2 && doc.layout.buildings.length === before, `after undo ${afterUndo} objectives`);

  // Validation and save.
  const issues = ed.issues.map((i) => `${i.level}: ${i.text}`);
  check('validation has no errors', !ed.issues.some((i) => i.level === 'error'), issues.join(' | '));
  key('KeyS', { metaKey: true });
  await sleep(500);
  const saved = await (await fetch('/__lab/mission?id=e2e_test&source=local')).json();
  check(
    'saved file round-trips',
    saved.map.kind === 'authored' && saved.map.layout.buildings.length === 1 && saved.spawns.length === 2 && saved.objectives.length === 2,
    `${saved.map.layout.w}x${saved.map.layout.h}, ${saved.spawns.length} spawns`,
  );
  check('doc is clean after save', !doc.dirty);

  // 3D preview toggle and back.
  key('KeyT');
  await sleep(1500);
  const has3d = !!document.querySelector('.me-view3d canvas');
  key('KeyT');
  await sleep(200);
  check('3D preview toggles', has3d && !document.querySelector('.me-view3d canvas'));

  // Tool switching keeps state.
  await window.labHost.open('art');
  await sleep(800);
  await window.labHost.open('missions');
  await sleep(400);
  check('editor survives switching to Art and back', window.labMissions.doc?.id === 'e2e_test' && !!document.querySelector('.me .mv-canvas'));

  if (window.__e2eImport !== false) log.push(await runImport());
  return log.join('\n');
}

/** Import tool: load content-local, pick a mission, reclassify a tile, convert to a draft. */
export async function runImport() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const log = [];
  const check = (name, ok, extra = '') => {
    const line = `${ok ? 'PASS' : 'FAIL'} import: ${name}${extra ? ` (${extra})` : ''}`;
    log.push(line);
    console.log(line);
  };
  const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const until = async (fn, ms = 20000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (fn()) return true;
      await sleep(100);
    }
    return false;
  };
  await window.labHost.open('import');
  await sleep(300);
  click(document.querySelector('.im [data-a=dev]'));
  const loaded = await until(() => document.querySelectorAll('.im-row').length >= 50);
  check('loads both campaigns from content-local', loaded && document.querySelectorAll('.im-set option').length === 2, `${document.querySelectorAll('.im-row').length} missions`);
  click([...document.querySelectorAll('.im-row')].find((r) => r.dataset.n === '3'));
  await sleep(300);
  check('shows mission 3 side by side', /Snatch and grab/i.test(document.querySelector('.im-title').textContent) && document.querySelector('.im-orig').width === 768);
  const orig = document.querySelector('.im-orig');
  const rect = orig.getBoundingClientRect();
  const ev = (type, tx, ty) => orig.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: rect.left + ((tx + 0.5) / 128) * rect.width, clientY: rect.top + ((ty + 0.5) / 96) * rect.height }));
  ev('mousemove', 70, 40);
  check('hover shows the tile column', /Tile 70, 40/.test(document.querySelector('.im-info').textContent));
  // Street-level view, so the click picks the floor tile (what the converter reads for ground).
  const mode = document.querySelector('.im-mode');
  mode.value = 'street';
  mode.dispatchEvent(new Event('change'));
  ev('click', 70, 40);
  await sleep(100);
  const sel = document.querySelector('[data-id]');
  check('clicking a tile selects it for reclassifying', !!sel);
  if (sel) {
    const sum = () => window.labImport.result.cells.reduce((a, b) => a + b, 0);
    const before = sum();
    sel.value = sel.value === 'water' ? 'ground' : 'water';
    sel.dispatchEvent(new Event('change'));
    await sleep(200);
    const after = sum();
    check('reclassifying a tile changes the conversion', before !== after, `cell sum ${before} -> ${after}`);
    click(document.querySelector('[data-a=unset]'));
    await sleep(200);
  }
  window.confirm = () => false;
  click([...document.querySelectorAll('.ab-actions button')].find((b) => b.textContent.startsWith('Convert to draft')));
  const opened = await until(() => window.labMissions?.doc?.id === 'synd_03' && !!document.querySelector('.me .mv-canvas'), 10000);
  check('convert to draft opens it in the Missions tool', opened);
  return log.join('\n');
}
