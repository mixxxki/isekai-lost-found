// ===== 時間経過の処理（純粋なロジック。DOMに触れない） =====
import type { GameState, ItemInst, Staff, Report, Rarity, Role, Candidate } from './types';
import { WORLD, WORLDS, ITEMS_BY_WORLD, OWNERS_BY_WORLD, ITEM, LETTER_THRESHOLDS, RESEARCH_BY_ID, STAFF_NAMES, TRAITS, MYSTERY, trait, ITEM_OWNER, OWNER } from './data';
import { rand, pick, shuffle } from './rng';
import * as B from './balance';

export const SAVE_VERSION = 1;

export function newReport(t: number): Report {
  return { from: t, to: t, arrivals: 0, appraised: 0, repaired: 0, trips: 0, returned: 0, fee: 0, credit: 0, letters: 0, research: [], requests: 0, letterList: [], capped: false, deferred: 0 };
}
export function newSession(t: number) {
  return { startedAt: t, fee: 0, credit: 0, appraised: 0, correct: 0, repaired: 0, returned: 0, letters: 0, dispatched: 0, acted: false, closedShown: false };
}

export function makeCandidate(s: GameState, role: Role): Candidate {
  const used = new Set(s.staff.map(x => x.name));
  const names = STAFF_NAMES.filter(n => !used.has(n));
  return { name: pick(s, names.length ? names : STAFF_NAMES), trait: pick(s, TRAITS[role]).id };
}
export function addStaff(s: GameState, role: Role, c: Candidate, t: number): Staff {
  const st: Staff = { id: s.nextId++, role, name: c.name, lv: 1, trait: c.trait, task: null, hiredAt: t };
  s.staff.push(st);
  return st;
}

export function createState(now: number, seed = (Math.random() * 2 ** 31) | 0): GameState {
  const s: GameState = {
    version: SAVE_VERSION, createdAt: now, lastTick: now, savedAt: now,
    rng: seed, nextId: 1,
    fee: 150, credit: 0, branchCredit: 0,
    materials: { w01: 6, w02: 6 },
    facilities: { storage: 1, appraisal: 1, workshop: 1, gate: 1 },
    staff: [], candidates: { appraiser: [], repairer: [], courier: [] },
    items: [],
    gate: { next: now + B.GATE_INTERVAL, deliveries: 0 },
    research: { active: null, next: null, levels: {} },
    catalog: {}, ownerReturns: {}, letters: [], requests: [],
    mysterySeen: 0, relocations: 0, perm: 0, firstTrip: true,
    totals: { returned: 0, appraised: 0, correct: 0, fee: 0, credit: 0, trips: 0 },
    session: newSession(now), report: null,
    settings: { reduceMotion: false, autoAssign: true },
    log: []
  };
  addStaff(s, 'appraiser', { name: '相良', trait: 'plain' }, now);
  addStaff(s, 'repairer', { name: '井筒', trait: 'thrift' }, now);
  addStaff(s, 'courier', { name: 'ユラ', trait: 'legs' }, now);
  refreshCandidates(s);
  // 前任者が残していった品（最初の便）。チュートリアル用に壊れ物を1つ必ず含める
  spawnItems(s, 10, now, true);
  log(s, now, '着任。前任者の残した落とし物が10件、ゲート前に積まれている。');
  return s;
}

export function refreshCandidates(s: GameState, role?: Role) {
  for (const r of (role ? [role] : (['appraiser', 'repairer', 'courier'] as Role[]))) {
    s.candidates[r] = [makeCandidate(s, r), makeCandidate(s, r)];
  }
}

export function log(s: GameState, at: number, text: string) {
  s.log.unshift({ at, text });
  if (s.log.length > 40) s.log.length = 40;
}

// ---- 品物の生成 ----
function rollRarity(s: GameState): Rarity {
  const [r1, r2] = B.rareChance(s);
  const x = rand(s);
  return x < r2 ? 2 : x < r2 + r1 ? 1 : 0;
}
const hasPending = (s: GameState, owner: string) => (s.ownerReturns[owner] ?? 0) < LETTER_THRESHOLDS[2];
/**
 * 品物の種類から持ち主を決める。
 * - owners.json の items で決まっている品は、その持ち主のもの
 * - まだ一度も品を返していない持ち主には、最初の手紙で触れている品（items[0]）から届く
 * - 誰の品とも決まっていない品は、すでに知り合った持ち主（または仮の持ち主）のものにする。いなければ「その世界の誰か」
 * 戻り値の type は、上の規則で差し替わることがある
 */
export function assignOwner(s: GameState, world: string, type: string): { type: string; owner: string } {
  const fixed = ITEM_OWNER[type];
  if (fixed) {
    const o = OWNER[fixed];
    if ((s.ownerReturns[fixed] ?? 0) === 0 && o.items && o.items[0] !== type) return { type: o.items[0], owner: fixed };
    return { type, owner: fixed };
  }
  const list = OWNERS_BY_WORLD[world].filter(o => !o.items?.length || (s.ownerReturns[o.id] ?? 0) > 0);
  if (!list.length) return { type, owner: '' };
  const pending = list.filter(o => hasPending(s, o.id));
  return { type, owner: pick(s, pending.length && rand(s) < 0.8 ? pending : list).id };
}
/** 物語が進むよう、手紙の残っている持ち主の品を少し出やすくする */
function pickType(s: GameState, world: string): string {
  if (rand(s) < 0.45) {
    const cands = OWNERS_BY_WORLD[world].filter(o => o.items?.length && hasPending(s, o.id));
    if (cands.length) { const o = pick(s, cands); return pick(s, o.items!); }
  }
  return pick(s, ITEMS_BY_WORLD[world]).id;
}
function makeChoices(s: GameState, world: string): { choices: string[]; strike: string | null } {
  // 外れは開通済みの世界から。足りなければ「次に開通する世界」を混ぜる（地図の？と食い違わないよう、遠い世界は出さない）
  const openAll = B.openWorlds(s);
  const pool = shuffle(s, openAll.filter(w => w !== world));
  const upcoming = WORLDS.map(w => w.id).filter(w => !openAll.includes(w) && w !== world);
  const decoys: string[] = pool.slice(0, 2);
  for (const w of upcoming) { if (decoys.length >= 2) break; decoys.push(w); }
  const choices = shuffle(s, [world, ...decoys]);
  const hint = B.hasMechanic(s, 'hint') || s.staff.some(x => x.role === 'appraiser' && trait('appraiser', x.trait).hint);
  return { choices, strike: hint ? decoys[decoys.length - 1] : null };
}

export function spawnItems(s: GameState, n: number, t: number, tutorial = false) {
  const open = B.openWorlds(s);
  // 新しく開通した世界ほど少し多めに届く
  const weights = open.map((_, i) => 1 + i * 0.35);
  const wsum = weights.reduce((a, b) => a + b, 0);
  const activeReq = s.requests.filter(r => !r.done && r.expiresAt > t);
  for (let k = 0; k < n; k++) {
    let world = open[0];
    let x = rand(s) * wsum;
    for (let i = 0; i < open.length; i++) { x -= weights[i]; if (x <= 0) { world = open[i]; break; } }
    let type = pickType(s, world);
    let owner: string | null = null;
    // 依頼品が混じることがある
    if (activeReq.length && rand(s) < 0.12) {
      const rq = pick(s, activeReq);
      world = rq.world; type = rq.type; owner = rq.owner;
    }
    if (owner === null) { const a = assignOwner(s, world, type); type = a.type; owner = a.owner; }
    const { choices, strike } = makeChoices(s, world);
    const it: ItemInst = {
      id: s.nextId++, type, world, owner: owner ?? "",
      rarity: rollRarity(s), damaged: tutorial ? k === 2 : rand(s) < B.damageChance(world),
      stage: 'gate', verdict: null, choices, strike, repaired: false, autoFeeBonus: 0, arrivedAt: t
    };
    s.items.push(it);
  }
}

// ---- 倉庫 ----
export const inStorage = (it: ItemInst) => it.stage !== 'gate' && it.stage !== 'shipping';
export const storageUsed = (s: GameState) => s.items.filter(inStorage).length;

export function collect(s: GameState, t: number): number {
  const room = B.storageCap(s) - storageUsed(s);
  const gateItems = s.items.filter(i => i.stage === 'gate');
  const n = Math.max(0, Math.min(room, gateItems.length));
  const auto = B.rlv(s, 'auto_assign') > 0 && s.settings.autoAssign;
  const req = new Set(s.requests.filter(q => !q.done).map(q => q.type));
  // 珍品・逸品と依頼品は、自分で鑑定できるよう手元に残す
  for (let i = 0; i < n; i++) {
    const it = gateItems[i];
    it.stage = auto && it.rarity === 0 && !req.has(it.type) ? 'qAppraise' : 'unknown';
  }
  if (n) assignWork(s, t);
  return n;
}

// ---- 作業の割り当て ----
export function assignWork(s: GameState, t: number) {
  if (B.rlv(s, 'auto_repair') > 0) {
    for (const it of s.items) if (it.stage === 'damaged') tryQueueRepair(s, it);
  }
  for (const st of s.staff) {
    if (st.task) continue;
    if (st.role === 'appraiser') {
      const it = s.items.find(i => i.stage === 'qAppraise');
      if (it) { it.stage = 'appraising'; st.task = { kind: 'appraise', item: it.id, start: t, end: t + B.appraiseTime(s, st, it.world) }; }
    } else if (st.role === 'repairer') {
      const it = s.items.find(i => i.stage === 'qRepair');
      if (it) { it.stage = 'repairing'; st.task = { kind: 'repair', item: it.id, start: t, end: t + B.repairTime(s, st, it.world) }; }
    } else if (st.role === 'courier' && B.rlv(s, 'auto_dispatch') > 0) {
      const counts: Record<string, number> = {};
      for (const it of s.items) if (it.stage === 'ready') counts[it.world] = (counts[it.world] ?? 0) + 1;
      const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
      if (best && best[1] >= Math.min(B.courierCap(s, st), 3)) dispatch(s, st, best[0], t, false);
    }
  }
}

export function tryQueueRepair(s: GameState, it: ItemInst): boolean {
  const need = B.repairMaterials(s, it.world);
  if ((s.materials[it.world] ?? 0) < need) return false;
  s.materials[it.world] -= need;
  it.stage = 'qRepair';
  return true;
}

/** 速達の前払い（見込み礼金の3割） */
export const expressCost = (s: GameState, items: ItemInst[]) => Math.round(items.reduce((a, it) => a + B.itemFee(s, it), 0) * 0.3);

export function dispatch(s: GameState, st: Staff, world: string, t: number, express: boolean): number {
  const ready = s.items.filter(i => i.stage === 'ready' && i.world === world);
  // 依頼品・高価な品から先に持っていく
  const req = new Set(s.requests.filter(r => !r.done).map(r => r.type));
  ready.sort((a, b) => (req.has(b.type) ? 1 : 0) - (req.has(a.type) ? 1 : 0) || b.rarity - a.rarity || a.id - b.id);
  const take = ready.slice(0, B.courierCap(s, st));
  if (!take.length) return 0;
  if (express) {
    const cost = expressCost(s, take);
    if (s.fee < cost) return 0;
    s.fee -= cost;
  }
  for (const it of take) it.stage = 'shipping';
  const dur = s.totals.trips < 3 && s.relocations === 0 ? B.FIRST_TRIP : B.tripTime(s, st, world, express);
  st.task = { kind: 'trip', world, items: take.map(i => i.id), start: t, end: t + dur, express };
  s.totals.trips++;
  return take.length;
}

// ---- 鑑定結果の確定 ----
export function finishAppraisal(s: GameState, it: ItemInst, verdict: 'correct' | 'wrong' | 'auto', autoFeeBonus = 0) {
  it.verdict = verdict;
  it.autoFeeBonus = autoFeeBonus;
  it.stage = it.damaged ? 'damaged' : 'ready';
  const c = (s.catalog[it.type] ??= { n: 0, best: 0 });
  c.n++;
  if (it.rarity > c.best) c.best = it.rarity;
  s.totals.appraised++;
  if (verdict === 'correct') s.totals.correct++;
}

// ---- 1件のタスク完了 ----
function completeTask(s: GameState, st: Staff, r: Report | null) {
  const task = st.task!;
  st.task = null;
  const t = task.end;
  if (task.kind === 'appraise') {
    const it = s.items.find(i => i.id === task.item);
    if (it) {
      finishAppraisal(s, it, 'auto', trait('appraiser', st.trait).autoFee ?? 0);
      s.session.appraised++;
      if (r) r.appraised++;
    }
  } else if (task.kind === 'repair') {
    const it = s.items.find(i => i.id === task.item);
    if (it) { it.stage = 'ready'; it.repaired = true; s.session.repaired++; if (r) r.repaired++; }
  } else {
    returnTrip(s, st, task.world, task.items, task.express, t, r);
  }
}

function returnTrip(s: GameState, st: Staff, world: string, ids: number[], express: boolean, t: number, r: Report | null) {
  const tr = trait('courier', st.trait);
  let fee = 0, credit = 0, mat = 0, letters = 0, reqs = 0;
  const reqMult = B.REQUEST_MULT * (B.hasMechanic(s, 'bulletin') ? 1.5 : 1);
  void express;
  for (const id of ids) {
    const it = s.items.find(i => i.id === id);
    if (!it) continue;
    const ce = s.catalog[it.type];
    if (ce) {
      ce.r = (ce.r ?? 0) + 1;
      if (it.owner && !(ce.o ??= []).includes(it.owner) && ce.o.length < 4) ce.o.push(it.owner);
    }
    let f = B.itemFee(s, it);
    let c = B.itemCredit(s, it) * (1 + (tr.credit ?? 0));
    const rq = s.requests.find(q => !q.done && q.type === it.type && q.expiresAt > t);
    if (rq) { rq.done = true; f *= reqMult; c *= reqMult; reqs++; }
    fee += f; credit += c;
    mat += (1 + B.rstat(s, 'material')) * (1 + (tr.material ?? 0));
    // 持ち主と手紙
    if (!it.owner) continue;
    const before = s.ownerReturns[it.owner] ?? 0;
    const after = before + 1;
    s.ownerReturns[it.owner] = after;
    LETTER_THRESHOLDS.forEach((th, idx) => {
      if (before < th && after >= th) {
        s.letters.push({ owner: it.owner, world: it.world, idx, at: t, read: false, type: it.type, item: it.id });
        r?.letterList.push({ owner: it.owner, idx });
        letters++;
      }
    });
  }
  s.items = s.items.filter(i => !ids.includes(i.id));
  fee = Math.round(fee); credit = Math.round(credit);
  s.fee += fee; s.credit += credit; s.branchCredit += credit;
  s.materials[world] = (s.materials[world] ?? 0) + mat;
  s.totals.returned += ids.length; s.totals.fee += fee; s.totals.credit += credit;
  const ss = s.session;
  ss.fee += fee; ss.credit += credit; ss.returned += ids.length; ss.letters += letters;
  if (r) { r.trips++; r.returned += ids.length; r.fee += fee; r.credit += credit; r.letters += letters; r.requests += reqs; }
  log(s, t, `${st.name}が${WORLD[world].short}から帰還。${ids.length}件を返却した。`);
}

function gateArrival(s: GameState, t: number, r: Report | null) {
  // ゲート前に置けるのは倉庫と同じ数まで。それを超える便は見送られる（品物は届かないだけで、消えはしない）
  const waiting = s.items.filter(i => i.stage === 'gate').length;
  const n = Math.min(B.perDelivery(s), Math.max(0, B.storageCap(s) - waiting));
  if (n > 0) spawnItems(s, n, t);
  else if (r) r.deferred++;
  s.gate.deliveries++;
  if (r) r.arrivals += n;
  // 貼り紙の更新
  s.requests = s.requests.filter(q => !q.done && q.expiresAt > t);
  const slots = B.requestSlots(s) - s.requests.length;
  if (slots > 0 && s.totals.returned > 0) {
    for (let k = 0; k < slots; k++) postRequest(s, t);
  }
  if (B.rlv(s, 'auto_collect') > 0) collect(s, t);
}

export function postRequest(s: GameState, t: number) {
  const world = pick(s, B.openWorlds(s));
  const a = assignOwner(s, world, pick(s, ITEMS_BY_WORLD[world]).id);
  if (s.requests.some(q => q.type === a.type)) return;
  s.requests.push({ id: s.nextId++, type: a.type, world, owner: a.owner, postedAt: t, expiresAt: t + B.REQUEST_LIFE, done: false });
}

function finishResearch(s: GameState, r: Report | null) {
  const a = s.research.active!;
  s.research.active = null;
  const next = s.research.next;
  s.research.next = null;
  s.research.levels[a.id] = (s.research.levels[a.id] ?? 0) + 1;
  const def = RESEARCH_BY_ID[a.id];
  if (r) r.research.push(def.name);
  if (def.kind === 'world' && def.world) {
    s.materials[def.world] = (s.materials[def.world] ?? 0) + 6;
    log(s, a.end, `${WORLD[def.world].name}への線が開通した。`);
  }
  // 予約していた研究（費用は予約時に支払い済み）
  if (next) s.research.active = { id: next, start: a.end, end: a.end + B.researchTime(s, next) };
}

// ---- 時間を進める ----
function nextEvent(s: GameState): number {
  let t = s.gate.next;
  for (const st of s.staff) if (st.task && st.task.end < t) t = st.task.end;
  if (s.research.active && s.research.active.end < t) t = s.research.active.end;
  return t;
}

/** 経過分を処理する。最終処理から24時間を超えた分は切り捨てる（タイマーをずらす）。 */
export function advance(s: GameState, now: number, r: Report | null = null): void {
  const gap = now - s.lastTick;
  if (gap > B.OFFLINE_CAP) { shiftTime(s, gap - B.OFFLINE_CAP); if (r) r.capped = true; }
  let guard = 0;
  while (guard++ < 100000) {
    const t = nextEvent(s);
    if (t > now) break;
    if (t === s.gate.next) {
      s.gate.next += B.GATE_INTERVAL;
      gateArrival(s, t, r);
    } else if (s.research.active && s.research.active.end === t) {
      finishResearch(s, r);
    } else {
      const st = s.staff.find(x => x.task && x.task.end === t)!;
      completeTask(s, st, r);
    }
    if (B.rlv(s, 'auto_collect') > 0) collect(s, t);
    assignWork(s, t);
  }
  s.lastTick = now;
  if (r) r.to = now;
}

function shiftTime(s: GameState, d: number) {
  s.lastTick += d;
  s.gate.next += d;
  for (const st of s.staff) if (st.task) { st.task.start += d; st.task.end += d; }
  if (s.research.active) { s.research.active.start += d; s.research.active.end += d; }
  for (const q of s.requests) q.expiresAt += d;
}

// ---- 謎 ----
export function mysteryUnlocked(s: GameState): number {
  const letters = s.letters.length;
  let n = 0;
  for (const m of MYSTERY) {
    const q = m.req;
    if ((q.letters ?? 0) > letters) break;
    if ((q.relocations ?? 0) > s.relocations) break;
    if ((q.worlds ?? 0) > B.openWorlds(s).length) break;
    if ((q.catalog ?? 0) > B.catalogRatio(s)) break;
    n = m.id;
  }
  return n;
}

export const itemDef = (it: ItemInst) => ITEM[it.type];
