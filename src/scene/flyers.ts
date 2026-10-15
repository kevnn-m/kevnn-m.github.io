// Effects layer (art pixels): sheets of paper that blow off the stack when a
// gust passes, and fireflies at night.
import { gust, rng } from './wind';

interface Sheet { x: number; y: number; vx: number; vy: number; flip: number; flipSpeed: number; size: number }
interface Fly { x: number; y: number; p: number; speed: number }

export class Flyers {
  private ctx: CanvasRenderingContext2D;
  private W = 1;
  private H = 1;
  private px = 1;
  private sheets: Sheet[] = [];
  private flies: Fly[] = [];
  private cooldown = 2;
  private r = rng(51);
  night = false;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  /** W, H in art px; px = CSS px per art px. */
  resize(W: number, H: number, px: number) {
    Object.assign(this, { W, H, px });
    this.canvas.width = W;
    this.canvas.height = H;
    const r = rng(61);
    this.flies = Array.from({ length: Math.max(6, Math.round(W / 24)) }, () => ({
      x: r() * W, y: H * (0.5 + r() * 0.45), p: r() * 100, speed: 0.3 + r() * 0.5,
    }));
  }

  private wind(x: number, y: number, t: number) {
    return gust(x * this.px, y * this.px, t);
  }

  /**
   * Advance and draw one frame.
   * @param src where new sheets start (top of the paper stack, art px), or null to spawn none
   */
  update(t: number, dt: number, src: { x: number; y: number; size: number } | null) {
    const { ctx, W, H, r } = this;
    ctx.clearRect(0, 0, W, H);

    // A new sheet: only during a gust at the stack, a few seconds apart, at most 3 in the air.
    this.cooldown -= dt;
    if (src && this.cooldown <= 0 && this.sheets.length < 3 && this.wind(src.x, src.y, t) > 0.55) {
      this.sheets.push({ x: src.x, y: src.y, vx: 10 + r() * 10, vy: -(16 + r() * 14), flip: 0, flipSpeed: 2 + r() * 3, size: src.size });
      this.cooldown = 4 + r() * 5;
    }

    for (const s of this.sheets) {
      const g = this.wind(s.x, s.y, t);
      s.vx += ((14 + g * 55) - s.vx) * Math.min(1, dt * 0.8);
      s.vy += (5 - g * 20) * dt;
      s.vy = Math.max(-40, Math.min(20, s.vy));
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.flip += s.flipSpeed * dt;
      this.drawSheet(s);
    }
    this.sheets = this.sheets.filter((s) => s.x < W + 20 && s.y > -20 && s.y < H + 20);

    if (this.night) {
      for (const f of this.flies) {
        const x = Math.round(f.x + Math.sin(t * f.speed + f.p) * 10 + Math.sin(t * 0.13 + f.p) * 20);
        const y = Math.round(f.y + Math.cos(t * f.speed * 1.3 + f.p) * 6);
        const glow = 0.5 + 0.5 * Math.sin(t * 2.2 + f.p * 3);
        if (glow < 0.15) continue;
        if (glow > 0.45) {
          ctx.fillStyle = 'rgba(255, 236, 140, 0.35)';
          ctx.fillRect(x - 1, y, 3, 1);
          ctx.fillRect(x, y - 1, 1, 3);
        }
        ctx.fillStyle = glow > 0.6 ? '#fff6b0' : '#d9c96a';
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }

  /** A small pixel page that narrows as it turns over. */
  private drawSheet(s: Sheet) {
    const { ctx } = this;
    const face = Math.cos(s.flip);
    const w = Math.max(1, Math.round(4 * s.size * Math.abs(face)));
    const h = Math.round(5 * s.size);
    const x = Math.round(s.x - w / 2), y = Math.round(s.y - h / 2);
    ctx.fillStyle = face > 0 ? '#fbfaf2' : '#d3d9e1';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(70, 60, 50, 0.45)';
    ctx.fillRect(x, y + h - 1, w, 1); // shaded bottom edge
    if (face > 0 && w >= 3) {
      ctx.fillStyle = '#9aa3b2';
      for (let ly = y + 1; ly < y + h - 1; ly += 2) ctx.fillRect(x + 1, ly, w - 2, 1);
    }
  }
}
