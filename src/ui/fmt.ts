import { MIN } from '../core/balance';

/** 数字は日本の単位で（9,999 / 98.5万 / 1.23億 / 4.56兆 / 7.89京） */
export function num(n: number): string {
  if (!isFinite(n)) return '―';
  const a = Math.abs(n);
  if (a < 10_000) return Math.floor(n).toLocaleString('en-US');
  if (a >= 9.9995e19) { const e = Math.floor(Math.log10(a)); return `${(n / Math.pow(10, e)).toFixed(2)}e${e}`; }
  const units = [['京', 1e16], ['兆', 1e12], ['億', 1e8], ['万', 1e4]] as const;
  for (const [u, v] of units) {
    const x = a / v;
    // 丸めて10000になるなら一つ上の単位（10000万 ではなく 1.00億）
    if (x >= 0.99995) {
      const sign = n < 0 ? '-' : '';
      if (x >= 999.5) return sign + Math.round(x).toLocaleString('en-US') + u;
      const d = x >= 99.95 ? 0 : x >= 9.995 ? 1 : 2;
      return sign + Math.max(1, x).toFixed(d) + u;
    }
  }
  return String(Math.floor(n));
}
/** 残り時間（例：2時間05分 / 4分12秒） */
export function dur(ms: number): string {
  if (ms <= 0) return 'まもなく';
  const s = Math.ceil(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h >= 24) return `${Math.floor(h / 24)}日${h % 24}時間`;
  if (h > 0) return `${h}時間${String(m).padStart(2, '0')}分`;
  if (m > 0) return `${m}分${String(sec).padStart(2, '0')}秒`;
  return `${sec}秒`;
}
/** 短い所要時間（例：2.5時間 / 12分） */
export function span(ms: number): string {
  const mins = Math.round(ms / MIN);
  if (mins < 60) return `${Math.max(1, mins)}分`;
  const h = Math.floor(mins / 60), m = mins % 60;
  const hr = Math.round(mins / 60);
  if (hr >= 48) return `${Math.round(hr / 24)}日`;
  if (hr >= 24) return hr === 24 ? '1日' : `1日${hr - 24}時間`;
  return m ? `${h}時間${m}分` : `${h}時間`;
}
export function clock(t: number, now = Date.now()): string {
  const d = new Date(t);
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const diff = Math.floor((new Date(t).setHours(0, 0, 0, 0) - today.getTime()) / 86400000);
  return diff === 0 ? hm : diff === 1 ? `明日 ${hm}` : diff === -1 ? `昨日 ${hm}` : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}
export const pad = (n: number, w = 4) => String(n).padStart(w, '0');
