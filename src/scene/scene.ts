// Draws the pixel scene: sky, clouds or stars, grass moving in the wind, and
// the objects you can hover (each one is a real link placed over the canvas).
import { CLOUD, PALETTES, SPRITES, type Palette, type Sprite } from './sprites';

const H = 48; // canvas height in "pixels" (each is drawn as a 3x3 to 5x5 block)
const GROUND = H - 4; // y of the ground line
const SINK = 1; // how far objects sit down into the grass
const GAP = 9; // pixels between objects
const FPS = 20; // a low frame rate suits pixel art and saves battery

interface Blade { x: number; h: number; color: number; phase: number }
interface Obj { el: HTMLAnchorElement; sprite: Sprite; x: number; y: number; w: number; h: number; hover: boolean }

// Small seeded random, so the grass looks the same on every load.
const rng = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

const spriteWidth = (s: Sprite) => Math.max(...s.map((row) => row.length));

export function mountScene(root: HTMLElement) {
  const canvas = root.querySelector('canvas')!;
  const ctx = canvas.getContext('2d')!;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const dark = matchMedia('(prefers-color-scheme: dark)');
  let pal: Palette = dark.matches ? PALETTES.night : PALETTES.day;

  const objs: Obj[] = [...root.querySelectorAll<HTMLAnchorElement>('a[data-sprite]')].map((el) => {
    const sprite = SPRITES[el.dataset.sprite!];
    return { el, sprite, x: 0, y: 0, w: spriteWidth(sprite), h: sprite.length, hover: false };
  });

  let W = 0;
  let scale = 4;
  let back: Blade[] = [];
  let front: Blade[] = [];
  let stars: { x: number; y: number; p: number }[] = [];

  function layout() {
    scale = root.clientWidth >= 1000 ? 5 : root.clientWidth >= 560 ? 4 : 3;
    W = Math.ceil(root.clientWidth / scale);
    canvas.width = W;
    canvas.height = H;
    canvas.style.width = `${W * scale}px`;
    canvas.style.height = `${H * scale}px`;
    root.style.height = `${H * scale}px`;

    // Objects sit in a row in the middle.
    const total = objs.reduce((n, o) => n + o.w, 0) + GAP * (objs.length - 1);
    let x = Math.floor((W - total) / 2);
    for (const o of objs) {
      o.x = x;
      o.y = GROUND - o.h + SINK;
      x += o.w + GAP;
      const pad = 2; // make the link a little larger than the sprite
      Object.assign(o.el.style, {
        left: `${(o.x - pad) * scale}px`,
        top: `${(o.y - pad) * scale}px`,
        width: `${(o.w + pad * 2) * scale}px`,
        height: `${(o.h + pad * 2) * scale}px`,
      });
    }

    const r = rng(7);
    back = [];
    front = [];
    for (let x = 0; x < W; x++) {
      for (let i = 0; i < 2; i++) back.push({ x, h: 4 + Math.floor(r() * 7), color: Math.floor(r() * 3), phase: r() * 6 });
      if (r() < 0.7) front.push({ x, h: 1 + Math.floor(r() * 4), color: Math.floor(r() * 3), phase: r() * 6 });
    }
    stars = Array.from({ length: Math.floor(W / 6) }, () => ({ x: Math.floor(r() * W), y: Math.floor(r() * (H - 18)), p: r() * 6 }));
  }

  // Wind: a steady sway plus gusts that roll across the field.
  const wind = (x: number, t: number, phase: number) => {
    const sway = Math.sin(t * 1.4 + x * 0.09 + phase * 0.3) * 0.9;
    const gx = ((t * 28) % (W + 120)) - 60;
    const gust = 2.6 * Math.exp(-(((x - gx) / 16) ** 2));
    return sway + gust;
  };

  function px(x: number, y: number) {
    ctx.fillRect(x, y, 1, 1);
  }

  function drawSky(t: number) {
    const band = Math.ceil(H / pal.sky.length);
    pal.sky.forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.fillRect(0, i * band, W, band);
      // dither the edge into the next band
      if (i + 1 < pal.sky.length) {
        ctx.fillStyle = pal.sky[i + 1];
        for (let x = i % 2; x < W; x += 2) px(x, (i + 1) * band - 1);
      }
    });
    if (pal.stars) {
      for (const s of stars) {
        ctx.fillStyle = Math.sin(t * 2 + s.p) > 0.6 ? '#ffffff' : '#9fb0d8';
        px(s.x, s.y);
      }
      if (pal.moon) {
        // Crescent: a disc with a second, offset disc cut out of it.
        ctx.fillStyle = pal.moon;
        const mx = W - 22, my = 9;
        for (let dy = -5; dy <= 5; dy++) {
          for (let dx = -5; dx <= 5; dx++) {
            const inDisc = dx * dx + dy * dy <= 25;
            const inCut = (dx - 2.4) ** 2 + dy * dy <= 4.6 ** 2;
            if (inDisc && !inCut) px(mx + dx, my + dy);
          }
        }
      }
    } else {
      [0, 1, 2].forEach((i) => {
        const cx = Math.floor(((i * W) / 3 + t * (2 + i)) % (W + 20)) - 18;
        drawSprite(CLOUD, cx, 3 + i * 5);
      });
    }
  }

  function drawGrass(blades: Blade[], colors: string[], t: number, base: number) {
    for (let c = 0; c < colors.length; c++) {
      ctx.fillStyle = colors[c];
      for (const b of blades) {
        if (b.color !== c) continue;
        const bend = wind(b.x, t, b.phase) * (b.h / 10);
        for (let j = 0; j < b.h; j++) px(b.x + Math.round(bend * (j / b.h) ** 2), base - j);
      }
    }
  }

  function drawSprite(s: Sprite, x0: number, y0: number, outline?: string) {
    if (outline) {
      ctx.fillStyle = outline;
      s.forEach((row, y) => [...row].forEach((ch, x) => {
        if (ch !== '.') ctx.fillRect(x0 + x - 1, y0 + y - 1, 3, 3);
      }));
    }
    s.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch === '.') return;
      ctx.fillStyle = pal.sprite[ch] ?? '#ff00ff';
      px(x0 + x, y0 + y);
    }));
  }

  function draw(t: number) {
    drawSky(t);
    ctx.fillStyle = pal.grassBack[0];
    ctx.fillRect(0, GROUND + 1, W, H - GROUND - 1); // soil under the blades
    drawGrass(back, pal.grassBack, t, GROUND);
    for (const o of objs) drawSprite(o.sprite, o.x, o.y - (o.hover ? 1 : 0), o.hover ? pal.highlight : undefined);
    drawGrass(front, pal.grassFront, t, H - 1);
    ctx.fillStyle = pal.ground;
    ctx.fillRect(0, H - 1, W, 1);
  }

  // Animation loop. Runs only while the scene is on screen and motion is allowed.
  let visible = true;
  let raf = 0;
  let last = 0;
  const loop = (now: number) => {
    raf = requestAnimationFrame(loop);
    if (now - last < 1000 / FPS) return;
    last = now;
    draw(now / 1000);
  };
  const update = () => {
    cancelAnimationFrame(raf);
    if (visible && !reduced.matches) raf = requestAnimationFrame(loop);
    else draw(0);
  };
  const redrawIfStill = () => { if (reduced.matches || !visible) draw(0); };

  for (const o of objs) {
    const on = () => { o.hover = true; redrawIfStill(); };
    const off = () => { o.hover = false; redrawIfStill(); };
    o.el.addEventListener('pointerenter', on);
    o.el.addEventListener('pointerleave', off);
    o.el.addEventListener('focus', on);
    o.el.addEventListener('blur', off);
  }

  new IntersectionObserver(([e]) => { visible = e.isIntersecting; update(); }).observe(root);
  new ResizeObserver(() => { layout(); draw(last / 1000); }).observe(root);
  reduced.addEventListener('change', update);
  dark.addEventListener('change', () => { pal = dark.matches ? PALETTES.night : PALETTES.day; redrawIfStill(); });

  layout();
  root.dataset.ready = 'true';
  update();
}
