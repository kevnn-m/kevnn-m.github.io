// Puts the scene together: layers, layout, animation loop, parallax,
// day/night, reduced motion, and pausing when off screen.
//
// Everything is drawn at a low "art" resolution and scaled up without
// smoothing, PX screen pixels per art pixel, for a painted-pixel look.
import { DAY, NIGHT, type ScenePalette } from './palette';
import { Sky } from './sky';
import { paintFar, paintMid, paintNear, ridge } from './hills';
import { createGrass, type GrassColors } from './grass';
import { Flyers } from './flyers';
import { Vignette } from './vignette';
import { rng } from './wind';

/** Layers are this much larger than the scene on each side (CSS px), so parallax never shows an edge. */
const MARGIN = 21;
const FPS = 30;
/** The characters lie along the hillside, so the drawing is turned to follow it (degrees). */
const TILT = 6;
/** Time used for the still frame (reduced motion): a moment with a nice gust. */
const STILL_T = 14;
/** Screen pixels per art pixel. */
const pixelSize = (_width: number) => 2;

/** The grass the field is made of (art px): far blades short and thin, near ones tall and wide. */
function fieldBlades(W: number, H: number): Float32Array {
  const top = ridge('near', W, H);
  let area = 0;
  for (let x = 0; x < W; x += 4) area += (H - top(x)) * 4;
  const n = Math.round(Math.min(22000, Math.max(3000, area / 4.5)));
  const r = rng(71);
  const rows: number[][] = [];
  for (let i = 0; i < n; i++) {
    const x = -4 + r() * (W + 8);
    const y0 = top(x);
    const d = r() ** 1.3; // more blades far away, where they are small
    const y = y0 + 1 + d * (H - y0 + 4);
    const h = H * (0.012 + 0.03 * d + 0.09 * d * d) * (0.6 + r() * 0.8);
    rows.push([x, y, h, 1 + 1.6 * d + r() * 0.6, r(), d]);
  }
  rows.sort((a, b) => a[1] - b[1]); // far first, so near blades are drawn on top
  return new Float32Array(rows.flat());
}

/**
 * Grass just in front of the characters (art px): a band along the
 * illustration's ground line, from x0 to x1. Tips stop a little above the
 * line (by `reach`), so the grass covers where things touch the ground but
 * not the people and objects.
 */
function frontBlades(W: number, H: number, x0: number, x1: number, groundAt: (x: number) => number, reach: number): Float32Array {
  const r = rng(81);
  const top = ridge('near', W, H);
  const rows: number[][] = [];
  const band = H * 0.025;
  for (let i = 0; i < Math.round((x1 - x0) * 0.8); i++) {
    const x = x0 + r() * (x1 - x0);
    const g = groundAt(x);
    const y = g + 1 + r() * band;
    const h = y - g + reach * (0.35 + r() * 0.65);
    const depth = (y - top(x)) / (H - top(x)); // same depth as the field here, so colors match
    rows.push([x, y, h, 1 + 1.6 * depth + r() * 0.6, r(), depth]);
  }
  rows.sort((a, b) => a[1] - b[1]);
  return new Float32Array(rows.flat());
}

export function mountScene(root: HTMLElement) {
  const $ = <T extends Element>(s: string) => root.querySelector<T>(s)!;
  const layers = {
    sky: $<HTMLCanvasElement>('.l-sky'),
    far: $<HTMLCanvasElement>('.l-far'),
    mid: $<HTMLCanvasElement>('.l-mid'),
    plane: $<HTMLElement>('.l-plane'),
  };
  const nearC = $<HTMLCanvasElement>('.l-near');
  const vigHost = $<HTMLElement>('.vignette');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const dark = matchMedia('(prefers-color-scheme: dark)');
  const finePointer = matchMedia('(pointer: fine)');

  let pal: ScenePalette = dark.matches ? NIGHT : DAY;
  const sky = new Sky(layers.sky);
  const field = createGrass($<HTMLCanvasElement>('.l-field'));
  const front = createGrass($<HTMLCanvasElement>('.l-front'));
  const fxC = $<HTMLCanvasElement>('.l-fx');
  const flyers = new Flyers(fxC);
  const vig = new Vignette(root, vigHost, () => reduced.matches, TILT);
  const colors = (): GrassColors => ({ ramp: pal.grass, flowers: pal.flowers });

  let PX = 3;
  function layout() {
    const W = root.clientWidth, H = root.clientHeight;
    if (!W || !H) return;
    PX = pixelSize(W);
    const PW = W + MARGIN * 2, PH = H + MARGIN * 2;
    const AW = Math.ceil(PW / PX), AH = Math.ceil(PH / PX); // layer size in art px
    // Canvases are shown at exactly PX screen px per art px.
    const fit = (c: HTMLCanvasElement, w: number, h: number) => {
      c.style.width = `${w * PX}px`;
      c.style.height = `${h * PX}px`;
    };
    for (const c of root.querySelectorAll<HTMLCanvasElement>('canvas')) fit(c, AW, AH);

    sky.resize(AW, AH, pal);
    paintFar(layers.far, AW, AH, pal);
    paintMid(layers.mid, AW, AH, pal);
    paintNear(nearC, AW, AH, pal);

    // The characters lie up the slope (a little away from us), left of
    // center, head uphill. Position and size snap to whole art pixels so the
    // pixel grids line up.
    const snap = (v: number) => Math.round(v / PX) * PX;
    const narrow = PW < 700;
    const vw = snap(Math.min(PW * (narrow ? 0.88 : 0.43), PH * 1.4));
    const vh = vw * 0.42;
    const ground = PH * (narrow ? 0.8 : 0.76);
    const cx = PW * (narrow ? 0.5 : 0.42);
    Object.assign(vigHost.style, {
      left: `${snap(cx - vw / 2)}px`,
      top: `${snap(ground - vh * (385 / 420))}px`,
      width: `${vw}px`,
      height: `${vh}px`,
    });
    vig.setPixelSize((PX * 1000) / vw);

    field.resize(AW, AH, PX);
    field.setBlades(fieldBlades(AW, AH));
    front.resize(AW, AH, PX);
    const slope = Math.tan((TILT * Math.PI) / 180);
    front.setBlades(frontBlades(AW, AH, (cx - vw * 0.55) / PX, (cx + vw * 0.55) / PX, (x) => (ground + (x * PX - cx) * slope) / PX, (vh * 0.035) / PX));
    // The effects layer covers the scene itself (no margin).
    const FW = Math.ceil(W / PX), FH = Math.ceil(H / PX);
    flyers.resize(FW, FH, PX);
    fit(fxC, FW, FH);
    flyers.night = pal.night;
    vig.layout(MARGIN, PX);
    render(running ? clock(last) : STILL_T, 0);
  }

  // Parallax: layers follow the pointer by different amounts, in whole art pixels.
  const target = { x: 0, y: 0 }, cur = { x: 0, y: 0 };
  root.addEventListener('pointermove', (e) => {
    if (!finePointer.matches || reduced.matches) return;
    const r = root.getBoundingClientRect();
    target.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    target.y = ((e.clientY - r.top) / r.height) * 2 - 1;
  });
  root.addEventListener('pointerleave', () => { target.x = 0; target.y = 0; });
  const DEPTH = { sky: 3, far: 6, mid: 10, plane: 16 } as const;
  function parallax(dt: number) {
    const k = Math.min(1, dt * 4);
    cur.x += (target.x - cur.x) * k;
    cur.y += (target.y - cur.y) * k;
    for (const [name, d] of Object.entries(DEPTH) as [keyof typeof DEPTH, number][]) {
      const x = Math.round((-cur.x * d) / PX) * PX, y = Math.round((-cur.y * d * 0.5) / PX) * PX;
      layers[name].style.transform = `translate3d(${x}px, ${y}px, 0)`;
    }
  }

  const grassAnimated = field.webgl;
  let frameNo = 0;
  function render(t: number, dt: number) {
    // Clouds move about one art pixel per second, so the sky only needs every other frame.
    if (!running || frameNo++ % 2 === 0) sky.draw(t);
    field.draw(t, colors(), 0.9);
    front.draw(t, colors(), 1);
    vig.animate(t);
    flyers.update(t, dt, running ? vig.paperSource() : null);
    if (running) parallax(dt);
  }

  // Animation loop: runs only while on screen, with motion allowed.
  // The clock starts at the still frame's time, so nothing jumps when motion starts.
  let visible = true, running = false, raf = 0, last = 0;
  const start = performance.now();
  const clock = (now: number) => STILL_T + (now - start) / 1000;
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    if (now - last < 1000 / FPS - 2) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    render(grassAnimated ? clock(now) : STILL_T, dt);
  };
  function update() {
    cancelAnimationFrame(raf);
    running = visible && !reduced.matches;
    if (running) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    } else {
      render(STILL_T, 0);
    }
  }

  new IntersectionObserver(([e]) => { visible = e.isIntersecting; update(); }).observe(root);
  let pending = 0;
  new ResizeObserver(() => {
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(layout);
  }).observe(root);
  reduced.addEventListener('change', update);
  dark.addEventListener('change', () => { pal = dark.matches ? NIGHT : DAY; layout(); });

  layout();
  root.dataset.ready = 'true';
  update();
}
