// One wind model for the whole scene. The grass shader and the JavaScript
// (hair, book page, flying papers) use the same gust formula, so everything
// moves with the same visible waves of wind.

/** Gust strength 0..1 at a point (CSS px) and time (s). Keep in sync with GUST_GLSL. */
export function gust(x: number, y: number, t: number): number {
  const a = Math.sin(x * 0.006 - t * 1.1 + y * 0.004);
  const b = Math.sin(x * 0.0037 - t * 0.7 + 1.7 + y * 0.002);
  const v = a * 0.6 + b * 0.5;
  const s = Math.min(1, Math.max(0, (v - 0.35) / 0.65));
  return s * s * (3 - 2 * s); // smoothstep
}

export const GUST_GLSL = /* glsl */ `
float gust(vec2 p, float t) {
  float a = sin(p.x * 0.006 - t * 1.1 + p.y * 0.004);
  float b = sin(p.x * 0.0037 - t * 0.7 + 1.7 + p.y * 0.002);
  return smoothstep(0.35, 1.0, a * 0.6 + b * 0.5);
}`;

/** Small seeded random number generator, so the scene looks the same on every visit. */
export function rng(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}
