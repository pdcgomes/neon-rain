import type { WeaponDef } from '../content.ts';
import { DT } from '../time.ts';
import type { Entity, Projectile } from '../types.ts';
import type { World } from '../world.ts';
import { fireIntervalMul, spreadMul } from './ipa.ts';

const GRAVITY = 22;
const MUZZLE = 0.55;
const SHOT_HEIGHT = 1.25;

function fireOne(world: World, e: Entity, w: WeaponDef, weaponId: string): void {
  const ang0 = Math.atan2(e.aimY - e.y, e.aimX - e.x);
  const npcSpread = e.kind === 'agent' || e.faction === 'player' ? 1 : 1.7;
  const ang = ang0 + (world.rng.next() - 0.5) * 2 * w.spread * spreadMul(e) * npcSpread;
  const dx = Math.cos(ang);
  const dy = Math.sin(ang);
  let sx = e.x + dx * MUZZLE;
  let sy = e.y + dy * MUZZLE;
  if (world.nav.isBlockedAt(sx, sy)) {
    sx = e.x;
    sy = e.y;
  }
  const p: Projectile = {
    id: world.projectileSeq++,
    kind: w.type === 'rocket' ? 'rocket' : 'bullet',
    weapon: weaponId,
    x: sx,
    y: sy,
    z: SHOT_HEIGHT,
    px: sx,
    py: sy,
    pz: SHOT_HEIGHT,
    vx: dx * w.speed,
    vy: dy * w.speed,
    vz: 0,
    ownerId: e.id,
    faction: e.faction,
    damage: w.damage,
    splash: w.splash,
    ttl: w.range / w.speed,
    fuse: 0,
    landed: false,
  };
  world.projectiles.push(p);
  e.lastShotAt = world.time;
  if (e.kind === 'agent') world.stats.shotsFired++;
  if (w.ammo > 0) e.ammo--;
  world.emit({ t: 'shot', x: sx, y: sy, dx, dy, weapon: weaponId, owner: e.id, faction: e.faction });
  world.noise(e.x, e.y, w.noise, e.id);
}

function throwGrenade(world: World, e: Entity): void {
  const w = world.content.weapons.grenade;
  let dx = e.aimX - e.x;
  let dy = e.aimY - e.y;
  let d = Math.hypot(dx, dy);
  if (d > w.range) {
    dx = (dx / d) * w.range;
    dy = (dy / d) * w.range;
    d = w.range;
  }
  const T = 0.45 + d / 20;
  world.projectiles.push({
    id: world.projectileSeq++,
    kind: 'grenade',
    weapon: 'grenade',
    x: e.x,
    y: e.y,
    z: 1.6,
    px: e.x,
    py: e.y,
    pz: 1.6,
    vx: dx / T,
    vy: dy / T,
    vz: (GRAVITY * T) / 2 - 1.6 / T,
    ownerId: e.id,
    faction: e.faction,
    damage: w.damage,
    splash: w.splash,
    ttl: 6,
    fuse: w.fuse,
    landed: false,
  });
  e.grenades--;
  e.holstered = false;
  world.stats.grenades++;
  world.emit({ t: 'throw', owner: e.id });
}

export function combatSystem(world: World): void {
  for (const e of world.entities) {
    if (!e.alive || e.weapons.length === 0) continue;
    if (e.wantsSecondary) {
      e.wantsSecondary = false;
      if (e.grenades > 0) throwGrenade(world, e);
    }
    const weaponId = e.weapons[e.weaponIdx];
    const w = world.content.weapons[weaponId];
    e.cooldown = Math.max(-DT, e.cooldown - DT);
    const shooting = e.firing || e.autoFire;
    if (!w || w.type === 'persuade' || !shooting) {
      e.spin = Math.max(0, e.spin - DT * 2);
      if (e.cooldown < 0) e.cooldown = 0;
      continue;
    }
    e.holstered = false;
    if (w.spinup > 0) {
      e.spin = Math.min(w.spinup, e.spin + DT);
      if (e.spin < w.spinup) continue;
    }
    if (w.ammo > 0 && e.ammo <= 0) continue;
    let guard = 0;
    while (e.cooldown <= 0 && guard++ < 4) {
      fireOne(world, e, w, weaponId);
      e.cooldown += w.interval * fireIntervalMul(e);
    }
  }
}

function canHit(p: Projectile, e: Entity): boolean {
  if (e.id === p.ownerId) return false;
  if (e.faction === 'civ') return true;
  return e.faction !== p.faction;
}

function segmentHit(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, r: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const fx = ax - cx;
  const fy = ay - cy;
  const a = dx * dx + dy * dy;
  if (a < 1e-9) return -1;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - r * r;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const s = Math.sqrt(disc);
  const t1 = (-b - s) / (2 * a);
  if (t1 >= 0 && t1 <= 1) return t1;
  const t2 = (-b + s) / (2 * a);
  if (t1 < 0 && t2 >= 0) return 0;
  return -1;
}

export function projectileSystem(world: World): void {
  const keep: Projectile[] = [];
  for (const p of world.projectiles) {
    if (p.kind === 'grenade') {
      if (updateGrenade(world, p)) keep.push(p);
      continue;
    }
    const nx = p.x + p.vx * DT;
    const ny = p.y + p.vy * DT;
    const wallT = world.nav.raycast(p.x, p.y, nx, ny);

    let hitT = Infinity;
    let hitE: Entity | null = null;
    const mx = (p.x + nx) / 2;
    const my = (p.y + ny) / 2;
    const reach = Math.hypot(nx - p.x, ny - p.y) / 2 + 1;
    world.query(mx, my, reach, (e) => {
      if (!canHit(p, e)) return;
      const t = segmentHit(p.x, p.y, nx, ny, e.x, e.y, e.radius + 0.12);
      if (t >= 0 && t < hitT && t <= wallT) {
        hitT = t;
        hitE = e;
      }
    });

    if (hitE) {
      const target = hitE as Entity;
      p.x += (nx - p.x) * hitT;
      p.y += (ny - p.y) * hitT;
      const owner = world.get(p.ownerId);
      if (owner?.kind === 'agent') world.stats.shotsHit++;
      if (p.kind === 'rocket') world.explode(p.x, p.y, p.splash, p.damage, p.ownerId);
      else {
        target.vx += p.vx * 0.02;
        target.vy += p.vy * 0.02;
        world.damage(target, p.damage, p.ownerId);
      }
      continue;
    }
    if (wallT < 1) {
      p.x += (nx - p.x) * wallT;
      p.y += (ny - p.y) * wallT;
      if (p.kind === 'rocket') world.explode(p.x, p.y, p.splash, p.damage, p.ownerId);
      else world.emit({ t: 'impact', x: p.x, y: p.y });
      continue;
    }
    p.x = nx;
    p.y = ny;
    p.ttl -= DT;
    if (p.ttl <= 0) {
      if (p.kind === 'rocket') world.explode(p.x, p.y, p.splash, p.damage, p.ownerId);
      continue;
    }
    keep.push(p);
  }
  world.projectiles = keep;
}

function updateGrenade(world: World, p: Projectile): boolean {
  const nav = world.nav;
  if (!p.landed) p.vz -= GRAVITY * DT;
  let nx = p.x + p.vx * DT;
  let ny = p.y + p.vy * DT;
  if (nav.isBlockedAt(nx, p.y)) {
    p.vx *= -0.35;
    nx = p.x;
  }
  if (nav.isBlockedAt(nx, ny)) {
    p.vy *= -0.35;
    ny = p.y;
  }
  p.x = nx;
  p.y = ny;
  p.z += p.vz * DT;
  if (p.z <= 0.12) {
    p.z = 0.12;
    if (!p.landed && p.vz < -6) {
      p.vz = -p.vz * 0.3;
      p.vx *= 0.5;
      p.vy *= 0.5;
    } else {
      p.landed = true;
      p.vz = 0;
    }
  }
  if (p.landed) {
    p.vx *= 0.86;
    p.vy *= 0.86;
    p.fuse -= DT;
  }
  p.ttl -= DT;
  if (p.fuse <= 0 || p.ttl <= 0) {
    world.explode(p.x, p.y, p.splash, p.damage, p.ownerId);
    return false;
  }
  return true;
}
