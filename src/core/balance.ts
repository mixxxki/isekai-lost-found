// ===== 数値バランスはすべてここに集約 =====
import type { GameState, Staff, FacilityId, Role, Mechanic } from './types';
import { WORLD, RESEARCH_BY_ID, trait, ITEMS_BY_WORLD, WORLDS, RELOCATIONS, WORLD_INDEX } from './data';

export const MIN = 60_000;
export const HOUR = 3_600_000;
export const GATE_INTERVAL = 3 * HOUR;
export const OFFLINE_CAP = 24 * HOUR;
export const APPRAISE_BASE = 3 * MIN;
export const REPAIR_BASE = 20 * MIN;
export const FIRST_TRIP = 5 * MIN;          // 最初の1回だけの近道
export const DAMAGE_CHANCE = 0.3;
/** 後の世界ほど壊れやすい */
export const damageChance = (world: string) => Math.min(0.75, DAMAGE_CHANCE + 0.04 * (WORLD_INDEX[world] ?? 0));
export const RARITY_MULT = [1, 4, 15];
export const RARITY_NAME = ['', '珍品', '逸品'];
export const REQUEST_LIFE = 24 * HOUR;
export const REQUEST_MULT = 3;
export const RELOCATE_BASE = 1_000_000;
/** 移転に必要な信用（1回目は1M。以降は段階的に上がる） */
export const relocateAt = (n: number) => n <= 5 ? RELOCATE_BASE * Math.pow(10, n) : RELOCATE_BASE * 1e5 * Math.pow(3, n - 5);
/** 終点の先へ移転した回数（6回目以降） */
export const beyond = (s: GameState) => Math.max(0, s.relocations - 6);

export const FACILITY: Record<FacilityId, { name: string; base: number; growth: number; max: number; desc: string }> = {
  gate:      { name: '転送ゲート', base: 150, growth: 1.9, max: 30, desc: '一度に届く落とし物の数と、雇える配達員の数が増える。' },
  storage:   { name: '倉庫',       base: 60,  growth: 1.65, max: 30, desc: '珍品・逸品の届く確率と、貼り出せる「探しています」の数が増える。' },
  appraisal: { name: '鑑定室',     base: 100, growth: 2.1, max: 12, desc: '雇える鑑定士の数と、鑑定の速さが増す。' },
  workshop:  { name: '工房',       base: 100, growth: 2.1, max: 12, desc: '雇える修理工の数と、修理の速さが増す。' }
};
export const facilityCost = (id: FacilityId, lv: number) => Math.round(FACILITY[id].base * Math.pow(FACILITY[id].growth, lv - 1));
/** 施設の上限（終点の先へ移転するたびにゲートと倉庫が広がる） */
export const facilityMax = (s: GameState, id: FacilityId) => FACILITY[id].max + (id === 'gate' || id === 'storage' ? 2 * beyond(s) : 0);
/** 研究の上限（終点の先へ移転するたびに、段階式の研究が5段ずつ広がる） */
export const researchMax = (s: GameState, id: string) => RESEARCH_BY_ID[id].max + (RESEARCH_BY_ID[id].kind === 'level' ? 5 * beyond(s) : 0);

export const hasMechanic = (s: GameState, m: Mechanic) => RELOCATIONS.some(r => r.n <= s.relocations && r.mechanic === m);
export const rlv = (s: GameState, id: string) => s.research.levels[id] ?? 0;
export function rstat(s: GameState, stat: string): number {
  let v = 0;
  for (const [id, lv] of Object.entries(s.research.levels)) {
    const r = RESEARCH_BY_ID[id];
    if (r && r.kind === 'level' && r.stat === stat) v += (r.per ?? 0) * lv;
  }
  return v;
}

// ---- 世界 ----
export function openWorlds(s: GameState): string[] {
  const open = new Set(['w01', 'w02']);
  for (const r of RELOCATIONS) if (r.n <= s.relocations) open.add(r.world);
  for (const [id, lv] of Object.entries(s.research.levels)) {
    const r = RESEARCH_BY_ID[id];
    if (r?.kind === 'world' && lv > 0 && r.world) open.add(r.world);
  }
  return WORLDS.filter(w => open.has(w.id)).map(w => w.id);
}

// ---- ゲート・倉庫 ----
export function perDelivery(s: GameState): number {
  const lv = s.facilities.gate;
  const base = 4 + 2 * (lv - 1);
  const night = hasMechanic(s, 'nightshift') ? 1.25 : 1;
  return Math.round(base * (1 + rstat(s, 'arrival')) * night);
}
export const storageCap = (s: GameState) => perDelivery(s) * (OFFLINE_CAP / GATE_INTERVAL);
export const maxStaff = (s: GameState, role: Role) =>
  role === 'appraiser' ? s.facilities.appraisal : role === 'repairer' ? s.facilities.workshop : 1 + Math.floor(s.facilities.gate / 2);
export const requestSlots = (s: GameState) => 1 + Math.floor(s.facilities.storage / 2) + (hasMechanic(s, 'bulletin') ? 2 : 0);
export function rareChance(s: GameState): [number, number] {
  const eye = s.staff.filter(x => x.role === 'appraiser').reduce((a, x) => a + (trait('appraiser', x.trait).rare ?? 0), 0);
  const mult = 1 + rstat(s, 'rare') + eye + 0.1 * (s.facilities.storage - 1);
  return [0.06 * mult, 0.008 * mult];
}

// ---- 職員 ----
export const hireCost = (s: GameState, role: Role) => {
  const n = s.staff.filter(x => x.role === role).length;
  const base = { appraiser: 80, repairer: 120, courier: 100 }[role];
  return Math.round(base * Math.pow(5, n));
};
export const levelCost = (st: Staff, s: { relocations: number }) => {
  const base = { appraiser: 40, repairer: 50, courier: 60 }[st.role];
  const cheap = trait(st.role, st.trait).cheap ?? 0;
  // 移転するたびに上げ直しが高くなる（引き継いだLvほど価値がある）
  return Math.round(base * Math.pow(1.42, st.lv - 1) * (1 - cheap) * Math.pow(2.5, s.relocations));
};
/** 後の世界の品ほど鑑定に時間がかかる */
export const appraiseBase = (world: string) => APPRAISE_BASE * (1 + 0.6 * (WORLD_INDEX[world] ?? 0));
export function appraiseTime(s: GameState, st: Staff, world = 'w01'): number {
  const sp = 1 + 0.12 * (st.lv - 1) + (trait('appraiser', st.trait).appraise ?? 0) + rstat(s, 'appraise') + 0.05 * (s.facilities.appraisal - 1);
  return appraiseBase(world) / sp;
}
/** 後の世界の品ほど修理に時間がかかる */
export const repairBase = (world: string) => REPAIR_BASE * (1 + 0.5 * (WORLD_INDEX[world] ?? 0));
export function repairTime(s: GameState, st: Staff, world = 'w01'): number {
  const sp = 1 + 0.12 * (st.lv - 1) + (trait('repairer', st.trait).repair ?? 0) + rstat(s, 'repair') + 0.05 * (s.facilities.workshop - 1);
  return repairBase(world) / sp;
}
export function courierCap(s: GameState, st: Staff): number {
  const base = 3 + Math.floor(st.lv / 2) + (trait('courier', st.trait).cap ?? 0);
  return Math.floor(base * (hasMechanic(s, 'bigcart') ? 1.5 : 1));
}
export function tripTime(s: GameState, st: Staff, world: string, express = false): number {
  const t = trait('courier', st.trait).travel ?? 0;
  const m = Math.max(0.35, 1 - 0.015 * (st.lv - 1) - t - rstat(s, 'travel'));
  return WORLD[world].travelHours * HOUR * m * (express ? 0.5 : 1);
}
export const repairMaterials = (s: GameState, world: string) => {
  const thrift = s.staff.some(x => x.role === 'repairer' && (trait('repairer', x.trait).thrift ?? 0) > 0) ? 1 : 0;
  return Math.max(1, 2 + Math.floor((WORLD_INDEX[world] ?? 0) / 3) - thrift);
};

// ---- 図鑑 ----
export function catalogWorld(s: GameState, world: string) {
  const list = ITEMS_BY_WORLD[world] ?? [];
  const got = list.filter(i => s.catalog[i.id]).length;
  return { got, total: list.length, complete: got === list.length && list.length > 0 };
}
/** 世界ごとの礼金・信用倍率（5種ごと+5%、完成で+50%） */
export function catalogBonus(s: GameState, world: string): number {
  const c = catalogWorld(s, world);
  const archive = hasMechanic(s, 'archive') ? 2 : 1;
  return 1 + (Math.floor(c.got / 5) * 0.05 + (c.complete ? 0.5 : 0)) * archive;
}
export function catalogRatio(s: GameState): number {
  const total = Object.values(ITEMS_BY_WORLD).reduce((a, l) => a + l.length, 0);
  return Object.keys(s.catalog).length / total;
}
/** 職員の熟練（Lvの合計）による倍率 */
export const staffMult = (s: GameState) => 1 + 0.003 * s.staff.reduce((a, x) => a + x.lv - 1, 0);
/** 図鑑の収集率による倍率（全世界の礼金・信用に効く） */
export const archiveMult = (s: GameState) => 1 + 0.5 * catalogRatio(s);
/** 移転で得る永続倍率（移転の加算 × 職員の熟練 × 図鑑） */
export const branchMult = (s: GameState) => (1 + s.perm) * staffMult(s) * archiveMult(s);
/** 移転するときに加わる倍率。目標を超えて貯めた分だけ少し増える */
export function relocateGain(s: GameState): number {
  const need = relocateAt(s.relocations);
  const over = Math.max(1, s.branchCredit / need);
  const base = s.relocations < RELOCATIONS.length ? 0.5 : 0.25;
  return base + Math.min(1, 0.6 * Math.log10(over));
}

// ---- 報酬 ----
export function itemFee(s: GameState, it: { world: string; rarity: number; verdict: string | null; repaired: boolean; autoFeeBonus: number }): number {
  const w = WORLD[it.world];
  const guess = it.verdict === 'correct' ? (hasMechanic(s, 'hint') ? 3 : 2) : 1;
  const fussy = (it.repaired ? 0.05 * (s.facilities.workshop - 1) : 0) + (it.verdict === 'auto' ? 0.03 * (s.facilities.appraisal - 1) : 0) + (it.repaired ? s.staff.filter(x => x.role === 'repairer').reduce((a, x) => Math.max(a, trait('repairer', x.trait).repairFee ?? 0), 0) : 0);
  return w.value * 1.5 * RARITY_MULT[it.rarity] * guess * (1 + rstat(s, 'fee')) * (1 + fussy + it.autoFeeBonus) * catalogBonus(s, it.world) * branchMult(s);
}
export function itemCredit(s: GameState, it: { world: string; rarity: number; verdict?: string | null }): number {
  const w = WORLD[it.world];
  const guess = it.verdict === 'correct' ? (hasMechanic(s, 'hint') ? 1.5 : 1.2) : 1;
  return w.value * 1.7 * RARITY_MULT[it.rarity] * guess * (1 + rstat(s, 'credit')) * catalogBonus(s, it.world) * branchMult(s);
}

// ---- 研究 ----
export function researchCost(s: GameState, id: string): number {
  const r = RESEARCH_BY_ID[id];
  return Math.round(r.cost * Math.pow(r.growth, rlv(s, id)));
}
export function researchTime(s: GameState, id: string): number {
  const r = RESEARCH_BY_ID[id];
  return r.hours * HOUR * Math.pow(r.hoursGrowth ?? 1, rlv(s, id));
}
