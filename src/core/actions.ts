// ===== プレイヤーの操作 =====
import type { GameState, Role, FacilityId, ItemInst } from './types';
import { RESEARCH_BY_ID, RESEARCH, RELOCATIONS, WORLD, ROLES, trait } from './data';
import * as B from './balance';
import { collect, assignWork, tryQueueRepair, dispatch, finishAppraisal, addStaff, refreshCandidates, createState, log, assignOwner, storageUsed, mysteryUnlocked } from './engine';

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
  s.session.shipped = (s.session.shipped ?? 0) + n;
  if (st.task?.kind === 'trip') s.session.shippedFee = (s.session.shippedFee ?? 0) + st.task.items.reduce((a, id) => { const it = s.items.find(i => i.id === id); return a + (it ? B.itemFee(s, it) : 0); }, 0);
  acted(s);
  return ok(`${st.name}が${WORLD[world].short}へ出発しました（${n}件）`);
}

export function hire(s: GameState, role: Role, idx: number, now: number): Result {
  const n = s.staff.filter(x => x.role === role).length;
  if (n >= B.maxStaff(s, role)) return ng('これ以上は雇えません（施設を拡張してください）');
  const cost = B.hireCost(s, role);
  if (s.fee < cost) return ng('礼金が足りません');
  const c = s.candidates[role][idx];
  if (!c) return ng('候補がいません');
  s.fee -= cost;
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
  const cost = B.levelCost(st);
  if (s.fee < cost) return ng('礼金が足りません');
  s.fee -= cost; st.lv++;
  acted(s);
  return ok(`${st.name}がLv${st.lv}になりました`);
}

export function upgrade(s: GameState, id: FacilityId): Result {
  const lv = s.facilities[id];
  if (lv >= B.FACILITY[id].max) return ng('これ以上は拡張できません');
  const cost = B.facilityCost(id, lv);
  if (s.fee < cost) return ng('礼金が足りません');
  s.fee -= cost; s.facilities[id]++;
  acted(s);
  return ok(`${B.FACILITY[id].name}をLv${s.facilities[id]}に拡張しました`);
}

export function researchAvailable(s: GameState, id: string): boolean {
  const r = RESEARCH_BY_ID[id];
  if (B.rlv(s, id) >= r.max) return false;
  if (r.kind === 'world' && r.world && B.openWorlds(s).includes(r.world)) return false;
  const q = r.req;
  if (q?.returns && s.totals.returned < q.returns) return false;
  if (q?.research && B.rlv(s, q.research) < 1 && !(RESEARCH_BY_ID[q.research].world && B.openWorlds(s).includes(RESEARCH_BY_ID[q.research].world!))) return false;
  return true;
}
export const researchList = (s: GameState) => RESEARCH.filter(r => researchAvailable(s, r.id));

export function startResearch(s: GameState, id: string, now: number): Result {
  if (s.research.active && s.research.next) return ng('予約は一件までです');
  if (!researchAvailable(s, id)) return ng('まだ着手できません');
  const reserving = !!s.research.active;
  if (reserving && s.research.active!.id === id && B.rlv(s, id) + 1 >= RESEARCH_BY_ID[id].max) return ng('これ以上は予約できません');
  // 予約の場合、費用は今の段階＋1で計算する（進行中の研究が同じものなら一段上）
  const cost = reserving && s.research.active!.id === id
    ? Math.round(RESEARCH_BY_ID[id].cost * Math.pow(RESEARCH_BY_ID[id].growth, B.rlv(s, id) + 1))
    : B.researchCost(s, id);
  if (s.credit < cost) return ng('信用が足りません');
  s.credit -= cost;
  acted(s);
  if (reserving) { s.research.next = id; return ok(`「${RESEARCH_BY_ID[id].name}」を予約しました`); }
  s.research.active = { id, start: now, end: now + B.researchTime(s, id) };
  return ok(`「${RESEARCH_BY_ID[id].name}」に着手しました`);
}
export function cancelReservation(s: GameState): Result {
  const id = s.research.next;
  if (!id) return ng('予約はありません');
  const same = s.research.active?.id === id;
  s.credit += same ? Math.round(RESEARCH_BY_ID[id].cost * Math.pow(RESEARCH_BY_ID[id].growth, B.rlv(s, id) + 1)) : B.researchCost(s, id);
  s.research.next = null;
  return ok('予約を取り消しました');
}

export function readLetter(s: GameState, owner: string, idx: number) {
  const l = s.letters.find(x => x.owner === owner && x.idx === idx);
  if (l) l.read = true;
}

// ---- 移転（周回） ----
export const canRelocate = (s: GameState) => s.branchCredit >= B.relocateAt(s.relocations);
/** 移転先の名前（6回目以降は終点の先へ） */
export const nextPlace = (n: number) => RELOCATIONS[n]?.place ?? `終点 第${n - RELOCATIONS.length + 2}窓口`;
export function relocate(s: GameState, now: number): Result {
  if (!canRelocate(s)) return ng('まだ移転できません');
  const fresh = createState(now, s.rng);
  const keepResearch: Record<string, number> = {};
  for (const [id, lv] of Object.entries(s.research.levels)) if (RESEARCH_BY_ID[id]?.keep) keepResearch[id] = lv;
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
    research: { active: null, next: null, levels: keepResearch },
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
  for (const w of B.openWorlds(next)) next.materials[w] = Math.max(next.materials[w] ?? 0, 6);
  // 着任時の品も、引き継いだ物語の進み具合に合わせて持ち主を決め直す
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
/** 配達が追いついていないか（返却待ちが、配達員全員で一度に運べる量の2倍を超える） */
export function courierShort(s: GameState): boolean {
  const cap = s.staff.filter(x => x.role === 'courier').reduce((a, x) => a + B.courierCap(s, x), 0);
  const waiting = s.items.filter(i => i.stage === 'ready' || i.stage === 'damaged' || i.stage === 'qRepair' || i.stage === 'repairing').length;
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
  if (s.items.some(i => i.stage === 'ready') && trips.length) t = Math.min(t, trips[0]);
  // 手の空いた配達員がいて、鑑定・修理が終われば荷ができるなら、その時刻
  const idle = s.staff.some(x => x.role === 'courier' && !x.task);
  const work = s.staff.filter(x => x.task && x.task.kind !== 'trip').map(x => x.task!.end);
  if (idle && work.length) t = Math.min(t, Math.max(...work));
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
  if (p.ready && p.idle) a.push({ text: `返却待ち${p.ready}件を配達に出す`, sub: '仕込み', tab: 'storage', anchor: 'ready', pri: 85 });
  // 物語（手紙と記録）はまとめて一枠
  const unread = s.letters.filter(l => !l.read).length;
  const newPage = s.mysterySeen < mysteryCount(s);
  if (unread || newPage) a.push({
    text: unread && newPage ? `手紙${unread}通と、落とし主の記録の新しい頁` : unread ? `持ち主からの手紙が${unread}通届いている` : '落とし主の記録に新しい頁がある',
    sub: '物語', tab: 'catalog', anchor: unread ? 'letters' : 'mystery', pri: 52
  });
  if (courierShort(s)) a.push({ text: '配達が追いつかない：配達員を雇うかLvを上げる', sub: '職員', tab: 'staff', anchor: 'hire-courier', pri: 88 });
  if (!s.research.active || !s.research.next) {
    const cand = researchList(s).filter(r => B.researchCost(s, r.id) <= s.credit);
    if (cand.length) a.push({ text: s.research.active ? `次の研究を予約できる（${cand.length}件）` : `研究に着手できる（${cand.length}件）`, sub: '仕込み', tab: 'map', anchor: 'research', pri: s.research.active ? 45 : 60 });
  }
  const fac = (['gate', 'storage', 'workshop', 'appraisal'] as FacilityId[]).filter(f => s.facilities[f] < B.FACILITY[f].max && B.facilityCost(f, s.facilities[f]) <= s.fee);
  const hires = (['appraiser', 'repairer', 'courier'] as Role[]).filter(r => s.staff.filter(x => x.role === r).length < B.maxStaff(s, r) && B.hireCost(s, r) <= s.fee);
  const hireRole = hires.includes('courier') ? 'courier' : hires[hires.length - 1];
  if (hireRole) a.push({ text: `${ROLES[hireRole].name}を新しく雇える`, sub: '職員', tab: 'staff', anchor: `hire-${hireRole}`, pri: 55 });
  if (fac.length && !courierShort(s)) a.push({ text: `${B.FACILITY[fac[0]].name}を拡張できる`, sub: '施設', tab: 'staff', anchor: 'facilities', pri: 50 });
  if (canRelocate(s)) a.push({ text: '支所の移転が可能になった', sub: '移転', tab: 'map', anchor: 'relocate', pri: 95 });
  const exp = s.requests.filter(q => !q.done && q.expiresAt - now < 3 * B.HOUR && q.expiresAt > now);
  if (exp.length) a.push({ text: `「探しています」の期限が近い（${exp.length}件）`, sub: '依頼', tab: 'counter', anchor: 'requests', pri: 40 });
  return a.sort((x, y) => y.pri - x.pri).slice(0, limit);
}
const mysteryCount = (s: GameState) => mysteryUnlocked(s);

export function itemsAt(s: GameState, stage: ItemInst['stage']) { return s.items.filter(i => i.stage === stage); }
