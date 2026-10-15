// Puts the scene together: layers, layout, animation loop, parallax,
// day/night, reduced motion, and pausing when off screen.
//
// Everything is drawn at a low "art" resolution and scaled up without
// smoothing, PX screen pixels per art pixel, for a painted-pixel look.
import { DAY, NIGHT, type ScenePalette } from './palette';
import { Sky } from './sky';
import { paintFar, paintMid, paintNear, ridge } from './hills';
import { createGrass, type GrassColors } from './grass';
import { Butterfly } from './butterfly';
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

/** Blade height at depth d (0 far .. 1 near), before random variation (art px). */
const bladeHeight = (H: number, d: number) => H * (0.012 + 0.03 * d + 0.09 * d * d);

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
    const h = bladeHeight(H, d) * (0.6 + r() * 0.8);
    rows.push([x, y, h, 1 + 1.6 * d + r() * 0.6, r(), d]);
  }
  rows.sort((a, b) => a[1] - b[1]); // far first, so near blades are drawn on top
  return new Float32Array(rows.flat());
}

/**
 * Grass just in front of the characters (art px), along the illustration's
 * ground line from x0 to x1. Tips stop a little above the line (by `reach`),
 * so the grass covers where things touch the ground but not the people and
 * objects. The blades are as tall as the field's at the same depth, rooted
 * lower to make up for it, so they bend in the wind just as far.
 */
function frontBlades(W: number, H: number, x0: number, x1: number, groundAt: (x: number) => number, reach: number): Float32Array {
  const r = rng(81);
  const top = ridge('near', W, H);
  const depthAt = (x: number, y: number) => Math.min(1, (y - top(x)) / (H - top(x)));
  const rows: number[][] = [];
  for (let i = 0; i < Math.round((x1 - x0) * 0.8); i++) {
    const x = x0 + r() * (x1 - x0);
    const tip = groundAt(x) - reach * (0.35 + r() * 0.65);
    const k = 0.7 + r() * 0.6;
    // The height depends on the depth of the root, which depends on the height: settle it in a few steps.
    let y = groundAt(x);
    for (let j = 0; j < 3; j++) y = tip + bladeHeight(H, depthAt(x, y)) * k;
    const depth = depthAt(x, y); // same depth as the field here, so sizes and colors match
    rows.push([x, y, y - tip, 1 + 1.6 * depth + r() * 0.6, r(), depth]);
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
  let field = createGrass($<HTMLCanvasElement>('.l-field'));
  let front = createGrass($<HTMLCanvasElement>('.l-front'));
  const fxC = $<HTMLCanvasElement>('.l-fx');
  const flyers = new Flyers(fxC);
  const fx = fxC.getContext('2d')!;
  const butterfly = new Butterfly();
  const vig = new Vignette(root, vigHost, () => reduced.matches, TILT);
  const colors = (): GrassColors => ({ ramp: pal.grass, flowers: pal.flowers });

  let PX = 2;
  let FW = 1; // the scene's width in art px
  let laidW = 0, laidH = 0; // the size the last layout was done for
  function layout() {
    const W = root.clientWidth, H = root.clientHeight;
    if (!W || !H) return;
    laidW = W;
    laidH = H;
    butterfly.leave(); // its stops would be out of date
    PX = pixelSize(W);
    const PW = W + MARGIN * 2, PH = H + MARGIN * 2;
    const AW = Math.ceil(PW / PX), AH = Math.ceil(PH / PX); // layer size in art px
    // Canvases are shown at exactly PX screen px per art px.
    const fit = (c: HTMLCanvasElement, w: number, h: number) => {
      c.style.width = `${w * PX}px`;
      c.style.height = `${h * PX}px`;
    };
    // (The drawing's own canvas is sized by the Vignette.)
    for (const c of root.querySelectorAll<HTMLCanvasElement>('canvas:not(.vignette-art)')) fit(c, AW, AH);

    sky.resize(AW, AH, pal);
    sky.draw(sceneTime(last)); // resizing cleared the canvas
    paintFar(layers.far, AW, AH, pal);
    paintMid(layers.mid, AW, AH, pal);
    paintNear(nearC, AW, AH, pal);

    // The characters lie up the slope (a little away from us), left of
    // center, head uphill. Position and size snap to whole art pixels so the
    // pixel grids line up.
    // Phones show it larger and centered; wide screens smaller and to the left,
    // blending smoothly in between (no jump at a breakpoint).
    const snap = (v: number) => Math.round(v / PX) * PX;
    const k = Math.min(1, Math.max(0, (PW - 560) / 440));
    const wide = k * k * (3 - 2 * k);
    const vw = snap(Math.min(Math.max(PW * 0.43, Math.min(PW * 0.88, 520)), PH * 1.4));
    const vh = vw * 0.42;
    const ground = PH * (0.8 - 0.04 * wide);
    const cx = PW * (0.5 - 0.08 * wide);
    Object.assign(vigHost.style, {
      left: `${snap(cx - vw / 2)}px`,
      top: `${snap(ground - vh * (385 / 420))}px`,
      width: `${vw}px`,
      height: `${vh}px`,
    });
    vig.setScale(PX, vw);

    field.resize(AW, AH, PX);
    field.setBlades(fieldBlades(AW, AH));
    front.resize(AW, AH, PX);
    const slope = Math.tan((TILT * Math.PI) / 180);
    front.setBlades(frontBlades(AW, AH, (cx - vw * 0.55) / PX, (cx + vw * 0.55) / PX, (x) => (ground + (x * PX - cx) * slope) / PX, (vh * 0.035) / PX));
    // The effects layer covers the scene itself (no margin).
    FW = Math.ceil(W / PX);
    const FH = Math.ceil(H / PX);
    flyers.resize(FW, FH, PX);
    fit(fxC, FW, FH);
    flyers.night = pal.night;
    vig.layout(MARGIN, PX);
    render(sceneTime(last), 0);
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
  const planeShift = { x: 0, y: 0 }; // art px, so flying pages start where the stack is now
  function parallax(dt: number) {
    const k = Math.min(1, dt * 4);
    cur.x += (target.x - cur.x) * k;
    cur.y += (target.y - cur.y) * k;
    for (const [name, d] of Object.entries(DEPTH) as [keyof typeof DEPTH, number][]) {
      const x = Math.round((-cur.x * d) / PX) * PX, y = Math.round((-cur.y * d * 0.5) / PX) * PX;
      layers[name].style.transform = `translate3d(${x}px, ${y}px, 0)`;
      if (name === 'plane') { planeShift.x = x / PX; planeShift.y = y / PX; }
    }
  }

  let frameNo = 0;
  function render(t: number, dt: number) {
    // Clouds move about one art pixel per second, so the sky only needs every other frame.
    if (!running || frameNo++ % 2 === 0) sky.draw(t);
    field.draw(t, colors(), 0.9);
    front.draw(t, colors(), 1);
    vig.animate(t);
    const src = running ? vig.paperSource() : null;
    flyers.update(t, dt, src && { ...src, x: src.x + planeShift.x, y: src.y + planeShift.y });
    if (running) {
      tourTick(dt);
      butterfly.update(fx, dt, planeShift, pal.night);
      parallax(dt);
    }
  }

  // The butterfly's tour, once per visit: it starts a moment after the
  // drawing is ready, while the scene is on screen with motion allowed.
  // Pressing anything in the scene, or moving focus into it, sends it away
  // (or stops it from starting). ?tour in the address shows it again.
  let tourWait = 1.2;
  let toured = (() => {
    try { return !new URLSearchParams(location.search).has('tour') && sessionStorage.getItem('scene-tour') === '1'; } catch { return false; }
  })();
  function tourTick(dt: number) {
    if (toured || !vig.ready || (tourWait -= dt) > 0) return;
    toured = true;
    try { sessionStorage.setItem('scene-tour', '1'); } catch { /* it may show again next time */ }
    const stops = vig.tourStops();
    butterfly.start(stops, FW, (i) => vig.ping(stops[i].el), () => vig.ping(null));
  }
  for (const type of ['pointerdown', 'keydown', 'focusin']) root.addEventListener(type, () => { toured = true; butterfly.leave(); });

  // Animation loop: runs only while on screen, with motion allowed.
  // The clock starts at the still frame's time, so nothing jumps when motion starts.
  let visible = true, running = false, raf = 0, last = 0;
  const start = performance.now();
  const clock = (now: number) => STILL_T + (now - start) / 1000;
  // Without WebGL the grass is a still image, so the wind clock stays still too.
  const sceneTime = (now: number) => (running && field.webgl ? clock(now) : STILL_T);
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    if (now - last < 1000 / FPS - 2) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    render(sceneTime(now), dt);
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
    pending = requestAnimationFrame(() => {
      if (root.clientWidth !== laidW || root.clientHeight !== laidH) layout();
    });
  }).observe(root);

  // If the GPU drops a canvas (driver reset, too many tabs), rebuild it when
  // it comes back. Each grass canvas is rebuilt only by its own restore event;
  // 2D canvases come back blank and just need repainting.
  root.addEventListener('webglcontextlost', (e) => e.preventDefault(), true);
  const relayout = () => {
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(layout);
  };
  root.addEventListener('webglcontextrestored', (e) => {
    const c = e.target as HTMLCanvasElement;
    if (c.classList.contains('l-field')) field = createGrass(c);
    if (c.classList.contains('l-front')) front = createGrass(c);
    relayout();
  }, true);
  root.addEventListener('contextrestored', relayout, true);
  reduced.addEventListener('change', update);
  dark.addEventListener('change', () => { pal = dark.matches ? NIGHT : DAY; layout(); });

  layout();
  root.dataset.ready = 'true';
  update();
}
