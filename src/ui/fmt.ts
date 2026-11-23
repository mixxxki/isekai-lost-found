import { HOUR, MIN } from '../core/balance';

export function num(n: number): string {
  const a = Math.abs(n);
  if (a < 10_000) return Math.floor(n).toLocaleString('en-US');
  if (a >= 1e15) { const e = Math.floor(Math.log10(a)); return `${(n / Math.pow(10, e)).toFixed(2)}e${e}`; }
  const units = [['T', 1e12], ['B', 1e9], ['M', 1e6], ['K', 1e3]] as const;
  for (let i = units.length - 1; i >= 0; i--) {
    const [u, v] = units[i];
    const x = a / v;
    if (x >= 999.5 && i > 0) continue; // 1000K ではなく 1.00M と書く
    if (x >= 1) return (n / v).toFixed(x >= 100 ? 0 : x >= 10 ? 1 : 2) + u;
  }
  return String(Math.floor(n));
}
/** 残り時間（例：2時間05分 / 4分12秒） */
export function dur(ms: number): string {
  if (ms <= 0) return 'まもなく';
  const s = Math.ceil(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h > 0) return `${h}時間${String(m).padStart(2, '0')}分`;
  if (m > 0) return `${m}分${String(sec).padStart(2, '0')}秒`;
  return `${sec}秒`;
}
/** 短い所要時間（例：2.5時間 / 12分） */
export function span(ms: number): string {
  if (ms >= 48 * HOUR) return `${Math.round(ms / (24 * HOUR))}日`;
  if (ms >= 24 * HOUR) { const h = Math.round(ms / HOUR); return h % 24 ? `1日${h - 24}時間` : '1日'; }
  if (ms >= HOUR) { const h = ms / HOUR; return `${h >= 10 ? Math.round(h) : Math.round(h * 10) / 10}時間`; }
  return `${Math.max(1, Math.round(ms / MIN))}分`;
}
export function clock(t: number, now = Date.now()): string {
  const d = new Date(t);
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const diff = Math.floor((new Date(t).setHours(0, 0, 0, 0) - today.getTime()) / 86400000);
  return diff === 0 ? hm : diff === 1 ? `明日 ${hm}` : diff === -1 ? `昨日 ${hm}` : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}
export const pad = (n: number, w = 4) => String(n).padStart(w, '0');
