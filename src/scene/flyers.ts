// Effects layer: sheets of paper that blow off the stack when a gust passes,
// and fireflies at night.
import { gust, rng } from './wind';

interface Sheet { x: number; y: number; vx: number; vy: number; rot: number; spin: number; flip: number; flipSpeed: number; size: number }
interface Fly { x: number; y: number; p: number; speed: number }

export class Flyers {
  private ctx: CanvasRenderingContext2D;
  private W = 1;
  private H = 1;
  private dpr = 1;
  private sheets: Sheet[] = [];
  private flies: Fly[] = [];
  private cooldown = 2;
  private r = rng(51);
  night = false;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  resize(W: number, H: number, dpr: number) {
    Object.assign(this, { W, H, dpr });
    this.canvas.width = Math.round(W * dpr);
    this.canvas.height = Math.round(H * dpr);
    const r = rng(61);
    this.flies = Array.from({ length: Math.round(W / 70) }, () => ({
      x: r() * W, y: H * (0.55 + r() * 0.4), p: r() * 100, speed: 0.3 + r() * 0.5,
    }));
  }

  /**
   * Advance and draw one frame.
   * @param src where new sheets start (the top of the paper stack), or null to spawn none
   */
  update(t: number, dt: number, src: { x: number; y: number; scale: number } | null) {
    const { ctx, W, H, r } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // New sheet: only during a gust at the stack, a few seconds apart, at most 3 in the air.
    this.cooldown -= dt;
    if (src && this.cooldown <= 0 && this.sheets.length < 3 && gust(src.x, src.y, t) > 0.55) {
      this.sheets.push({
        x: src.x, y: src.y, vx: 30 + r() * 30, vy: -(50 + r() * 40),
        rot: r() * 6.28, spin: (r() - 0.5) * 3, flip: 0, flipSpeed: 2 + r() * 3, size: src.scale,
      });
      this.cooldown = 4 + r() * 5;
    }

    for (const s of this.sheets) {
      const g = gust(s.x, s.y, t);
      s.vx += ((40 + g * 160) - s.vx) * Math.min(1, dt * 0.8);
      s.vy += (14 - g * 60) * dt;
      s.vy = Math.max(-120, Math.min(60, s.vy));
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.rot += s.spin * dt;
      s.flip += s.flipSpeed * dt;
      this.drawSheet(s);
    }
    this.sheets = this.sheets.filter((s) => s.x < W + 60 && s.y > -60 && s.y < H + 60);

    if (this.night) {
      for (const f of this.flies) {
        const x = f.x + Math.sin(t * f.speed + f.p) * 30 + Math.sin(t * 0.13 + f.p) * 60;
        const y = f.y + Math.cos(t * f.speed * 1.3 + f.p) * 18;
        const glow = 0.5 + 0.5 * Math.sin(t * 2.2 + f.p * 3);
        const rad = 7;
        const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
        g.addColorStop(0, `rgba(255, 244, 160, ${0.9 * glow})`);
        g.addColorStop(1, 'rgba(255, 244, 160, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      }
    }
  }

  private drawSheet(s: Sheet) {
    const { ctx } = this;
    const w = 12 * s.size, h = 15 * s.size;
    const face = Math.cos(s.flip); // tumbling: the sheet narrows as it turns
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.rot);
    ctx.scale(Math.max(0.08, Math.abs(face)), 1);
    ctx.fillStyle = face > 0 ? '#fbfaf3' : '#dfe3e8';
    ctx.strokeStyle = 'rgba(80, 70, 60, 0.35)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.rect(-w / 2, -h / 2, w, h);
    ctx.fill();
    ctx.stroke();
    if (face > 0) {
      ctx.strokeStyle = 'rgba(120, 130, 145, 0.6)';
      for (let i = 0; i < 4; i++) {
        const ly = -h / 2 + h * (0.25 + i * 0.17);
        ctx.beginPath();
        ctx.moveTo(-w * 0.32, ly);
        ctx.lineTo(w * (i === 3 ? 0.05 : 0.32), ly);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}
