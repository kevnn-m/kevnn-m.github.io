// Brings the character SVG to life.
//
// The SVG stays in the page, invisible, for links, focus and hover. What you
// see is a canvas at the scene's art resolution, scaled up with crisp pixels
// like the other layers. On each resize the drawing is split, in drawing
// order, into still layers and the four moving parts (top sheets, hair, book
// page, cat tail), and each piece is rendered once. Every frame the pieces
// are stacked again, with the moving parts turned in the canvas, so nothing
// is re-rendered while the wind blows.
//
// Hover or keyboard focus draws an outline ring around an object and shows
// its label. The cat: tail flick + "mrrp", then a link to the photo album.
import { gust } from './wind';

const SVGNS = 'http://www.w3.org/2000/svg';
/** Art pixels of room around the drawing (the tilt and the outline reach past the viewBox). */
const PAD = 20;
/** Moving parts are rendered at this multiple of the art resolution, then turned and scaled down smoothly. */
const PART_SCALE = 2;
/** Elements that draw something (shapes inside defs and clip paths don't count). */
const DRAWN = 'path, use, rect, circle, ellipse, line, polyline, polygon, image';

interface Part {
  el: SVGGElement;
  wrap: SVGGElement; // inner group that turns, in the live SVG (keeps hit areas in place)
  px: number; // pivot, SVG units
  py: number;
  start: number; // range of drawn elements, in drawing order
  end: number;
  cx: number; // center in scene px, for the wind
  cy: number;
  deg: number; // current pose
  dy: number;
}

interface Layers { u: number; w: number; h: number; still: HTMLCanvasElement[]; parts: HTMLCanvasElement[] }

const drawnIn = (root: Element) =>
  [...root.querySelectorAll(DRAWN)].filter((el) => !el.closest('defs, clipPath, mask, pattern, symbol, marker'));

/** Move a group's children into a new inner <g> that we can turn. */
function wrapChildren(el: SVGGElement): SVGGElement {
  const wrap = document.createElementNS(SVGNS, 'g') as SVGGElement;
  wrap.dataset.wrap = '';
  while (el.firstChild) wrap.appendChild(el.firstChild);
  el.appendChild(wrap);
  return wrap;
}

export class Vignette {
  private svg: SVGSVGElement | null;
  private art: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private parts: Part[] = [];
  private still: [number, number][] = []; // ranges of drawn elements between the moving parts
  private ranges = new Map<Element, [number, number]>(); // each target's drawn elements
  private targets: SVGElement[] = [];
  private cat: SVGElement | null = null;
  private label: HTMLElement;
  private bubble: HTMLElement;
  private pop: HTMLElement;
  private hovered: SVGElement | null = null;
  private focused: SVGElement | null = null;
  private dismissed = new Set<SVGElement>(); // hidden with Escape until the pointer or focus leaves them
  private labelFor: SVGElement | null = null;
  private flickStart = -1;
  private bubbleTimer = 0;
  private paper: { x: number; y: number; size: number } | null = null;
  private layers: Layers | null = null;
  private rings = new Map<Element, HTMLCanvasElement | 'pending'>();
  private gen = 0;
  private cos: number;
  private sin: number;

  constructor(private root: HTMLElement, host: HTMLElement, private reduced: () => boolean, tilt: number) {
    this.svg = host.querySelector('svg');
    this.label = root.querySelector('.scene-label')!;
    this.bubble = root.querySelector('.cat-bubble')!;
    this.pop = root.querySelector('.cat-pop')!;
    this.cos = Math.cos((tilt * Math.PI) / 180);
    this.sin = Math.sin((tilt * Math.PI) / 180);
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
    // The outline ring: dark outside, light inside, so it shows on any
    // background; the object itself is cut out. Sizes are set in setScale().
    defs.insertAdjacentHTML('beforeend', `
      <filter id="vg-ring" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">
        <feMorphology in="SourceAlpha" operator="dilate" radius="4" result="outer"/>
        <feMorphology in="SourceAlpha" operator="dilate" radius="2" result="inner"/>
        <feFlood flood-color="#2b2420" result="dk"/><feComposite in="dk" in2="outer" operator="in" result="dark"/>
        <feFlood flood-color="#fff3b0" result="lt"/><feComposite in="lt" in2="inner" operator="in" result="light"/>
        <feMerge result="both"><feMergeNode in="dark"/><feMergeNode in="light"/></feMerge>
        <feComposite in="both" in2="SourceAlpha" operator="out"/>
      </filter>`);

    // Drawing order of everything visible, and where each moving part sits in it.
    const drawn = drawnIn(svg);
    const index = new Map(drawn.map((el, i) => [el, i]));
    const rangeOf = (el: Element): [number, number] => {
      const own = drawnIn(el).map((d) => index.get(d)).filter((i): i is number => i !== undefined);
      return own.length ? [Math.min(...own), Math.max(...own) + 1] : [0, 0];
    };
    for (const [id, fallback] of [['papers-top', 'bl'], ['hair', 'c'], ['book-page', 'bl'], ['cat-tail', 'bl']] as const) {
      const el = svg.querySelector<SVGGElement>(`#${id}`);
      if (!el) continue;
      let pivot = el.dataset.pivot?.trim().split(/[\s,]+/).map(Number);
      if (!pivot || pivot.length !== 2 || !pivot.every(Number.isFinite)) {
        const b = el.getBBox();
        pivot = fallback === 'c' ? [b.x + b.width / 2, b.y + b.height / 2] : [b.x, b.y + b.height];
      }
      const [start, end] = rangeOf(el);
      this.parts.push({ el, wrap: wrapChildren(el), px: pivot[0], py: pivot[1], start, end, cx: 0, cy: 0, deg: 0, dy: 0 });
    }
    this.parts.sort((a, b) => a.start - b.start);
    let from = 0;
    for (const p of this.parts) { this.still.push([from, p.start]); from = p.end; }
    this.still.push([from, drawn.length]);

    this.targets = [...svg.querySelectorAll<SVGElement>('a, #cat')];
    for (const el of this.targets) {
      this.ranges.set(el, rangeOf(el));
      el.addEventListener('pointerenter', () => { this.hovered = el; this.refresh(); });
      el.addEventListener('pointerleave', () => { this.hovered = null; this.dismissed.delete(el); this.refresh(); });
      el.addEventListener('focus', () => { this.focused = el.matches(':focus-visible') ? el : null; this.refresh(); });
      el.addEventListener('blur', () => { this.focused = null; this.dismissed.delete(el); this.refresh(); });
    }
    // Escape hides the labels and outlines showing now (WCAG 1.4.13), without moving focus.
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !this.labelFor) return;
      for (const el of [this.focused, this.hovered]) if (el) this.dismissed.add(el);
      this.refresh();
    });

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

  /**
   * Update the label and outlines from the hover and focus state. Keyboard
   * focus wins the label, so it always names what Enter will activate.
   */
  private refresh() {
    const show = (el: SVGElement | null) => (el && !this.dismissed.has(el) ? el : null);
    const forLabel = show(this.focused) ?? show(this.hovered);
    this.labelFor = forLabel;
    if (forLabel && this.bubble.hidden && this.pop.hidden) {
      this.label.textContent = forLabel.getAttribute('aria-label') ?? '';
      this.place(this.label, forLabel);
    } else {
      this.label.hidden = true;
    }
    this.compose();
  }

  private toggle(cat: SVGElement) {
    if (!this.pop.hidden) this.closePop(true);
    else this.poke(cat);
  }

  /** The cat: tail flick and "mrrp", then the album option. */
  private poke(cat: SVGElement) {
    this.label.hidden = true;
    if (!this.reduced()) this.flickStart = performance.now() / 1000;
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
   * Render the pieces for the current scale. The canvas keeps showing the old
   * picture until all new pieces are ready, so a resize never flashes blank.
   * @param px screen px per art px
   * @param width the drawing's width on screen, in CSS px (a multiple of px)
   */
  setScale(px: number, width: number) {
    if (!this.svg) return;
    const u = (px * 1000) / width; // SVG units per art px
    const w = Math.round(1000 / u) + PAD * 2;
    const h = Math.round(420 / u) + PAD * 2;
    const l = this.layers;
    if (l && l.w === w && l.h === h && Math.abs(l.u - u) < 1e-6) return; // nothing changed
    const outer = this.svg.querySelector('#vg-ring > [result=outer]');
    const inner = this.svg.querySelector('#vg-ring > [result=inner]');
    outer?.setAttribute('radius', String(u * 2));
    inner?.setAttribute('radius', String(u));
    const gen = ++this.gen;
    Promise.all([
      Promise.all(this.still.map(([a, b]) => this.render((i) => i >= a && i < b, u, w, h, 1))),
      Promise.all(this.parts.map((p) => this.render((i) => i >= p.start && i < p.end, u, w, h, PART_SCALE))),
    ]).then(([still, parts]) => {
      if (gen !== this.gen) return; // a newer resize won
      if (this.art.width !== w || this.art.height !== h) { this.art.width = w; this.art.height = h; }
      Object.assign(this.art.style, { width: `${w * px}px`, height: `${h * px}px`, left: `${-PAD * px}px`, top: `${-PAD * px}px` });
      this.layers = { u, w, h, still, parts };
      this.rings.clear();
      this.compose();
    }).catch(() => { /* keep the old picture */ });
  }

  /**
   * Render a copy of the SVG with only some drawn elements visible.
   * @param show which drawn elements (by drawing order) to keep
   * @param scale multiple of the art resolution to render at
   * @param ring render the outline ring of this target instead of the drawing
   */
  private async render(show: (i: number) => boolean, u: number, w: number, h: number, scale: number, ring?: Element) {
    const clone = this.svg!.cloneNode(true) as SVGSVGElement;
    drawnIn(clone).forEach((el, i) => { if (!show(i)) el.setAttribute('display', 'none'); });
    clone.querySelectorAll('[data-wrap]').forEach((g) => g.removeAttribute('transform'));
    if (ring?.id) clone.querySelector(`#${ring.id}`)?.setAttribute('filter', 'url(#vg-ring)');
    const box = `${-PAD * u} ${-PAD * u} ${w * u} ${h * u}`;
    const xml = new XMLSerializer().serializeToString(clone)
      .replace(/viewBox="[^"]*"/, `viewBox="${box}" width="${w * scale}" height="${h * scale}"`);
    const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml' }));
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = w * scale;
      c.height = h * scale;
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      return c;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /** Stack the pieces into the visible canvas, with the moving parts in their current pose. */
  private compose() {
    const L = this.layers;
    if (!L) return;
    const { ctx } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, L.w, L.h);
    ctx.imageSmoothingEnabled = false;
    L.still.forEach((img, k) => {
      ctx.drawImage(img, 0, 0);
      const p = this.parts[k];
      if (!p || !L.parts[k]) return;
      // The pivot, from SVG units into the tilted art canvas; the sideways
      // shift (dy) also turns with the tilt.
      const x = 500 + (p.px - 500) * this.cos - (p.py - 385) * this.sin;
      const y = 385 + (p.px - 500) * this.sin + (p.py - 385) * this.cos;
      const ax = x / L.u + PAD, ay = y / L.u + PAD;
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.translate(ax - (this.sin * p.dy) / L.u, ay + (this.cos * p.dy) / L.u);
      ctx.rotate((p.deg * Math.PI) / 180);
      ctx.translate(-ax, -ay);
      ctx.drawImage(L.parts[k], 0, 0, L.w, L.h);
      ctx.restore();
    });
    // Outline rings for the hovered and the focused object.
    for (const el of new Set([this.focused, this.hovered])) {
      if (!el || this.dismissed.has(el)) continue;
      const ring = this.rings.get(el);
      if (ring instanceof HTMLCanvasElement) ctx.drawImage(ring, 0, 0);
      else if (!ring) this.makeRing(el, L);
    }
  }

  private makeRing(el: Element, L: Layers) {
    const range = this.ranges.get(el);
    if (!range) return;
    this.rings.set(el, 'pending');
    this.render((i) => i >= range[0] && i < range[1], L.u, L.w, L.h, 1, el)
      .then((c) => { if (this.layers === L) { this.rings.set(el, c); this.compose(); } })
      .catch(() => this.rings.delete(el));
  }

  /**
   * Measure part positions once per resize (reading them every frame would be slow),
   * and keep any open label, bubble or popup on its object.
   * @param offset shift from scene px to the grass layer's px, so gusts line up
   * @param px screen px per art px (the effects layer is in art px)
   */
  layout(offset: number, px: number) {
    for (const p of this.parts) {
      const r = this.rectIn(p.el);
      p.cx = r.x + r.w / 2 + offset;
      p.cy = r.y + r.h / 2 + offset;
    }
    const top = this.parts.find((p) => p.el.id === 'papers-top');
    if (top) {
      const r = this.rectIn(top.el);
      this.paper = { x: (r.x + r.w * 0.6) / px, y: (r.y + r.h * 0.3) / px, size: Math.max(1, Math.min(2, r.w / px / 30)) };
    }
    if (!this.label.hidden && this.labelFor) this.place(this.label, this.labelFor);
    if (this.cat) for (const b of [this.bubble, this.pop]) if (!b.hidden) this.place(b, this.cat, 4);
  }

  /** Where flying sheets start: the top of the paper stack, in art px. */
  paperSource() { return this.paper; }

  /** Per-frame movement. t in seconds (the scene's wind clock). */
  animate(t: number) {
    if (!this.svg) return;
    let changed = false;
    for (const p of this.parts) {
      const g = gust(p.cx, p.cy, t);
      let deg = 0, dy = 0;
      switch (p.el.id) {
        case 'hair': deg = g * 7 + Math.sin(t * 2.1) * 1.2; break;
        case 'book-page': deg = -g * 28 - Math.max(0, Math.sin(t * 3.7)) * 3; break;
        case 'papers-top': deg = -g * 4; dy = -g * 3; break;
        case 'cat-tail': {
          deg = Math.sin(t * 1.15) * 5;
          if (this.flickStart >= 0) {
            // The flick runs on real time, so it also plays when the wind is still.
            const k = performance.now() / 1000 - this.flickStart;
            if (k >= 1) this.flickStart = -1;
            else deg += 28 * Math.sin(k * Math.PI * 3) * (1 - k);
          }
        }
      }
      deg = Math.round(deg * 2) / 2;
      dy = Math.round(dy * 2) / 2;
      if (deg !== p.deg || dy !== p.dy) {
        p.deg = deg;
        p.dy = dy;
        p.wrap.setAttribute('transform', `translate(0 ${dy}) rotate(${deg} ${p.px} ${p.py})`);
        changed = true;
      }
    }
    if (changed) this.compose();
  }
}
