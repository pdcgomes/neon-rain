import { CATALOGUE } from './catalogue.ts';
import type { AnimPlayer } from './player.ts';

const ICON = {
  play: '<svg viewBox="0 0 12 12"><path d="M3 1.5v9l7.5-4.5z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 12 12"><path d="M2.5 1.5h2.5v9H2.5zM7 1.5h2.5v9H7z" fill="currentColor"/></svg>',
  back: '<svg viewBox="0 0 12 12"><path d="M2 1.5h1.5v9H2zM10.5 1.5v9L4.5 6z" fill="currentColor"/></svg>',
  fwd: '<svg viewBox="0 0 12 12"><path d="M8.5 1.5H10v9H8.5zM1.5 1.5v9L7.5 6z" fill="currentColor"/></svg>',
  start: '<svg viewBox="0 0 12 12"><path d="M1.5 1.5H3v9H1.5zM11 1.5v9L4 6z" fill="currentColor"/></svg>',
};

export interface TimelineHandlers {
  clip(id: string): void;
  change(patch: { playing?: boolean; speed?: number; loop?: boolean }): void;
}

/** Transport strip: play/pause, step, scrub, speed, loop and clip picker. */
export class Timeline {
  private root: HTMLElement;
  private player: AnimPlayer;
  private playBtn: HTMLButtonElement;
  private scrub: HTMLInputElement;
  private time: HTMLElement;
  private clipSel: HTMLSelectElement;
  private speedSel: HTMLSelectElement;
  private loopChk: HTMLInputElement;
  private scrubbing = false;

  constructor(root: HTMLElement, player: AnimPlayer, h: TimelineHandlers) {
    this.root = root;
    this.player = player;
    root.innerHTML = `
      <button class="tl-btn" data-a="start" title="Go to start">${ICON.start}</button>
      <button class="tl-btn" data-a="back" title="Previous frame ( , )">${ICON.back}</button>
      <button class="tl-btn" data-a="play" title="Play / pause (Space)">${ICON.pause}</button>
      <button class="tl-btn" data-a="fwd" title="Next frame ( . )">${ICON.fwd}</button>
      <input class="tl-scrub" type="range" min="0" max="1000" value="0" />
      <span class="tl-time">0.00 s</span>
      <select class="tl-clip" title="Clip">${CATALOGUE.map((c) => `<option value="${c.id}">${c.label}</option>`).join('')}</select>
      <select class="tl-speed" title="Speed">${[0.25, 0.5, 1, 1.5, 2].map((s) => `<option value="${s}">${s}×</option>`).join('')}</select>
      <label class="chk"><input type="checkbox" class="tl-loop" checked />Loop</label>`;
    this.playBtn = root.querySelector('[data-a=play]')!;
    this.scrub = root.querySelector('.tl-scrub')!;
    this.time = root.querySelector('.tl-time')!;
    this.clipSel = root.querySelector('.tl-clip')!;
    this.speedSel = root.querySelector('.tl-speed')!;
    this.loopChk = root.querySelector('.tl-loop')!;
    root.querySelector('[data-a=start]')!.addEventListener('click', () => player.seek(0));
    root.querySelector('[data-a=back]')!.addEventListener('click', () => player.step(-1));
    root.querySelector('[data-a=fwd]')!.addEventListener('click', () => player.step(1));
    this.playBtn.addEventListener('click', () => h.change({ playing: !player.playing }));
    this.scrub.addEventListener('input', () => {
      this.scrubbing = true;
      player.playing = false;
      player.seek((Number(this.scrub.value) / 1000) * player.duration());
    });
    this.scrub.addEventListener('change', () => (this.scrubbing = false));
    this.clipSel.addEventListener('change', () => h.clip(this.clipSel.value));
    this.speedSel.addEventListener('change', () => h.change({ speed: Number(this.speedSel.value) }));
    this.loopChk.addEventListener('change', () => h.change({ loop: this.loopChk.checked }));
  }

  enable(on: boolean): void {
    this.root.classList.toggle('disabled', !on);
  }

  sync(): void {
    const p = this.player;
    this.playBtn.innerHTML = p.playing ? ICON.pause : ICON.play;
    this.clipSel.value = p.clip;
    this.clipSel.disabled = p.crossfade.enabled;
    this.speedSel.value = String(p.speed);
    this.loopChk.checked = p.loop;
  }

  update(): void {
    const p = this.player;
    const d = p.duration();
    if (!this.scrubbing) this.scrub.value = String(Math.round((p.time / d) * 1000));
    const frame = Math.round(p.time * 30);
    const label = p.crossfade.enabled ? `${p.crossfade.a} → ${p.crossfade.b}` : p.clip;
    this.time.textContent = `${p.time.toFixed(2)} / ${d.toFixed(2)} s · f${frame}/${p.frameCount()} · ${label}`;
  }
}
