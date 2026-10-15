// The butterfly that shows a new visitor around the scene: it flies from
// object to object, left to right, and rests a moment on each while the
// object's label hops. It leaves a light dotted trail that fades, then flies
// away. Drawn on the effects layer, in art px.

export interface Stop { x: number; y: number }

// Seen from above, wings open, half open and up. w: wing, e: wing edge, b: body.
const FRAMES = [
  ['.ee...ee.', 'ewwe.ewwe', 'ewwwbwwwe', '.ewwbwwe.', '..ewbwe..', '.ewwbwwe.', '..ee.ee..'],
  ['.........', '..ee.ee..', '.ewwbwwe.', '..ewbwe..', '..ewbwe..', '..ewbwe..', '...e.e...'],
  ['.........', '.........', '...ebe...', '...wbw...', '...wbw...', '....b....', '.........'],
];
const DAY = { w: '#fff4b8', e: '#e39a3b', b: '#4a3a2e', trail: [255, 251, 232] };
const NIGHT = { w: '#9b9370', e: '#8a5d24', b: '#2c231c', trail: [255, 243, 176] };
const REST = 0.8; // seconds on each object
const TRAIL_LIFE = 2.5; // seconds a trail dot takes to fade
const TRAIL_STEP = 3; // art px between trail dots
const LAND = 6; // art px below the label point where it rests

interface Leg { x: number; y: number; rest: number; follow: boolean } // follow: the stop moves with the plane

export class Butterfly {
  active = false;
  private legs: Leg[] = [];
  private leg = 0;
  private x = 0;
  private y = 0;
  private from = { x: 0, y: 0 };
  private t = 0; // time in the current leg
  private arrived = false; // resting at the end of the current leg
  private done = false; // the stops are over (flying away)
  private age = 0;
  private trail: { x: number; y: number; age: number }[] = [];
  private onArrive: (i: number) => void = () => {};
  private onDone: () => void = () => {};
  private speed = 50;
  private W = 1;

  /**
   * Start the tour.
   * @param stops where to rest, art px (the scene, without the parallax shift)
   * @param W the scene's width in art px
   */
  start(stops: Stop[], W: number, onArrive: (i: number) => void, onDone: () => void) {
    if (!stops.length) return;
    Object.assign(this, { onArrive, onDone, W, active: true, leg: 0, t: 0, age: 0, arrived: false, done: false, trail: [] });
    this.speed = Math.max(40, W * 0.13);
    // It rests on the object, just below the label point, so it does not cover the label.
    this.legs = [...stops.map((s) => ({ x: s.x, y: s.y + LAND, rest: REST, follow: true })), this.exit()];
    this.x = -10;
    this.y = stops[0].y - 30;
    this.from = { x: this.x, y: this.y };
  }

  /** Stop the tour early: fly away from where it is now. */
  leave() {
    if (!this.active || this.done) return;
    Object.assign(this, { legs: [this.exit()], leg: 0, t: 0, arrived: false, done: true, from: { x: this.x, y: this.y } });
    this.onDone();
  }

  private exit(): Leg { return { x: this.W + 12, y: -12, rest: 0, follow: false }; }

  /** Advance and draw one frame. shift: the plane's current parallax shift, art px. */
  update(ctx: CanvasRenderingContext2D, dt: number, shift: { x: number; y: number }, night: boolean) {
    for (const d of this.trail) d.age += dt;
    this.trail = this.trail.filter((d) => d.age < TRAIL_LIFE);
    if (this.active) this.fly(dt, shift);
    const pal = night ? NIGHT : DAY;
    for (const d of this.trail) {
      ctx.fillStyle = `rgba(${pal.trail}, ${0.7 * (1 - d.age / TRAIL_LIFE)})`;
      ctx.fillRect(Math.round(d.x), Math.round(d.y), 1, 1);
    }
    if (this.active) this.draw(ctx, pal);
  }

  private fly(dt: number, shift: { x: number; y: number }) {
    const L = this.legs[this.leg];
    const tx = L.x + (L.follow ? shift.x : 0), ty = L.y + (L.follow ? shift.y : 0);
    const dx = tx - this.from.x, dy = ty - this.from.y;
    const dist = Math.hypot(dx, dy);
    const T = 0.35 + dist / this.speed; // flying time of this leg
    this.t += dt;
    this.age += dt;
    if (this.t < T) {
      // An arc over the way, eased in and out, with a little bob.
      const k = this.t / T, e = k * k * (3 - 2 * k), u = 1 - e;
      const lift = 8 + dist * 0.3;
      const c1 = { x: this.from.x + dx * 0.3, y: this.from.y + dy * 0.3 - lift };
      const c2 = { x: tx - dx * 0.3, y: ty - lift };
      this.x = u * u * u * this.from.x + 3 * u * u * e * c1.x + 3 * u * e * e * c2.x + e * e * e * tx;
      this.y = u * u * u * this.from.y + 3 * u * u * e * c1.y + 3 * u * e * e * c2.y + e * e * e * ty
        + Math.sin(this.age * 14) * 1.2 * Math.sin(Math.PI * k);
      const last = this.trail[this.trail.length - 1];
      if (!last || Math.hypot(this.x - last.x, this.y - last.y) >= TRAIL_STEP) this.trail.push({ x: this.x, y: this.y - 3, age: 0 });
      return;
    }
    this.x = tx;
    this.y = ty;
    if (!this.arrived) {
      this.arrived = true;
      if (L.rest) this.onArrive(this.leg);
    }
    if (this.t < T + L.rest) return;
    // On to the next leg; the last one (flying away) needs no stop.
    Object.assign(this, { leg: this.leg + 1, t: 0, arrived: false, from: { x: this.x, y: this.y } });
    if (this.leg >= this.legs.length) { this.active = false; return; }
    if (!this.done && !this.legs[this.leg].rest) { this.done = true; this.onDone(); }
  }

  private draw(ctx: CanvasRenderingContext2D, pal: typeof DAY) {
    // Fast wing beats in the air; resting, the wings stay open and close now and then.
    const beat = this.arrived ? (this.age % 1.4 < 0.25 ? 2 : 0) : [0, 1, 2, 1][Math.floor(this.age * 16) % 4];
    const rows = FRAMES[beat];
    const x0 = Math.round(this.x - 4), y0 = Math.round(this.y - rows.length + 1);
    for (let j = 0; j < rows.length; j++) {
      for (let i = 0; i < rows[j].length; i++) {
        const c = rows[j][i];
        if (c === '.') continue;
        ctx.fillStyle = pal[c as 'w' | 'e' | 'b'];
        ctx.fillRect(x0 + i, y0 + j, 1, 1);
      }
    }
  }
}
