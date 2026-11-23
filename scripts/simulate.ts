// バランス確認用：仮想プレイヤーで数週間を早回しする
//   npm run sim            … 既定（1日6回チェック）
//   npm run sim -- 4 30    … 1日4回、30日
import { createState, advance } from '../src/core/engine';
import * as A from '../src/core/actions';
import * as B from '../src/core/balance';
import type { GameState, Role, FacilityId } from '../src/core/types';
import { RESEARCH_BY_ID } from '../src/core/data';

const perDay = Number(process.argv[2] ?? 6);
const days = Number(process.argv[3] ?? 21);
const H = B.HOUR;
const t0 = Date.UTC(2026, 0, 1, 7);
const s: GameState = createState(t0, 12345);

function session(now: number) {
  advance(s, now);
  for (let loop = 0; loop < 4; loop++) {
    A.collectAll(s, now);
    for (const it of s.items.filter(i => i.stage === 'unknown')) {
      const right = Math.random() < 0.75;
      A.guess(s, it.id, right ? it.world : it.choices.find(c => c !== it.world)!, now);
    }
    A.repairAll(s, now);
    // 返却待ちの多い世界から派遣
    for (;;) {
      const counts: Record<string, number> = {};
      for (const it of s.items) if (it.stage === 'ready') counts[it.world] = (counts[it.world] ?? 0) + 1;
      const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
      if (!best || !A.idleCouriers(s).length) break;
      if (!A.send(s, best[0], now).ok) break;
    }
    spend(now);
  }
}
function spend(now: number) {
  // 研究：開通を最優先、次に安いもの
  if (!s.research.active) {
    const list = A.researchList(s).sort((a, b) => (a.kind === 'world' ? -1e12 : 0) + B.researchCost(s, a.id) - ((b.kind === 'world' ? -1e12 : 0) + B.researchCost(s, b.id)));
    for (const r of list) if (A.startResearch(s, r.id, now).ok) break;
  }
  // 礼金：いちばん安い強化を繰り返す（ただし配達員と倉庫関連を優先）
  for (let k = 0; k < 200; k++) {
    const opts: { cost: number; fn: () => any }[] = [];
    for (const f of Object.keys(B.FACILITY) as FacilityId[]) if (s.facilities[f] < B.FACILITY[f].max) opts.push({ cost: B.facilityCost(f, s.facilities[f]) * (f === 'gate' ? 0.6 : 1.2), fn: () => A.upgrade(s, f) });
    for (const r of ['appraiser', 'repairer', 'courier'] as Role[]) if (s.staff.filter(x => x.role === r).length < B.maxStaff(s, r)) opts.push({ cost: B.hireCost(s, r) * (r === 'courier' ? 0.5 : 1.5), fn: () => A.hire(s, r, 0, now) });
    for (const st of s.staff) opts.push({ cost: B.levelCost(st, s) * (st.role === 'courier' ? 0.7 : 1.3), fn: () => A.levelUp(s, st.id) });
    opts.sort((a, b) => a.cost - b.cost);
    if (!opts.length || !opts[0].fn().ok) break;
  }
}

const marks: string[] = [];
let relocDay = -1;
const fmt = (n: number) => n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : n.toFixed(0);
// 初日の30分：5分おきに操作
for (let m = 0; m <= 30; m += 5) session(t0 + m * 60000);
console.log(`30分後: 返却${s.totals.returned} 鑑定${s.totals.appraised} 手紙${s.letters.length} 研究${JSON.stringify(s.research.levels)} 研究中${s.research.active?.id ?? '-'} 職員${s.staff.length} 礼金${fmt(s.fee)} 信用${fmt(s.credit)}`);
for (let d = 0; d < days; d++) {
  for (let k = 0; k < perDay; k++) {
    const now = t0 + d * 24 * H + (k * 16 / Math.max(1, perDay - 1)) * H + 0.6 * H;
    session(now);
    if (A.canRelocate(s)) {
      relocDay = d + (k + 1) / perDay;
      marks.push(`移転${s.relocations + 1}: ${relocDay.toFixed(2)}日目（手紙${s.letters.length} 図鑑${(B.catalogRatio(s) * 100).toFixed(0)}%）`);
      A.relocate(s, now);
      if (process.argv[4] === 'quiet') continue;
    }
  }
  const ws = B.openWorlds(s).length;
  if (process.argv[4] !== 'quiet') console.log(`day${String(d + 1).padStart(2)} 信用累計${fmt(s.branchCredit).padStart(8)} 礼金${fmt(s.fee).padStart(8)} 世界${ws} ゲートLv${s.facilities.gate} 配達員${s.staff.filter(x => x.role === 'courier').map(x => x.lv).join('/')} 返却${s.totals.returned} 手紙${s.letters.length} 図鑑${Object.keys(s.catalog).length} 倉庫${s.items.length} 研究${Object.entries(s.research.levels).map(([k, v]) => RESEARCH_BY_ID[k].kind === 'level' ? k + v : '').filter(Boolean).join(',')}`);
}
console.log(marks.join('\n') || '移転未達');
