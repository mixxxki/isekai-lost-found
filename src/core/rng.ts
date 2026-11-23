import type { GameState } from './types';
// mulberry32。状態は GameState.rng に保持するので、セーブ/ロードしても続きから再現できる。
export function rand(s: GameState): number {
  let t = (s.rng = (s.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export const pick = <T>(s: GameState, a: T[]): T => a[Math.floor(rand(s) * a.length)];
export function shuffle<T>(s: GameState, a: T[]): T[] {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(rand(s) * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; }
  return r;
}
