// Puts the scene together: layers, layout, animation loop, parallax,
// day/night, reduced motion, and pausing when off screen.
import { DAY, NIGHT, type ScenePalette } from './palette';
import { Sky } from './sky';
import { paintFar, paintMid, paintNear, ridge } from './hills';
import { BLADE_FLOATS, createGrass, type GrassColors } from './grass';
import { Flyers } from './flyers';
import { Vignette } from './vignette';
import { rng } from './wind';

/** Layers are this much larger than the scene on each side, so parallax never shows an edge. */
const MARGIN = 20;
const FPS = 40;
/** The characters lie along the hillside, so the drawing is turned to follow it (degrees). */
const TILT = 6;
/** Time used for the still frame (reduced motion): a moment with a nice gust. */
const STILL_T = 14;

/** The grass the field is made of: far blades are short and thin, near ones tall and wide. */
function fieldBlades(W: number, H: number): Float32Array {
  const top = ridge('near', W, H);
  let area = 0;
  for (let x = 0; x < W; x += 10) area += (H - top(x)) * 10;
  const n = Math.round(Math.min(26000, Math.max(3500, area / 26)));
  const r = rng(71);
  const rows: number[][] = [];
  for (let i = 0; i < n; i++) {
    const x = -10 + r() * (W + 20);
    const y0 = top(x);
    const d = r() ** 1.4; // more blades far away, where they are small
    const y = y0 + 1 + d * (H - y0 + 12);
    const h = H * (0.012 + 0.03 * d + 0.1 * d * d) * (0.6 + r() * 0.8);
    rows.push([x, y, h, 1.1 + 3.2 * d + r(), r(), d]);
  }
  rows.sort((a, b) => a[1] - b[1]); // far first, so near blades are drawn on top
  return new Float32Array(rows.flat());
}

/**
 * Grass in front of the characters. Blades grow from below the illustration's
 * ground line and their tips stop a little above it (by `reach` px), so the
 * grass covers where things touch the ground but not the people and objects.
 */
function frontBlades(W: number, H: number, groundAt: (x: number) => number, reach: number): Float32Array {
  const r = rng(81);
  const rows: number[][] = [];
  for (let i = 0; i < Math.round(W / 1.6); i++) {
    const x = -10 + r() * (W + 20);
    const g = groundAt(x);
    const y = g + 2 + r() * Math.max(4, H - g + 10);
    const h = y - g + reach * (0.35 + r() * 0.65);
    rows.push([x, y, h, 2 + r() * 4, r(), 1]);
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
  const flyers = new Flyers($<HTMLCanvasElement>('.l-fx'));
  const vig = new Vignette(root, vigHost, () => reduced.matches);
  const colors = (): GrassColors => ({ base: pal.grassBase, tip: pal.grassTip, gust: pal.grassGust, far: pal.grassFar });

  let W = 0, H = 0;
  function layout() {
    W = root.clientWidth;
    H = root.clientHeight;
    if (!W || !H) return;
    const PW = W + MARGIN * 2, PH = H + MARGIN * 2;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const dprGL = Math.min(devicePixelRatio || 1, 1.5);

    sky.resize(PW, PH, dpr, pal);
    paintFar(layers.far, PW, PH, dpr, pal);
    paintMid(layers.mid, PW, PH, dpr, pal);
    paintNear(nearC, PW, PH, dpr, pal);

    // The characters lie on the slope, a little left of center, head uphill.
    const narrow = PW < 700;
    const vw = Math.min(PW * (narrow ? 0.96 : 0.54), PH * 1.8);
    const vh = vw * 0.42;
    const ground = PH * 0.86;
    const cx = PW * (narrow ? 0.5 : 0.45);
    Object.assign(vigHost.style, {
      left: `${cx - vw / 2}px`,
      top: `${ground - vh * (385 / 420)}px`,
      width: `${vw}px`,
      height: `${vh}px`,
      transform: `rotate(${TILT}deg)`,
    });

    field.resize(PW, PH, dprGL);
    field.setBlades(fieldBlades(PW, PH));
    front.resize(PW, PH, dprGL);
    const slope = Math.tan((TILT * Math.PI) / 180);
    front.setBlades(frontBlades(PW, PH, (x) => ground + (x - cx) * slope, vh * 0.12));
    flyers.resize(W, H, dpr);
    flyers.night = pal.night;
    vig.layout(MARGIN);
    render(running ? clock(last) : STILL_T, 0);
  }

  // Parallax: layers follow the pointer by different amounts.
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
      layers[name].style.transform = `translate3d(${(-cur.x * d).toFixed(2)}px, ${(-cur.y * d * 0.5).toFixed(2)}px, 0)`;
    }
  }

  const grassAnimated = field.webgl;
  let frameNo = 0;
  function render(t: number, dt: number) {
    // Clouds move a few px per second, so the sky only needs every other frame.
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
