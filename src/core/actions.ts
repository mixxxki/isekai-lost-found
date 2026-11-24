// ===== プレイヤーの操作 =====
import type { GameState, Role, FacilityId, ItemInst } from './types';
import { RESEARCH_BY_ID, RESEARCH, RELOCATIONS, WORLD, ROLES, trait, ITEMS_BY_WORLD } from './data';
import * as B from './balance';
import { collect, assignWork, advance, tryQueueRepair, dispatch, finishAppraisal, addStaff, refreshCandidates, createState, log, assignOwner, storageUsed, mysteryUnlocked } from './engine';

export type Result = { ok: true; msg?: string } | { ok: false; msg: string };
const ok = (msg?: string): Result => ({ ok: true, msg });
const ng = (msg: string): Result => ({ ok: false, msg });
const acted = (s: GameState) => { s.session.acted = true; };

export function collectAll(s: GameState, now: number): Result {
  const n = collect(s, now);
  if (!n) return ng(storageUsed(s) >= B.storageCap(s) ? '倉庫がいっぱいです' : '回収できる品物がありません');
  acted(s);
  s.session.collected = (s.session.collected ?? 0) + n;
  return ok(`${n}件を倉庫へ回収しました`);
}

export function guess(s: GameState, id: number, world: string, now: number): Result {
  const it = s.items.find(i => i.id === id);
  if (!it || it.stage !== 'unknown') return ng('この品物は鑑定できません');
  const correct = world === it.world;
  finishAppraisal(s, it, correct ? 'correct' : 'wrong');
  s.session.appraised++;
  if (correct) s.session.correct++;
  acted(s);
  assignWork(s, now);
  return correct ? ok('正解。礼金が上乗せされます') : { ok: true, msg: `外れ。${WORLD[it.world].short}の品でした` };
}

export function delegate(s: GameState, ids: number[], now: number): Result {
  let n = 0;
  for (const id of ids) {
    const it = s.items.find(i => i.id === id);
    if (it && it.stage === 'unknown') { it.stage = 'qAppraise'; n++; }
  }
  if (!n) return ng('任せられる品物がありません');
  acted(s);
  assignWork(s, now);
  return ok(`${n}件を鑑定士に任せました`);
}
export const delegateAll = (s: GameState, now: number) =>
  delegate(s, s.items.filter(i => i.stage === 'unknown').map(i => i.id), now);

export function repair(s: GameState, ids: number[], now: number): Result {
  let n = 0, short = false;
  for (const id of ids) {
    const it = s.items.find(i => i.id === id);
    if (!it || it.stage !== 'damaged') continue;
    if (tryQueueRepair(s, it)) n++; else short = true;
  }
  if (!n) return ng(short ? '素材が足りません' : '修理できる品物がありません');
  acted(s);
  assignWork(s, now);
  return ok(`${n}件を工房へ回しました${short ? '（素材不足で一部保留）' : ''}`);
}
export const repairAll = (s: GameState, now: number) =>
  repair(s, s.items.filter(i => i.stage === 'damaged').map(i => i.id), now);

export const idleCouriers = (s: GameState) =>
  s.staff.filter(x => x.role === 'courier' && !x.task).sort((a, b) => B.courierCap(s, b) - B.courierCap(s, a));

export function send(s: GameState, world: string, now: number, express = false, staffId?: number): Result {
  const st = staffId ? s.staff.find(x => x.id === staffId && !x.task) : idleCouriers(s)[0];
  if (!st) return ng('手の空いた配達員がいません');
  const ex = express && B.hasMechanic(s, 'express');
  const n = dispatch(s, st, world, now, ex);
  if (!n) return ng(ex && s.items.some(i => i.stage === 'ready' && i.world === world) ? '速達の前払いに必要な礼金が足りません' : '返却できる品物がありません');
  s.session.dispatched++;
  const lastTrainee = s.relocations === 0 && s.totals.trips === 3;
  s.session.shipped = (s.session.shipped ?? 0) + n;
  if (st.task?.kind === 'trip') s.session.shippedFee = (s.session.shippedFee ?? 0) + st.task.items.reduce((a, id) => { const it = s.items.find(i => i.id === id); return a + (it ? B.itemFee(s, it) : 0); }, 0);
  acted(s);
  return ok(`${st.name}が${WORLD[world].short}へ出発しました（${n}件）${lastTrainee ? '。研修便はこれで最後。次からは往復に1〜2時間ほどかかります' : ''}`);
}

/** 一括出発で実際に出発する人数（sendAll と同じ割り当てを試算） */
export function sendAllCount(s: GameState): number {
  const counts: Record<string, number> = {};
  for (const it of s.items) if (it.stage === 'ready') counts[it.world] = (counts[it.world] ?? 0) + 1;
  let n = 0;
  for (const c of idleCouriers(s)) {
    const best = Object.entries(counts).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])[0];
    if (!best) break;
    counts[best[0]] -= B.courierCap(s, c);
    n++;
  }
  return n;
}
/** 手の空いた配達員を全員、返却待ちの多い世界から順に出発させる */
export function sendAll(s: GameState, now: number): Result {
  let n = 0;
  for (;;) {
    const counts: Record<string, number> = {};
    for (const it of s.items) if (it.stage === 'ready') counts[it.world] = (counts[it.world] ?? 0) + 1;
    const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (!best || !idleCouriers(s).length) break;
    const r = send(s, best[0], now);
    if (!r.ok) break;
    n++;
  }
  return n ? ok(`${n}人が出発しました`) : ng('出発できる配達員か荷がありません');
}

/** 窓口に出す「次の目標」：いちばん近いもの一つ（進み具合つき） */
export function nextGoal(s: GameState): { text: string; cur: number; need: number; tab: Tab; anchor?: string; research?: boolean } | null {
  const cands: { text: string; cur: number; need: number; tab: Tab; anchor?: string; research?: boolean }[] = [];
  if (B.rlv(s, 'auto_dispatch') === 0 && pendingLv(s, 'auto_dispatch') === 0) {
    const need = researchCostFor(s, 'auto_dispatch');
    cands.push(researchAvailable(s, 'auto_dispatch')
      ? { text: '定期便の運行（留守中も配達員が出発する）', cur: s.credit, need, tab: 'map', anchor: 'research', research: true }
      : { text: '定期便の運行の研究を解放（返却を重ねる）', cur: s.totals.returned, need: RESEARCH_BY_ID.auto_dispatch.req?.returns ?? 10, tab: 'storage', anchor: 'ready' });
  }
  const openNext = RESEARCH.find(r => r.kind === 'world' && researchAvailable(s, r.id) && pendingLv(s, r.id) === 0);
  if (openNext) cands.push({ text: `${WORLD[openNext.world!].name}への開通`, cur: s.credit, need: researchCostFor(s, openNext.id), tab: 'map', anchor: 'research', research: true });
  else {
    // 条件がまだの開通研究（返却数で開く）
    const locked = RESEARCH.find(r => r.kind === 'world' && !B.openWorlds(s).includes(r.world!) && r.req?.returns && s.totals.returned < r.req.returns);
    if (locked) cands.push({ text: `${WORLD[locked.world!].name}への開通調査を解放（返却を重ねる）`, cur: s.totals.returned, need: locked.req!.returns!, tab: 'storage', anchor: 'ready' });
  }
  cands.push({ text: `支所の移転（${nextPlace(s.relocations)}）`, cur: s.branchCredit, need: B.relocateAt(s.relocations), tab: 'map', anchor: 'relocate' });
  // 割合がいちばん進んでいて、まだ届いていないもの（届いていればそれを）
  cands.sort((a, b) => Math.min(1, b.cur / b.need) - Math.min(1, a.cur / a.need));
  return cands[0] ?? null;
}

export function hire(s: GameState, role: Role, idx: number, now: number): Result {
  const n = s.staff.filter(x => x.role === role).length;
  if (n >= B.maxStaff(s, role)) return ng('これ以上は雇えません（施設を拡張してください）');
  const cost = B.hireCost(s, role);
  if (s.fee < cost) return ng('礼金が足りません');
  const c = s.candidates[role][idx];
  if (!c) return ng('候補がいません');
  s.fee -= cost; s.session.invested = (s.session.invested ?? 0) + 1;
  const st = addStaff(s, role, c, now);
  refreshCandidates(s, role);
  acted(s);
  assignWork(s, now);
  log(s, now, `${ROLES[role].name}の${st.name}（${trait(role, st.trait).name}）が着任した。`);
  return ok(`${st.name}を${ROLES[role].name}として迎えました`);
}

export function levelUp(s: GameState, id: number): Result {
  const st = s.staff.find(x => x.id === id);
  if (!st) return ng('職員が見つかりません');
  const cost = B.levelCost(st, s);
  if (s.fee < cost) return ng('礼金が足りません');
  s.fee -= cost; st.lv++; s.session.invested = (s.session.invested ?? 0) + 1;
  acted(s);
  return ok(`${st.name}がLv${st.lv}になりました`);
}

export function upgrade(s: GameState, id: FacilityId): Result {
  const lv = s.facilities[id];
  if (lv >= B.facilityMax(s, id)) return ng('これ以上は拡張できません');
  const cost = B.facilityCost(id, lv);
  if (s.fee < cost) return ng('礼金が足りません');
  s.fee -= cost; s.facilities[id]++; s.session.invested = (s.session.invested ?? 0) + 1;
  acted(s);
  return ok(`${B.FACILITY[id].name}をLv${s.facilities[id]}に拡張しました`);
}

export function researchAvailable(s: GameState, id: string): boolean {
  const r = RESEARCH_BY_ID[id];
  if (B.rlv(s, id) >= B.researchMax(s, id)) return false;
  if (r.kind === 'world' && r.world && B.openWorlds(s).includes(r.world)) return false;
  const q = r.req;
  if (q?.returns && s.totals.returned < q.returns) return false;
  if (q?.research && B.rlv(s, q.research) < 1 && !(RESEARCH_BY_ID[q.research].world && B.openWorlds(s).includes(RESEARCH_BY_ID[q.research].world!))) return false;
  return true;
}
/** 進行中の研究と同じものを予約するなら一段上を数える */
export const RESEARCH_QUEUE = 3;
const pendingLv = (s: GameState, id: string) => B.rlv(s, id) + (s.research.active?.id === id ? 1 : 0) + s.research.queue.filter(q => q === id).length;
/** 着手・予約にかかる費用（進行中と同じ研究を予約するなら一段上の費用） */
export const researchCostFor = (s: GameState, id: string) => B.researchCostAt(s, id, pendingLv(s, id));
export const researchTimeFor = (s: GameState, id: string) => RESEARCH_BY_ID[id].hours * B.HOUR * Math.pow(RESEARCH_BY_ID[id].hoursGrowth ?? 1, pendingLv(s, id));
/** 一覧に出す研究（進行中のものは、もう一段取れる場合だけ） */
export const researchList = (s: GameState) => RESEARCH.filter(r => researchAvailable(s, r.id) && pendingLv(s, r.id) < B.researchMax(s, r.id));

export function startResearch(s: GameState, id: string, now: number): Result {
  if (s.research.active && s.research.queue.length >= RESEARCH_QUEUE) return ng(`予約は${RESEARCH_QUEUE}件までです`);
  if (!researchAvailable(s, id)) return ng('まだ着手できません');
  const reserving = !!s.research.active;
  if (pendingLv(s, id) >= B.researchMax(s, id)) return ng('これ以上は予約できません');
  const cost = researchCostFor(s, id);
  if (s.credit < cost) return ng('信用が足りません');
  s.credit -= cost; s.session.invested = (s.session.invested ?? 0) + 1;
  acted(s);
  if (reserving) { s.research.queue.push(id); return ok(`「${RESEARCH_BY_ID[id].name}」を予約しました`); }
  s.research.active = { id, start: now, end: now + B.researchTime(s, id) };
  return ok(`「${RESEARCH_BY_ID[id].name}」に着手しました`);
}
/** 進行中の研究を今すぐ終える費用（残り1時間あたり、その段の費用の半分。最低はその段の費用の1割） */
export function rushCost(s: GameState, now: number): number {
  const a = s.research.active;
  if (!a) return 0;
  const left = Math.max(0, a.end - now) / B.HOUR;
  const base = B.researchCostAt(s, a.id, B.rlv(s, a.id));
  return Math.round(base * Math.max(0.1, 0.5 * left));
}
export function rushResearch(s: GameState, now: number): Result {
  const a = s.research.active;
  if (!a) return ng('進行中の研究がありません');
  const cost = rushCost(s, now);
  if (s.credit < cost) return ng('信用が足りません');
  s.credit -= cost; s.session.invested = (s.session.invested ?? 0) + 1;
  const d = a.end - now;
  a.end = now; a.start = Math.min(a.start, now - 1);
  advance(s, now);
  acted(s);
  return ok(d > 0 ? `「${RESEARCH_BY_ID[a.id].name}」を早めて終えました` : '研究が終わりました');
}
/** 最後に入れた予約を取り消して、費用を払い戻す */
export function cancelReservation(s: GameState): Result {
  const id = s.research.queue.pop();
  if (!id) return ng('予約はありません');
  s.credit += researchCostFor(s, id);
  return ok('予約を取り消しました');
}

export function readLetter(s: GameState, owner: string, idx: number) {
  const l = s.letters.find(x => x.owner === owner && x.idx === idx);
  if (l) l.read = true;
}

// ---- 移転（周回） ----
export const canRelocate = (s: GameState) => s.branchCredit >= B.relocateAt(s.relocations);
/** 移転先の名前（6回目以降は終点の先へ） */
export const nextPlace = (n: number) => RELOCATIONS[n]?.place ?? `終点 第${n - RELOCATIONS.length + 1}窓口`;
export function relocate(s: GameState, now: number): Result {
  if (!canRelocate(s)) return ng('まだ移転できません');
  while (s.research.queue.length) cancelReservation(s);
  const fresh = createState(now, s.rng);
  const keepResearch: Record<string, number> = {};
  // 開通と自動化は全部、段階式の研究は半分を引き継ぐ
  for (const [id, lv] of Object.entries(s.research.levels)) {
    const r = RESEARCH_BY_ID[id];
    if (!r) continue;
    if (r.keep) keepResearch[id] = lv;
    else if (r.kind === 'level' && lv >= 2) keepResearch[id] = Math.floor(lv / 2);
  }
  const n = s.relocations + 1;
  const gain = B.relocateGain(s);
  const next: GameState = {
    ...fresh,
    createdAt: s.createdAt,
    relocations: n,
    perm: s.perm + gain,
    // 引き継ぐもの：職員（Lv・特性）、図鑑、持ち主の物語、謎、世界の開通、累計
    staff: s.staff.map(x => ({ ...x, task: null })),
    catalog: s.catalog, ownerReturns: s.ownerReturns, letters: s.letters,
    mysterySeen: s.mysterySeen, totals: s.totals, settings: s.settings,
    // 自動化など「残る」研究が進行中なら、残り時間ごと引き継ぐ
    research: { active: s.research.active && RESEARCH_BY_ID[s.research.active.id]?.keep ? { ...s.research.active } : null, queue: [], levels: keepResearch },
    nextId: Math.max(s.nextId, fresh.nextId) + 1,
    firstTrip: false
  };
  // 施設は職員数に足りる分だけ確保（引き継いだ職員が働けるように）
  const cnt = (r: Role) => next.staff.filter(x => x.role === r).length;
  next.facilities.appraisal = Math.max(1, cnt('appraiser'));
  next.facilities.workshop = Math.max(1, cnt('repairer'));
  next.facilities.gate = Math.max(1, (cnt('courier') - 1) * 2);
  // 新しい世界の素材を少し
  const rl = RELOCATIONS[n - 1];
  for (const w of B.openWorlds(next)) next.materials[w] = Math.max(next.materials[w] ?? 0, 15);
  // 前の期の礼金を少しだけ持ち越す（新しい仕組みを最初の日から試せるように）
  next.fee = Math.max(next.fee, Math.round(s.fee * 0.05));
  next.relocatedAt = now; next.prevMult = B.branchMult(s);
  // 着任時の品も、引き継いだ物語の進み具合に合わせて持ち主を決め直す
  // 最初の便には新しい世界の品を3件入れる
  if (rl) fresh.items.slice(0, 3).forEach(it => { const list = ITEMS_BY_WORLD[rl.world]; it.world = rl.world; it.type = list[(it.id * 7) % list.length].id; it.choices = [rl.world, ...it.choices.filter(c => c !== rl.world)].slice(0, 3).sort(); it.strike = null; });
  for (const it of fresh.items) { const a = assignOwner(next, it.world, it.type); it.type = a.type; it.owner = a.owner; }
  // 最初の便の品物は、新しい状態のIDと重ならないよう振り直す
  next.items = fresh.items.map(it => ({ ...it, id: next.nextId++ }));
  refreshCandidates(next);
  const place = nextPlace(n - 1);
  log(next, now, rl ? `${place}へ移転した。新しい仕組み「${rl.mechanicName}」が使えるようになった。` : `${place}へ移転した。`);
  Object.assign(s, next);
  return ok(`${place}へ移転しました（永続倍率 +${gain.toFixed(2)}）`);
}

// ---- 閉館の判定 ----
export function pendingWork(s: GameState) {
  const unknown = s.items.filter(i => i.stage === 'unknown').length;
  const gate = s.items.filter(i => i.stage === 'gate').length;
  const room = B.storageCap(s) - storageUsed(s);
  const repairable = s.items.filter(i => i.stage === 'damaged' && (s.materials[i.world] ?? 0) >= B.repairMaterials(s, i.world)).length;
  const ready = s.items.filter(i => i.stage === 'ready').length;
  const idle = idleCouriers(s).length;
  return { unknown, gateCollectable: Math.min(gate, Math.max(0, room)), repairable, ready, idle };
}
/** いま窓口でできることが残っていなければ閉館できる（運ぶ荷がない配達員は待機していてよい） */
export function canClose(s: GameState): boolean {
  const p = pendingWork(s);
  const canShip = p.ready > 0 && p.idle > 0;
  return p.unknown === 0 && p.gateCollectable === 0 && p.repairable === 0 && !canShip;
}
/** 破損品が待っているのに素材が足りない世界 */
export function materialShort(s: GameState): string[] {
  const ws = new Set(s.items.filter(i => i.stage === 'damaged').map(i => i.world));
  return [...ws].filter(w => (s.materials[w] ?? 0) < B.repairMaterials(s, w));
}
/** 配達の能力が届く量に追いついていないか（配達員全員が往復し続けた場合の1日の量で比べる） */
export function deliverBehind(s: GameState): boolean {
  const open = B.openWorlds(s);
  const DAY = 24 * B.HOUR;
  const deliver = s.staff.filter(x => x.role === 'courier').reduce((a, st) => a + B.courierCap(s, st) * DAY / (open.reduce((t, w) => t + B.tripTime(s, st, w), 0) / open.length), 0);
  return deliver < B.perDelivery(s) * 8;
}
/** 配達が追いついていないか（返却待ちが、配達員全員で一度に運べる量の2倍を超える） */
export function courierShort(s: GameState): boolean {
  if (s.totals.trips < 3 && s.relocations === 0) return false; // 研修便のあいだは出さない
  const cap = s.staff.filter(x => x.role === 'courier').reduce((a, x) => a + B.courierCap(s, x), 0);
  const waiting = s.items.filter(i => i.stage === 'ready').length;
  return waiting > cap * 2;
}

export interface TimerRow { label: string; at: number; color?: string }
export function timers(s: GameState): TimerRow[] {
  const rows: TimerRow[] = [{ label: 'ゲート：次の便', at: s.gate.next }];
  for (const st of s.staff) {
    if (st.task?.kind === 'trip') rows.push({ label: `${st.name}：${WORLD[st.task.world].short}から帰還`, at: st.task.end, color: WORLD[st.task.world].color });
  }
  const lastOf = (kind: 'appraise' | 'repair') => {
    const busy = s.staff.filter(x => x.task?.kind === kind);
    if (!busy.length) return;
    const q = s.items.filter(i => i.stage === (kind === 'appraise' ? 'qAppraise' : 'qRepair')).length;
    const per = busy.reduce((a, x) => a + (x.task!.end - x.task!.start), 0) / busy.length;
    const end = Math.max(...busy.map(x => x.task!.end)) + Math.ceil(q / busy.length) * per;
    rows.push({ label: kind === 'appraise' ? `鑑定：残り${q + busy.length}件が終わる` : `修理：残り${q + busy.length}件が終わる`, at: end });
  };
  lastOf('appraise'); lastOf('repair');
  if (s.research.active) rows.push({ label: `研究：${RESEARCH_BY_ID[s.research.active.id].name}`, at: s.research.active.end });
  return rows.sort((a, b) => a.at - b.at);
}
/** 次に開くおすすめ時刻：配達員の半数以上が戻り、かつ次の便が届いた後（荷が残っていれば、配達員が戻りしだい） */
export function recommendedOpen(s: GameState, now: number): number {
  const trips = s.staff.filter(x => x.task?.kind === 'trip').map(x => x.task!.end).sort((a, b) => a - b);
  const half = trips.length ? trips[Math.max(0, Math.ceil(trips.length / 2) - 1)] : now;
  let t = Math.max(half, s.gate.next);
  // 運ぶ荷が残っているなら、最初の配達員が戻る時刻
  if (s.items.some(i => i.stage === 'ready') && trips.length && B.rlv(s, 'auto_dispatch') === 0) t = Math.min(t, trips[0]);
  // 手の空いた配達員がいて、鑑定・修理が終われば荷ができるなら、その時刻
  const idle = s.staff.some(x => x.role === 'courier' && !x.task);
  // 鑑定・修理の待ちが全部終わる時刻（その後に配達を出せる）。10分以内なら勧めない
  const done = timers(s).filter(r => r.label.startsWith('鑑定') || r.label.startsWith('修理')).map(r => r.at);
  if (idle && done.length) { const d = Math.max(...done); if (d - now > 10 * B.MIN) t = Math.min(t, d); }
  // 倉庫が溢れる前には戻る
  const room = B.storageCap(s) - storageUsed(s);
  const fullAt = s.gate.next + Math.max(0, Math.ceil(room / B.perDelivery(s)) - 1) * B.GATE_INTERVAL;
  t = Math.min(t, fullAt);
  return Math.max(t, now + 10 * B.MIN);
}

export type Tab = 'counter' | 'storage' | 'staff' | 'map' | 'catalog';
export interface Advice { text: string; sub: string; tab: Tab; anchor?: string; pri: number }
/** 「次の一手」候補（優先度順） */
export function advice(s: GameState, now: number, limit = 3): Advice[] {
  const a: Advice[] = [];
  const p = pendingWork(s);
  if (p.gateCollectable) a.push({ text: `ゲート前の${p.gateCollectable}件を回収する`, sub: '回収', tab: 'storage', anchor: 'gate', pri: 100 });
  if (p.unknown) a.push({ text: `未鑑定の${p.unknown}件を鑑定する`, sub: '処理', tab: 'storage', anchor: 'unknown', pri: 90 });
  if (p.repairable) a.push({ text: `破損品${p.repairable}件を工房へ回す`, sub: '処理', tab: 'storage', anchor: 'damaged', pri: 80 });
  if (p.ready && p.idle) a.push({ text: `返却待ち${p.ready}件を配達に出す`, sub: '配達', tab: 'storage', anchor: 'ready', pri: 85 });
  // 物語（手紙と記録）はまとめて一枠
  const unread = s.letters.filter(l => !l.read).length;
  const newPage = s.mysterySeen < mysteryCount(s);
  if (unread || newPage) a.push({
    text: unread && newPage ? `手紙${unread}通と、落とし主の記録の新しい頁` : unread ? `持ち主からの手紙が${unread}通届いている` : '落とし主の記録に新しい頁がある',
    sub: '物語', tab: 'catalog', anchor: unread ? 'letters' : 'mystery', pri: 52
  });
  const ms = materialShort(s);
  if (ms.length) a.push({ text: `${ms.map(w => `${WORLD[w].material}（${WORLD[w].short}）`).join('・')}が足りない：${ms.map(w => WORLD[w].short).join('・')}の品を返すと手に入る`, sub: '素材', tab: 'storage', anchor: 'ready', pri: 78 });
  // 定期便のために信用を貯めている最中か
  const savingDispatch = courierShort(s) && B.rlv(s, 'auto_dispatch') === 0 && researchAvailable(s, 'auto_dispatch') && pendingLv(s, 'auto_dispatch') === 0;
  // 次の目標が研究で、半分以上貯まっているなら、他の研究は勧めずに貯める
  const goal = nextGoal(s);
  const savingGoal = !!goal?.research && goal.cur < goal.need && goal.cur >= goal.need * 0.5;
  const saving = savingDispatch || savingGoal;
  if (savingGoal && !savingDispatch) a.push({ text: `目標まで、あと信用 ${Math.ceil(goal!.need - goal!.cur).toLocaleString('en-US')}（${goal!.text}）`, sub: '目標', tab: 'map', anchor: 'research', pri: 58 });
  const reloc = canRelocate(s);
  if (courierShort(s)) {
    const nC = s.staff.filter(x => x.role === 'courier').length;
    if (savingDispatch) {
      const cost = researchCostFor(s, 'auto_dispatch');
      a.push(cost <= s.credit
        ? { text: '配達が追いつかない：「定期便の運行」を研究すると、留守中も配達員が出発する', sub: '研究', tab: 'map', anchor: 'research', pri: 80 }
        : { text: `配達が追いつかない：定期便の研究まで、あと信用 ${Math.ceil(cost - s.credit).toLocaleString('en-US')}（それまでは配達員のLvを）`, sub: '目標', tab: 'staff', anchor: 'hire-courier', pri: 80 });
    } else if (nC >= B.maxStaff(s, 'courier') && s.facilities.gate < B.facilityMax(s, 'gate')) {
      // 雇える枠が埋まっている：ゲートを広げると枠が増える
      let lv = s.facilities.gate; while (1 + Math.floor(lv / 2) <= nC) lv++;
      a.push({ text: `配達が追いつかない：転送ゲートをLv${lv}にすると、配達員を1人増やせる`, sub: '施設', tab: 'staff', anchor: 'facilities', pri: 80 });
    } else a.push({ text: '配達が追いつかない：配達員を雇うかLvを上げる', sub: '職員', tab: 'staff', anchor: 'hire-courier', pri: 80 });
  }
  if (!s.research.active || s.research.queue.length < RESEARCH_QUEUE) {
    const cand = researchList(s).filter(r => researchCostFor(s, r.id) <= s.credit);
    if (cand.length && !saving && !reloc) a.push({ text: s.research.active ? `次の研究を予約できる（${cand.length}件）` : `研究に着手できる（${cand.length}件）`, sub: '研究', tab: 'map', anchor: 'research', pri: s.research.active ? 45 : 60 });
  }
  const fac = (['gate', 'storage', 'workshop', 'appraisal'] as FacilityId[]).filter(f => s.facilities[f] < B.facilityMax(s, f) && B.facilityCost(f, s.facilities[f]) <= s.fee);
  const hires = (['appraiser', 'repairer', 'courier'] as Role[]).filter(r => s.staff.filter(x => x.role === r).length < B.maxStaff(s, r) && B.hireCost(s, r) <= s.fee);
  const hireRole = hires.includes('courier') ? 'courier' : hires[hires.length - 1];
  if (hireRole && !reloc) a.push({ text: `${ROLES[hireRole].name}を新しく雇える`, sub: '職員', tab: 'staff', anchor: `hire-${hireRole}`, pri: 55 });
  // 移転できるとき（施設は移転でなくなる）や、配達が届く量に追いついていないときは、施設の拡張を勧めない
  const facOk = fac.filter(f => f !== 'gate' || !deliverBehind(s));
  if (facOk.length && !courierShort(s) && !reloc) a.push({ text: `${B.FACILITY[facOk[0]].name}を拡張できる`, sub: '施設', tab: 'staff', anchor: 'facilities', pri: 50 });
  if (reloc) a.push({ text: '支所の移転が可能になった（施設と研究への出費は、移転でなくなる）', sub: '移転', tab: 'map', anchor: 'relocate', pri: 99 });
  // 移転して1日のあいだは、新しい仕組みを案内する
  const rl = RELOCATIONS[s.relocations - 1];
  if (rl && s.relocatedAt && now - s.relocatedAt < 24 * B.HOUR) a.push({ text: `新しい仕組み「${rl.mechanicName}」：${rl.mechanicDesc}`, sub: '新規', tab: rl.mechanic === 'express' || rl.mechanic === 'bigcart' ? 'storage' : 'counter', anchor: rl.mechanic === 'express' || rl.mechanic === 'bigcart' ? 'ready' : undefined, pri: 70 });
  const exp = s.requests.filter(q => !q.done && q.expiresAt - now < 3 * B.HOUR && q.expiresAt > now);
  if (exp.length) a.push({ text: `「探しています」の期限が近い（${exp.length}件）：依頼品は返却待ちの先頭に積まれる`, sub: '依頼', tab: 'storage', anchor: 'ready', pri: 40 });
  return a.sort((x, y) => y.pri - x.pri).slice(0, limit);
}
const mysteryCount = (s: GameState) => mysteryUnlocked(s);

export function itemsAt(s: GameState, stage: ItemInst['stage']) { return s.items.filter(i => i.stage === stage); }
