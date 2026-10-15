// Brings the character SVG to life: hover/focus labels, small movements that
// follow the wind (hair, book page, top sheets, cat tail), and the cat:
// tail flick + "mrrp", then an option to open the cat photo album.
import { gust } from './wind';

interface Part { el: SVGGElement; wrap: SVGGElement; px: number; py: number; cx: number; cy: number }

const SVGNS = 'http://www.w3.org/2000/svg';

/**
 * Move a group's children into a new inner <g>, so we can set its transform
 * without touching the group itself (ids and CSS stay on the outer group).
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
  private hair: Part | null = null;
  private page: Part | null = null;
  private sheets: Part | null = null;
  private tail: Part | null = null;
  private label: HTMLElement;
  private bubble: HTMLElement;
  private pop: HTMLElement;
  private flickStart = -1;
  private now = 0;
  private bubbleTimer = 0;
  private paper: { x: number; y: number; size: number } | null = null;
  private pixelate: SVGFilterElement | null = null;

  constructor(private root: HTMLElement, host: HTMLElement, private reduced: () => boolean, tilt: number) {
    this.svg = host.querySelector('svg');
    this.label = root.querySelector('.scene-label')!;
    this.bubble = root.querySelector('.cat-bubble')!;
    this.pop = root.querySelector('.cat-pop')!;
    if (!this.svg) return;
    const svg = this.svg;

    // Pixelate the whole drawing to match the scene, and tilt it to lie along
    // the hillside. The tilt is inside the filter, so the pixel grid stays
    // level with the screen.
    const defs = (svg.querySelector('defs') ?? svg.insertBefore(document.createElementNS(SVGNS, 'defs'), svg.firstChild)) as SVGDefsElement;
    defs.insertAdjacentHTML('beforeend', `
      <filter id="vg-pixelate" x="-100" y="-100" width="1200" height="620" filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
        <feFlood flood-color="#000" result="dot"/>
        <feComposite in="dot" in2="dot" operator="over" result="cell"/>
        <feTile in="cell" result="grid"/>
        <feComposite in="SourceGraphic" in2="grid" operator="in" result="points"/>
        <feMorphology in="points" operator="dilate"/>
      </filter>`);
    this.pixelate = defs.querySelector<SVGFilterElement>('#vg-pixelate');
    const outer = document.createElementNS(SVGNS, 'g');
    const turn = document.createElementNS(SVGNS, 'g');
    outer.setAttribute('filter', 'url(#vg-pixelate)');
    turn.setAttribute('transform', `rotate(${tilt} 500 385)`);
    for (const node of [...svg.childNodes]) if (node !== defs) turn.appendChild(node);
    outer.appendChild(turn);
    svg.appendChild(outer);

    this.hair = part(svg, 'hair', 'center');
    this.page = part(svg, 'book-page', 'bottom-left');
    this.sheets = part(svg, 'papers-top', 'bottom-left');
    this.tail = part(svg, 'cat-tail', 'bottom-left');

    const targets = [...svg.querySelectorAll<SVGElement>('a, #cat')];
    for (const el of targets) {
      const show = () => this.showLabel(el);
      el.addEventListener('pointerenter', show);
      el.addEventListener('focus', show);
      el.addEventListener('pointerleave', () => this.hideLabel());
      el.addEventListener('blur', () => this.hideLabel());
    }

    const cat = svg.querySelector<SVGElement>('#cat');
    if (cat) {
      cat.setAttribute('aria-haspopup', 'dialog');
      cat.setAttribute('aria-expanded', 'false');
      cat.setAttribute('aria-controls', this.pop.id);
      cat.addEventListener('click', () => this.poke(cat));
      cat.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.poke(cat); }
      });
      this.pop.querySelector('.cat-close')?.addEventListener('click', () => this.closePop(true));
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !this.pop.hidden) this.closePop(true); });
      document.addEventListener('pointerdown', (e) => {
        if (!this.pop.hidden && !this.pop.contains(e.target as Node) && !cat.contains(e.target as Node)) this.closePop(false);
      });
    }
  }

  /** Position of an element relative to the scene, in CSS px. */
  private rectIn(el: Element) {
    const r = el.getBoundingClientRect();
    const o = this.root.getBoundingClientRect();
    return { x: r.left - o.left, y: r.top - o.top, w: r.width, h: r.height };
  }

  private place(box: HTMLElement, el: Element, gap = 8) {
    const r = this.rectIn(el);
    const W = this.root.clientWidth;
    box.style.left = `${Math.min(W - 8, Math.max(8, r.x + r.w / 2))}px`;
    box.style.top = `${Math.max(8, r.y - gap)}px`;
  }

  private showLabel(el: Element) {
    this.label.textContent = el.getAttribute('aria-label') ?? '';
    this.place(this.label, el);
    this.label.hidden = false;
  }

  private hideLabel() { this.label.hidden = true; }

  /** The cat: tail flick and "mrrp", then the album option. */
  private poke(cat: SVGElement) {
    this.hideLabel();
    if (!this.reduced()) this.flickStart = this.now;
    this.place(this.bubble, cat, 4);
    this.bubble.hidden = false;
    clearTimeout(this.bubbleTimer);
    this.bubbleTimer = window.setTimeout(() => {
      this.bubble.hidden = true;
      this.place(this.pop, cat, 4);
      this.pop.hidden = false;
      cat.setAttribute('aria-expanded', 'true');
      this.pop.querySelector<HTMLElement>('a')?.focus({ preventScroll: true });
    }, this.reduced() ? 300 : 1100);
  }

  private closePop(returnFocus: boolean) {
    this.pop.hidden = true;
    const cat = this.svg?.querySelector<SVGElement>('#cat');
    cat?.setAttribute('aria-expanded', 'false');
    if (returnFocus) cat?.focus({ preventScroll: true });
  }

  /**
   * Set the pixel block size, in SVG units (one art pixel on screen).
   * Each block shows the color sampled near its middle.
   */
  setPixelSize(units: number) {
    const f = this.pixelate;
    if (!f) return;
    const dot = units * 0.4;
    const [flood, cell, , , grow] = [...f.children] as SVGElement[];
    flood.setAttribute('x', String(units * 0.3));
    flood.setAttribute('y', String(units * 0.3));
    flood.setAttribute('width', String(dot));
    flood.setAttribute('height', String(dot));
    cell.setAttribute('x', '0');
    cell.setAttribute('y', '0');
    cell.setAttribute('width', String(units));
    cell.setAttribute('height', String(units));
    grow.setAttribute('radius', String(units * 0.3));
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

  /** Where flying sheets start: the top of the paper stack, in scene px. */
  paperSource() { return this.paper; }

  /** Per-frame movement. t in seconds. */
  animate(t: number) {
    this.now = t;
    if (!this.svg) return;
    const w = this.windAt.bind(this);
    const rot = (p: Part | null, deg: number, dy = 0) => {
      p?.wrap.setAttribute('transform', `translate(0 ${dy.toFixed(2)}) rotate(${deg.toFixed(2)} ${p.px} ${p.py})`);
    };
    rot(this.hair, w(this.hair) * 7 + Math.sin(t * 2.1) * 1.2);
    rot(this.page, -w(this.page) * 28 - Math.max(0, Math.sin(t * 3.7)) * 3);
    rot(this.sheets, -w(this.sheets) * 4, -w(this.sheets) * 3);
    let tail = Math.sin(t * 1.15) * 5;
    if (this.flickStart >= 0) {
      const k = (t - this.flickStart) / 1.0;
      if (k >= 1) this.flickStart = -1;
      else tail += 28 * Math.sin(k * Math.PI * 3) * (1 - k);
    }
    rot(this.tail, tail);
  }

  private windAt(p: Part | null) {
    return p ? gust(p.cx, p.cy, this.now) : 0;
  }
}
