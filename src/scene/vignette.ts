// Brings the character SVG to life.
//
// The SVG stays in the page, invisible, for links, focus and hover. What you
// see is a copy of it drawn into a small canvas at the scene's art resolution
// and scaled up with crisp pixels, like the other layers. The copy is redrawn
// a few times a second while parts move: hair, book page, top sheets and the
// cat's tail follow the wind. Hover or keyboard focus outlines an object and
// shows its label. The cat: tail flick + "mrrp", then a link to the album.
import { gust } from './wind';

interface Part { el: SVGGElement; wrap: SVGGElement; px: number; py: number; cx: number; cy: number }

const SVGNS = 'http://www.w3.org/2000/svg';
/** Art pixels of room around the drawing (the tilt and the outline reach past the viewBox). */
const PAD = 20;
/** At most this many redraws per second while parts move. */
const RASTER_FPS = 6;
/** Moving parts turn in steps of this many degrees (fewer redraws; suits the pixel look). */
const STEP_DEG = 2;

/**
 * Move a group's children into a new inner <g>, so we can set its transform
 * without touching the group itself.
 */
function wrapChildren(el: SVGGElement): SVGGElement {
  const wrap = document.createElementNS(SVGNS, 'g') as SVGGElement;
  while (el.firstChild) wrap.appendChild(el.firstChild);
  el.appendChild(wrap);
  return wrap;
}

function part(svg: SVGSVGElement, id: string, fallback: 'bottom-left' | 'center'): Part | null {
  const el = svg.querySelector<SVGGElement>(`#${id}`);
  if (!el) return null;
  let px: number, py: number;
  const pivot = el.dataset.pivot?.trim().split(/[\s,]+/).map(Number);
  if (pivot && pivot.length === 2 && pivot.every(Number.isFinite)) {
    [px, py] = pivot;
  } else {
    const b = el.getBBox();
    px = fallback === 'center' ? b.x + b.width / 2 : b.x;
    py = fallback === 'center' ? b.y + b.height / 2 : b.y + b.height;
  }
  return { el, wrap: wrapChildren(el), px, py, cx: 0, cy: 0 };
}

export class Vignette {
  private svg: SVGSVGElement | null;
  private art: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private hair: Part | null = null;
  private page: Part | null = null;
  private sheets: Part | null = null;
  private tail: Part | null = null;
  private targets: SVGElement[] = [];
  private cat: SVGElement | null = null;
  private lit: SVGElement | null = null;
  private label: HTMLElement;
  private bubble: HTMLElement;
  private pop: HTMLElement;
  private flickStart = -1;
  private bubbleTimer = 0;
  private paper: { x: number; y: number; size: number } | null = null;
  private units = 1; // SVG units per art px
  private busy = false;
  private again = false;
  private lastRaster = -1;
  private lastPose = '';

  constructor(private root: HTMLElement, host: HTMLElement, private reduced: () => boolean, tilt: number) {
    this.svg = host.querySelector('svg');
    this.label = root.querySelector('.scene-label')!;
    this.bubble = root.querySelector('.cat-bubble')!;
    this.pop = root.querySelector('.cat-pop')!;
    this.art = document.createElement('canvas');
    this.art.className = 'vignette-art';
    this.art.setAttribute('aria-hidden', 'true');
    host.prepend(this.art);
    this.ctx = this.art.getContext('2d')!;
    if (!this.svg) return;
    const svg = this.svg;
    host.dataset.raster = 'true';

    // Tilt the drawing to lie along the hillside.
    const defs = (svg.querySelector('defs') ?? svg.insertBefore(document.createElementNS(SVGNS, 'defs'), svg.firstChild)) as SVGDefsElement;
    const turn = document.createElementNS(SVGNS, 'g');
    turn.setAttribute('transform', `rotate(${tilt} 500 385)`);
    for (const node of [...svg.childNodes]) if (node !== defs) turn.appendChild(node);
    svg.appendChild(turn);
    // Outline for the hovered or focused object: dark outside, light inside,
    // so it shows on any background. Ring sizes are set in setScale().
    defs.insertAdjacentHTML('beforeend', `
      <filter id="vg-hi" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">
        <feMorphology in="SourceAlpha" operator="dilate" radius="4" result="outer"/>
        <feFlood flood-color="#2b2420"/><feComposite in2="outer" operator="in" result="dark"/>
        <feMorphology in="SourceAlpha" operator="dilate" radius="2" result="inner"/>
        <feFlood flood-color="#fff3b0"/><feComposite in2="inner" operator="in" result="light"/>
        <feMerge><feMergeNode in="dark"/><feMergeNode in="light"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>`);

    this.hair = part(svg, 'hair', 'center');
    this.page = part(svg, 'book-page', 'bottom-left');
    this.sheets = part(svg, 'papers-top', 'bottom-left');
    this.tail = part(svg, 'cat-tail', 'bottom-left');

    this.targets = [...svg.querySelectorAll<SVGElement>('a, #cat')];
    for (const el of this.targets) {
      el.addEventListener('pointerenter', () => this.focusOn(el));
      el.addEventListener('focus', () => this.focusOn(el));
      el.addEventListener('pointerleave', () => this.syncToFocus());
      el.addEventListener('blur', () => queueMicrotask(() => this.syncToFocus()));
    }

    const cat = (this.cat = svg.querySelector<SVGElement>('#cat'));
    if (cat) {
      cat.setAttribute('aria-haspopup', 'dialog');
      cat.setAttribute('aria-expanded', 'false');
      cat.setAttribute('aria-controls', this.pop.id);
      cat.addEventListener('click', () => this.toggle(cat));
      cat.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.toggle(cat); }
        if (e.key === 'Escape') this.escape();
      });
      // Moving focus away from the cat while it says "mrrp" cancels the popup.
      cat.addEventListener('blur', (e) => { if (!this.pop.contains(e.relatedTarget as Node)) this.cancelPoke(); });
      this.pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.escape(); });
      this.pop.addEventListener('focusout', (e) => {
        const to = e.relatedTarget as Node | null;
        if (to && !this.pop.contains(to) && !cat.contains(to)) this.closePop(false);
      });
      this.pop.querySelector('.cat-close')?.addEventListener('click', () => this.closePop(true));
      document.addEventListener('pointerdown', (e) => {
        const t = e.target as Node;
        if (this.pop.contains(t) || cat.contains(t)) return;
        this.cancelPoke();
        if (!this.pop.hidden) this.closePop(false);
      });
    }
  }

  /** Position of an element relative to the scene, in CSS px. */
  private rectIn(el: Element) {
    const r = el.getBoundingClientRect();
    const o = this.root.getBoundingClientRect();
    return { x: r.left - o.left, y: r.top - o.top, w: r.width, h: r.height };
  }

  /** Show a box (label, bubble, popup) above an element, kept inside the scene. */
  private place(box: HTMLElement, el: Element, gap = 8) {
    box.hidden = false; // must be visible to measure
    const r = this.rectIn(el);
    const W = this.root.clientWidth;
    const half = box.offsetWidth / 2;
    const lo = 8 + half, hi = W - 11 - half; // 11: room for the 3px block shadow
    const cx = r.x + r.w / 2;
    box.style.left = `${lo > hi ? W / 2 : Math.min(hi, Math.max(lo, cx))}px`;
    box.style.top = `${Math.max(box.offsetHeight + 6, r.y - gap)}px`;
  }

  /** Outline and label one object (from hover or focus). */
  private focusOn(el: SVGElement) {
    this.label.textContent = el.getAttribute('aria-label') ?? '';
    if (this.bubble.hidden && this.pop.hidden) this.place(this.label, el);
    this.highlight(el);
  }

  /** After the pointer leaves: follow keyboard focus if an object has it, else clear. */
  private syncToFocus() {
    const a = document.activeElement;
    const el = this.targets.find((t) => t === a && t.matches(':focus-visible'));
    if (el) this.focusOn(el);
    else { this.label.hidden = true; this.highlight(null); }
  }

  private highlight(el: SVGElement | null) {
    if (el === this.lit) return;
    this.lit?.removeAttribute('filter');
    el?.setAttribute('filter', 'url(#vg-hi)');
    this.lit = el;
    this.raster();
  }

  private toggle(cat: SVGElement) {
    if (!this.pop.hidden) this.closePop(true);
    else this.poke(cat);
  }

  /** The cat: tail flick and "mrrp", then the album option. */
  private poke(cat: SVGElement) {
    this.label.hidden = true;
    if (!this.reduced()) this.flickStart = performance.now() / 1000;
    this.bubble.textContent = 'mrrp';
    this.place(this.bubble, cat, 4);
    clearTimeout(this.bubbleTimer);
    this.bubbleTimer = window.setTimeout(() => {
      this.bubble.hidden = true;
      this.place(this.pop, cat, 4);
      cat.setAttribute('aria-expanded', 'true');
      // Move focus into the popup only if the user is still on the cat.
      if (document.activeElement === cat) this.pop.querySelector<HTMLElement>('a')?.focus({ preventScroll: true });
    }, this.reduced() ? 300 : 1100);
  }

  private cancelPoke() {
    clearTimeout(this.bubbleTimer);
    this.bubble.hidden = true;
  }

  private escape() {
    if (!this.bubble.hidden) this.cancelPoke();
    if (!this.pop.hidden) this.closePop(true);
  }

  private closePop(returnFocus: boolean) {
    this.cancelPoke();
    this.pop.hidden = true;
    this.cat?.setAttribute('aria-expanded', 'false');
    if (returnFocus) this.cat?.focus({ preventScroll: true });
  }

  /**
   * Size the art canvas for the current scale.
   * @param px screen px per art px
   * @param width the drawing's width on screen, in CSS px (a multiple of px)
   */
  setScale(px: number, width: number) {
    if (!this.svg) return;
    this.units = (px * 1000) / width;
    const w = Math.round(1000 / this.units) + PAD * 2;
    const h = Math.round(420 / this.units) + PAD * 2;
    this.art.width = w;
    this.art.height = h;
    Object.assign(this.art.style, { width: `${w * px}px`, height: `${h * px}px`, left: `${-PAD * px}px`, top: `${-PAD * px}px` });
    const [outer, , , inner] = [...this.svg.querySelectorAll('#vg-hi > feMorphology, #vg-hi > feFlood')] as SVGElement[];
    outer?.setAttribute('radius', String(this.units * 2));
    inner?.setAttribute('radius', String(this.units));
    this.lastPose = '';
    this.raster();
  }

  /** Draw the SVG, as it is now, into the art canvas. */
  private async raster() {
    if (!this.svg) return;
    if (this.busy) { this.again = true; return; }
    this.busy = true;
    this.lastRaster = performance.now();
    const u = this.units, w = this.art.width, h = this.art.height;
    const box = `${-PAD * u} ${-PAD * u} ${w * u} ${h * u}`;
    const xml = new XMLSerializer().serializeToString(this.svg)
      .replace(/viewBox="[^"]*"/, `viewBox="${box}" width="${w}" height="${h}"`);
    const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml' }));
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      this.ctx.clearRect(0, 0, w, h);
      this.ctx.drawImage(img, 0, 0, w, h);
    } catch {
      // keep the last good frame
    } finally {
      URL.revokeObjectURL(url);
      this.busy = false;
      if (this.again) { this.again = false; this.raster(); }
    }
  }

  /**
   * Measure part positions once per resize (reading them every frame would be slow).
   * @param offset shift from scene px to the grass layer's px, so gusts line up
   * @param px screen px per art px (the effects layer is in art px)
   */
  layout(offset: number, px: number) {
    for (const p of [this.hair, this.page, this.sheets, this.tail]) {
      if (!p) continue;
      const r = this.rectIn(p.el);
      p.cx = r.x + r.w / 2 + offset;
      p.cy = r.y + r.h / 2 + offset;
    }
    if (this.sheets) {
      const r = this.rectIn(this.sheets.el);
      this.paper = { x: (r.x + r.w * 0.6) / px, y: (r.y + r.h * 0.3) / px, size: Math.max(1, Math.min(2, r.w / px / 30)) };
    }
  }

  /** Where flying sheets start: the top of the paper stack, in art px. */
  paperSource() { return this.paper; }

  /** Per-frame movement. t in seconds (the scene's wind clock). */
  animate(t: number) {
    if (!this.svg) return;
    const w = (p: Part | null) => (p ? gust(p.cx, p.cy, t) : 0);
    const pose: string[] = [];
    const rot = (p: Part | null, deg: number, dy = 0) => {
      if (!p) return;
      const tf = `translate(0 ${Math.round(dy)}) rotate(${Math.round(deg / STEP_DEG) * STEP_DEG} ${p.px} ${p.py})`;
      p.wrap.setAttribute('transform', tf);
      pose.push(tf);
    };
    rot(this.hair, w(this.hair) * 7 + Math.sin(t * 2.1) * 1.2);
    rot(this.page, -w(this.page) * 28 - Math.max(0, Math.sin(t * 3.7)) * 3);
    rot(this.sheets, -w(this.sheets) * 4, -w(this.sheets) * 3);
    let tail = Math.sin(t * 1.15) * 5;
    if (this.flickStart >= 0) {
      // The flick runs on real time, so it also plays when the wind is still.
      const k = (performance.now() / 1000 - this.flickStart) / 1.0;
      if (k >= 1) this.flickStart = -1;
      else tail += 28 * Math.sin(k * Math.PI * 3) * (1 - k);
    }
    rot(this.tail, tail);
    // Redraw only when the pose changed, a few times a second.
    const key = pose.join('|');
    if (key !== this.lastPose && performance.now() - this.lastRaster >= 1000 / RASTER_FPS) {
      this.lastPose = key;
      this.raster();
    }
  }
}
