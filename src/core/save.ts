// ===== 保存・読み込み・エクスポート =====
import type { GameState } from './types';
import { createState, advance, newReport, newSession, SAVE_VERSION } from './engine';

const KEY = 'ilf-save-v1';

function migrate(raw: any, now: number): GameState {
  const base = createState(now);
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.items) || !Array.isArray(raw.staff)) throw new Error('セーブデータの形式が正しくありません');
  const s = { ...base, ...raw } as GameState;
  s.facilities = { ...base.facilities, ...raw.facilities };
  s.research = { active: raw.research?.active ?? null, queue: raw.research?.queue ?? (raw.research?.next ? [raw.research.next] : []), levels: { ...(raw.research?.levels ?? {}) } };
  if (typeof raw.perm !== 'number') s.perm = 0.5 * (raw.relocations ?? 0);
  s.totals = { ...base.totals, ...raw.totals };
  s.settings = { ...base.settings, ...raw.settings };
  s.session = { ...base.session, ...raw.session };
  s.gate = { ...base.gate, ...raw.gate };
  s.version = SAVE_VERSION;
  return s;
}

export function load(now: number): { state: GameState; fresh: boolean } {
  try {
    const txt = localStorage.getItem(KEY);
    if (txt) {
      const s = migrate(JSON.parse(txt), now);
      return { state: s, fresh: false };
    }
  } catch (e) {
    console.warn('load failed', e);
  }
  return { state: createState(now), fresh: true };
}

export function save(s: GameState, now = Date.now()) {
  s.savedAt = now;
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { console.warn('save failed', e); }
}

/** 留守中の差分を計算して、開館時のまとめを作る */
export function catchUp(s: GameState, now: number) {
  const r = newReport(s.lastTick);
  advance(s, now, r);
  return r;
}

export function startSession(s: GameState, now: number) {
  s.session = newSession(now);
}

function b64enc(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
const b64dec = (b: string) => new TextDecoder().decode(Uint8Array.from(atob(b), c => c.charCodeAt(0)));

export function exportSave(s: GameState): string {
  return 'ILF1:' + b64enc(JSON.stringify(s));
}
export function importSave(text: string, now: number): GameState {
  const t = text.trim();
  const json = t.startsWith('ILF1:') ? b64dec(t.slice(5)) : t;
  return migrate(JSON.parse(json), now);
}
export function wipe() { localStorage.removeItem(KEY); }
