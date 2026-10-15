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
// Every object has a small label that stays next to it. Hover or keyboard
// focus draws an outline ring around the object and raises its label. The
// papers and the person are links to sections of the page; the book, the
// camera and the cat open a popup with a link (the cat first flicks its tail
// and says "mrrp").
import type { PageSource } from './flyers';
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
  private targets: SVGGraphicsElement[] = [];
  private tags = new Map<SVGElement, HTMLElement>(); // the label by each object
  private anchors = new Map<SVGElement, { x: number; y: number }>(); // label points, in the plane's CSS px
  private pops = new Map<SVGElement, HTMLElement>(); // popups, for the objects that have one
  private openPop: SVGElement | null = null; // the object whose popup is open
  private poking: SVGElement | null = null; // the cat, while it says "mrrp"
  private bubble: HTMLElement;
  private hovered: SVGElement | null = null;
  private focused: SVGElement | null = null;
  private pinged: SVGElement | null = null; // pointed out for a moment (the butterfly's visit)
  private active = new Set<SVGElement>(); // outlined, with a raised label
  private dismissed = new Set<SVGElement>(); // lowered with Escape until the pointer leaves them
  private flickStart = -1;
  private bubbleTimer = 0;
  private pingTimer = 0;
  private offset = 0;
  private px = 1;
  /** True once the drawing is on screen. */
  ready = false;
  private paper: PageSource | null = null;
  private layers: Layers | null = null;
  private rings = new Map<Element, HTMLCanvasElement | 'pending'>();
  private gen = 0;
  private cos: number;
  private sin: number;

  constructor(private root: HTMLElement, host: HTMLElement, private reduced: () => boolean, tilt: number) {
    this.svg = host.querySelector('svg');
    this.bubble = root.querySelector('.cat-bubble')!;
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

    const tagLayer = root.querySelector<HTMLElement>('.scene-tags');
    this.targets = [...svg.querySelectorAll<SVGGraphicsElement>('a, [role=button]')];
    for (const el of this.targets) {
      this.ranges.set(el, rangeOf(el));
      const hover = (on: boolean) => {
        this.hovered = on ? el : null;
        if (!on) this.dismissed.delete(el);
        this.refresh();
      };
      el.addEventListener('pointerenter', () => hover(true));
      el.addEventListener('pointerleave', () => hover(false));
      el.addEventListener('focus', () => { this.focused = el.matches(':focus-visible') ? el : null; this.refresh(); });
      el.addEventListener('blur', () => { this.focused = null; this.refresh(); });

      // Its label works like the object for the mouse and touch. It is hidden
      // from screen readers; the object itself has the same name.
      const tag = document.createElement('div');
      tag.className = 'scene-tag';
      tag.setAttribute('aria-hidden', 'true');
      tag.textContent = el.getAttribute('aria-label') ?? '';
      tag.addEventListener('pointerenter', () => hover(true));
      tag.addEventListener('pointerleave', () => hover(false));
      // cancelable, so the popup objects can stop it from following their link
      tag.addEventListener('click', () => el.dispatchEvent(new MouseEvent('click', { cancelable: true })));
      tagLayer?.append(tag);
      this.tags.set(el, tag);

      // Objects with a popup act as buttons. The book and the camera are
      // links in the SVG, so without JavaScript they still go to their pages.
      const pop = el.dataset.pop ? root.querySelector<HTMLElement>(`#${el.dataset.pop}`) : null;
      if (!pop) continue;
      this.pops.set(el, pop);
      el.setAttribute('role', 'button');
      el.setAttribute('aria-haspopup', 'dialog');
      el.setAttribute('aria-expanded', 'false');
      el.setAttribute('aria-controls', pop.id);
      el.addEventListener('click', (e) => {
        // Ctrl-, Cmd- or Shift-click on a link still opens its page in a new tab or window.
        if (el.hasAttribute('href') && (e.ctrlKey || e.metaKey || e.shiftKey)) return;
        e.preventDefault();
        this.toggle(el);
      });
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.toggle(el); }
      });
      // Moving focus away from the cat while it says "mrrp" cancels the popup.
      el.addEventListener('blur', (e) => { if (!pop.contains(e.relatedTarget as Node)) this.cancelPoke(); });
      pop.addEventListener('keydown', (e) => {
        // The popup sits outside the drawing, so Tab would leave the scene. Instead,
        // Shift+Tab from its first control goes back to the object, and Tab from its
        // last control goes on from the object to the next one.
        const stops = [...pop.querySelectorAll<HTMLElement>('a, button')];
        if (e.key !== 'Tab' || e.target !== stops[e.shiftKey ? 0 : stops.length - 1]) return;
        if (e.shiftKey) e.preventDefault();
        this.closePop(true);
      });
      pop.addEventListener('focusout', (e) => {
        const to = e.relatedTarget as Node | null;
        if (to && !pop.contains(to) && !el.contains(to)) this.closePop(false);
      });
      pop.querySelector('.pop-close')?.addEventListener('click', () => this.closePop(true));
    }
    // A press anywhere else closes the popup (or stops the "mrrp").
    document.addEventListener('pointerdown', (e) => {
      const el = this.openPop ?? this.poking;
      const t = e.target as Node;
      if (!el || el.contains(t) || this.pops.get(el)?.contains(t) || this.tags.get(el)?.contains(t)) return;
      this.cancelPoke();
      this.closePop(false);
    });
    // Escape closes the popup (or stops the "mrrp"); focus goes back to the
    // object only if it was in the popup. Otherwise Escape lowers the raised
    // label and outline of the hovered object (WCAG 1.4.13). The focus ring stays.
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (this.openPop || this.poking) {
        const inPop = !!this.openPop && this.pops.get(this.openPop)!.contains(document.activeElement);
        this.cancelPoke();
        this.closePop(inPop);
        return;
      }
      if (this.hovered) this.dismissed.add(this.hovered);
      this.ping(null);
    });
  }

  /** Position of an element relative to the scene, in CSS px. */
  private rectIn(el: Element) {
    const r = el.getBoundingClientRect();
    const o = this.root.getBoundingClientRect();
    return { x: r.left - o.left, y: r.top - o.top, w: r.width, h: r.height };
  }

  /** Show a box (bubble, popup) above an element, kept inside the scene. */
  private place(box: HTMLElement, el: Element) {
    box.hidden = false; // must be visible to measure
    const r = this.rectIn(el);
    const W = this.root.clientWidth;
    const half = box.offsetWidth / 2;
    const lo = 8 + half, hi = W - 11 - half; // 11: room for the 3px block shadow
    const cx = r.x + r.w / 2;
    box.style.left = `${lo > hi ? W / 2 : Math.min(hi, Math.max(lo, cx))}px`;
    box.style.top = `${Math.max(box.offsetHeight + 6, r.y - 4)}px`;
  }

  /** Update the outlines and labels from the hover, focus, ping and popup state. */
  private refresh() {
    const hovered = this.hovered && !this.dismissed.has(this.hovered) ? this.hovered : null;
    this.active = new Set([this.focused, hovered, this.pinged].filter((el): el is SVGElement => !!el));
    for (const [el, tag] of this.tags) {
      tag.hidden = el === this.openPop || el === this.poking; // the popup or "mrrp" takes its place
      tag.classList.toggle('is-active', this.active.has(el));
    }
    this.compose();
  }

  private toggle(el: SVGElement) {
    if (this.openPop === el) { this.closePop(true); return; }
    this.cancelPoke();
    this.closePop(false);
    if (el.id === 'cat') this.poke(el);
    else this.open(el);
  }

  /** Show an object's popup. Keyboard focus moves into it if it was on the object. */
  private open(el: SVGElement) {
    const pop = this.pops.get(el);
    if (!pop) return;
    this.openPop = el;
    this.place(pop, el);
    el.setAttribute('aria-expanded', 'true');
    if (document.activeElement === el) pop.querySelector<HTMLElement>('a')?.focus({ preventScroll: true });
    this.refresh();
  }

  /** The cat: tail flick and "mrrp", then its popup. */
  private poke(cat: SVGElement) {
    if (!this.reduced()) this.flickStart = performance.now() / 1000;
    this.poking = cat;
    this.place(this.bubble, cat);
    clearTimeout(this.bubbleTimer);
    this.bubbleTimer = window.setTimeout(() => {
      this.bubble.hidden = true;
      this.poking = null;
      this.open(cat);
    }, this.reduced() ? 300 : 1100);
    this.refresh();
  }

  private cancelPoke() {
    clearTimeout(this.bubbleTimer);
    this.bubble.hidden = true;
    if (this.poking) { this.poking = null; this.refresh(); }
  }

  private closePop(returnFocus: boolean) {
    const el = this.openPop;
    if (!el) return;
    this.openPop = null;
    this.pops.get(el)!.hidden = true;
    el.setAttribute('aria-expanded', 'false');
    if (returnFocus) el.focus({ preventScroll: true });
    this.refresh();
  }

  /**
   * Point out an object for a moment: outline it and raise its label with a
   * small hop (the butterfly's visit). null ends it.
   */
  ping(el: SVGElement | null) {
    clearTimeout(this.pingTimer);
    if (this.pinged) this.tags.get(this.pinged)?.classList.remove('is-pinged'); // end the last hop
    this.pinged = el;
    const tag = el && this.tags.get(el);
    if (tag) {
      void tag.offsetWidth; // restart the hop
      tag.classList.add('is-pinged');
      this.pingTimer = window.setTimeout(() => this.ping(null), 1400);
    }
    this.refresh();
  }

  /** The objects from left to right, with their label points in art px (scene, without the parallax shift). */
  tourStops() {
    return [...this.anchors].map(([el, a]) => ({ el, x: (a.x - this.offset) / this.px, y: (a.y - this.offset) / this.px })).sort((a, b) => a.x - b.x);
  }

  /**
   * Put each label just above its object's label point (data-label, in SVG
   * units), inside the scene. A label that would cover one placed before it
   * moves up; its pointer still points at the object.
   */
  private placeTags() {
    const W = this.root.clientWidth, o = this.offset, GAP = 6;
    const placed: { l: number; r: number; t: number; b: number }[] = [];
    for (const { el } of this.tourStops()) {
      const tag = this.tags.get(el)!, a = this.anchors.get(el)!;
      const hidden = tag.hidden;
      tag.hidden = false; // must be visible to measure
      const w = tag.offsetWidth, h = tag.offsetHeight;
      tag.hidden = hidden;
      const x = Math.min(o + W - 6 - w / 2, Math.max(o + 6 + w / 2, a.x));
      let b = a.y - GAP;
      for (let moved = true; moved;) {
        moved = false;
        for (const p of placed) {
          if (x - w / 2 < p.r + 4 && x + w / 2 > p.l - 4 && b - h < p.b + 2 && b > p.t - 2) { b = p.t - 4; moved = true; }
        }
      }
      b = Math.max(o + h + 4, b);
      placed.push({ l: x - w / 2, r: x + w / 2, t: b - h, b });
      Object.assign(tag.style, { left: `${Math.round(x - w / 2)}px`, top: `${Math.round(b - h)}px` });
      tag.style.setProperty('--dx', `${Math.round(a.x - x)}px`);
    }
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
      this.ready = true;
      this.root.dataset.art = 'ready';
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
    // Outline rings for the hovered, focused and pinged objects.
    for (const el of this.active) {
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
   * place the labels, and keep any open bubble or popup on its object.
   * @param offset shift from scene px to the grass layer's px, so gusts line up
   * @param px screen px per art px (the effects layer is in art px)
   */
  layout(offset: number, px: number) {
    for (const p of this.parts) {
      const r = this.rectIn(p.el);
      p.cx = r.x + r.w / 2 + offset;
      p.cy = r.y + r.h / 2 + offset;
    }
    // The top sheet of the stack (data-sheet: center x, y, width, depth in SVG
    // units), measured in the drawing's own layout, so the parallax shift
    // is not included.
    const top = this.parts.find((p) => p.el.id === 'papers-top');
    const sheet = top?.el.dataset.sheet?.trim().split(/[\s,]+/).map(Number);
    const m = top?.el.getCTM();
    const host = this.svg?.parentElement;
    if (sheet?.length === 4 && sheet.every(Number.isFinite) && m && host) {
      const c = new DOMPoint(sheet[0], sheet[1]).matrixTransform(m);
      const unit = Math.hypot(m.a, m.b) / px; // art px per SVG unit
      this.paper = {
        x: (host.offsetLeft - offset + c.x) / px, y: (host.offsetTop - offset + c.y) / px,
        w: sheet[2] * unit, d: sheet[3] * unit, roll: Math.atan2(m.b, m.a),
      };
    }
    // Label points, in the plane's CSS px (the labels move with the plane).
    this.offset = offset;
    this.px = px;
    if (host) {
      for (const el of this.targets) {
        let a = el.dataset.label?.trim().split(/[\s,]+/).map(Number);
        if (a?.length !== 2 || !a.every(Number.isFinite)) { const b = el.getBBox(); a = [b.x + b.width / 2, b.y]; }
        const ctm = el.getCTM();
        if (!ctm) continue;
        const c = new DOMPoint(a[0], a[1]).matrixTransform(ctm);
        this.anchors.set(el, { x: host.offsetLeft + c.x, y: host.offsetTop + c.y });
      }
      this.placeTags();
    }
    if (this.openPop) this.place(this.pops.get(this.openPop)!, this.openPop);
    if (this.poking) this.place(this.bubble, this.poking);
  }

  /** Where flying pages start: the top sheet of the stack, in art px (without the parallax shift). */
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
