// モーダル類：鑑定、品物、手紙、開館、閉館、設定、世界、移転
import type { App } from './app';
import type { Report } from '../core/types';
import * as A from '../core/actions';
import * as B from '../core/balance';
import { ITEM, WORLD, OWNER, RELOCATIONS, ITEMS_BY_WORLD, OWNERS_BY_WORLD } from '../core/data';
import { ownerName } from './components';
import { h, icon } from './dom';
import { I } from './icons';
import { num, clock, span, pad } from './fmt';
import { stringSvg, tilt, STAGE_LABEL, isRequested } from './components';
import { exportSave, importSave, save, wipe } from '../core/save';
import { createState, mysteryUnlocked, storageUsed } from '../core/engine';

type Closer = () => void;
function sheet(app: App, build: (close: Closer) => (Node | null)[], opts: { title?: string; onClose?: () => void } = {}) {
  app.modalOpen++;
  app.toasts.classList.add('top');
  const layer = h('div', { class: 'layer', role: 'dialog', 'aria-modal': 'true' });
  let closed = false;
  const close = () => {
    if (closed) return; closed = true;
    layer.classList.add('closing'); body.classList.add('closing');
    setTimeout(() => { layer.remove(); app.modalOpen--; opts.onClose?.(); if (app.modalOpen === 0) { app.toasts.classList.remove('top'); app.render(); } }, 240);
  };
  const scrim = h('div', { class: 'scrim', onclick: close });
  const body = h('div', { class: 'sheet' }, h('div', { class: 'grab' }),
    opts.title ? h('div', { class: 'sheet-h' }, opts.title, h('span', { class: 'x' }, h('button', { class: 'x-btn', 'aria-label': '閉じる', onclick: close }, icon(I.close, 20)))) : null,
    ...build(close));
  layer.append(scrim, body);
  document.body.append(layer);
  // つまみを下へ引くと閉じる
  let y0 = -1;
  for (const handle of [body.querySelector<HTMLElement>('.grab'), body.querySelector<HTMLElement>('.sheet-h')]) {
    if (!handle) continue;
    handle.addEventListener('pointerdown', e => { if ((e.target as Element).closest('button')) return; y0 = e.clientY; handle.setPointerCapture(e.pointerId); });
    handle.addEventListener('pointermove', e => { if (y0 >= 0) body.style.transform = `translateY(${Math.max(0, e.clientY - y0)}px)`; });
    handle.addEventListener('pointerup', e => { if (y0 < 0) return; const d = e.clientY - y0; y0 = -1; if (d > 80) close(); else body.style.transform = ''; });
    handle.addEventListener('pointercancel', () => { y0 = -1; body.style.transform = ''; });
  }
  return { close, body };
}

// ---------- 鑑定（3択） ----------
export function showGuess(app: App, id: number) {
  const s = app.s;
  const it = s.items.find(i => i.id === id);
  if (!it) return;
  const def = ITEM[it.type];
  const content = h('div');
  const { close } = sheet(app, () => [content], { title: '鑑定' });
  const tag = h('div', { class: 'tag big-tag unknown', style: { '--rot': tilt(it.id, 1) }, onclick: () => tag.classList.toggle('open') },
    stringSvg(), h('span', { class: 'hole' }),
    h('div', { class: 'tag-no' }, `No.${pad(it.id)}`),
    h('div', { class: 'tag-name' }, def.name),
    h('div', { class: 'desc' }, def.desc),
    h('div', { class: 'tag-foot' }, it.rarity ? h('span', { class: 'chip red' }, `${B.RARITY_NAME[it.rarity]}（礼金・信用×${B.RARITY_MULT[it.rarity]}）`) : null, isRequested(s, it) ? h('span', { class: 'chip green' }, '依頼品（報酬×3）') : null));
  const clues = h('div', { class: 'clues' }, ...def.clues.map((c, i) => h('div', { class: 'clue' }, h('b', null, `手がかり${i + 1}`), c)));
  const after = h('div');
  const choiceBtns = it.choices.map(wid => {
    const w = WORLD[wid];
    const opened = B.openWorlds(s).includes(wid);
    const b = h('button', { class: ['choice', it.strike === wid && 'struck'], style: { '--wc': w.color } },
      h('div', null, w.name, h('small', null, opened ? `素材：${w.material}` : 'まだゲートの線が届いていない世界')));
    b.addEventListener('click', () => answer(wid));
    return b;
  });
  const delegate = h('button', { class: 'btn btn-ghost btn-block mt12', onclick: () => { app.act((st, now) => A.delegate(st, [id], now)); next(); } }, '鑑定士に任せる（1件 約3分）');
  content.append(tag, clues, h('div', { class: 'note', style: { marginTop: '10px' } }, 'どの世界の品でしょう。当たれば返却時の礼金が上乗せされます。'), h('div', { class: 'choices' }, ...choiceBtns), delegate, after);

  function answer(wid: string) {
    const r = app.act((st, now) => A.guess(st, id, wid, now), true);
    if (!r.ok) return;
    const right = wid === it!.world;
    choiceBtns.forEach((b, i) => {
      const c = it!.choices[i];
      b.classList.add(c === it!.world ? 'right' : c === wid ? 'wrong' : 'dim');
      (b as HTMLButtonElement).disabled = true;
    });
    delegate.remove();
    tag.classList.remove('unknown');
    tag.style.setProperty('--wc', WORLD[it!.world].color);
    tag.classList.add('stamped');
    tag.append(h('div', { class: ['stamp', 'big', 'press', !right && 'gray'] }, right ? '的中' : '外れ'));
    const nextOne = app.s.items.find(i => i.stage === 'unknown');
    after.append(
      h('div', { class: 'result-band' }, right ? `${WORLD[it!.world].name}の品でした。礼金が上乗せされます。` : `正しくは${WORLD[it!.world].name}の品でした。`,
        it!.damaged ? ' 破損しているので修理が必要です。' : ''),
      h('div', { class: 'btn-row mt12' },
        nextOne ? h('button', { class: 'btn btn-primary', onclick: () => { close(); setTimeout(() => showGuess(app, nextOne.id), 260); } }, '次の品へ', icon(I.arrow, 18)) : null,
        h('button', { class: 'btn btn-ghost', onclick: close }, '閉じる')));
    // 小さい画面でも結果と「次の品へ」が見えるように
    requestAnimationFrame(() => { const sh = after.closest('.sheet'); sh?.scrollTo({ top: sh.scrollHeight, behavior: s.settings.reduceMotion ? 'auto' : 'smooth' }); });
    if (navigator.vibrate && !s.settings.reduceMotion) navigator.vibrate(right ? 18 : [10, 40, 10]);
  }
  function next() {
    const n = app.s.items.find(i => i.stage === 'unknown');
    close();
    if (n) setTimeout(() => showGuess(app, n.id), 260);
  }
}

// ---------- 品物の詳細 ----------
export function showItem(app: App, id: number) {
  const s = app.s;
  const it = s.items.find(i => i.id === id);
  if (!it) return;
  const def = ITEM[it.type];
  const known = it.verdict !== null;
  const w = WORLD[it.world];
  sheet(app, close => [
    h('div', { class: ['tag', 'big-tag', !known && 'unknown'], style: { '--rot': tilt(it.id, 1), ...(known ? { '--wc': w.color } : {}) } },
      stringSvg(), h('span', { class: 'hole' }),
      h('div', { class: 'tag-no' }, `No.${pad(it.id)}`),
      h('div', { class: 'tag-name' }, def.name),
      h('div', { class: 'tag-world' }, h('i'), known ? w.name : '出どころ不明'),
      h('div', { class: 'desc' }, def.desc),
      h('div', { class: 'tag-foot' }, h('span', { class: 'chip' }, STAGE_LABEL[it.stage]), it.rarity ? h('span', { class: 'chip red' }, B.RARITY_NAME[it.rarity]) : null),
      it.verdict === 'correct' ? h('div', { class: 'stamp' }, '的中') : null),
    h('div', { class: 'clues' }, ...def.clues.map((c, i) => h('div', { class: 'clue' }, h('b', null, `手がかり${i + 1}`), c))),
    known ? h('div', { class: 'card mt12' }, h('dl', { class: 'kv' },
      h('dt', null, '持ち主'), h('dd', null, ownerName(it.owner, it.world)),
      h('dt', null, '見込み礼金'), h('dd', null, num(B.itemFee(s, it))),
      h('dt', null, '見込み信用'), h('dd', null, num(B.itemCredit(s, it))))) : null,
    it.stage === 'damaged' ? h('button', { class: 'btn btn-primary btn-block mt12', onclick: () => { app.act((st, now) => A.repair(st, [id], now)); close(); } }, `工房へ回す（${w.material} ${B.repairMaterials(s, it.world)}）`) : null,
    h('button', { class: 'btn btn-ghost btn-block mt12', onclick: close }, '閉じる')
  ], { title: '品物' });
}

export function showCatalogItem(app: App, typeId: string) {
  const def = ITEM[typeId];
  const e = app.s.catalog[typeId];
  const w = WORLD[def.world];
  sheet(app, close => [
    h('div', { class: 'tag big-tag', style: { '--rot': '-1deg', '--wc': w.color } },
      stringSvg(), h('span', { class: 'hole' }),
      h('div', { class: 'tag-no' }, def.id.toUpperCase()),
      h('div', { class: 'tag-name' }, def.name),
      h('div', { class: 'tag-world' }, h('i'), w.name),
      h('div', { class: 'desc' }, def.desc),
      h('div', { class: 'tag-foot' }, h('span', { class: 'chip' }, `受付 ${e?.n ?? 0}件`), h('span', { class: 'chip' }, `返却 ${e?.r ?? 0}件`), e?.best ? h('span', { class: 'chip red' }, B.RARITY_NAME[e.best]) : null),
      (e?.r ?? 0) > 0 ? h('div', { class: 'stamp press' }, '返却済') : null),
    h('div', { class: 'clues' }, ...def.clues.map((c, i) => h('div', { class: 'clue' }, h('b', null, `手がかり${i + 1}`), c))),
    e?.o?.length ? h('div', { class: 'card mt12' }, h('div', { class: 'card-s' }, 'この品を返した相手'), h('div', { style: { fontWeight: 700, marginTop: '2px' } }, e.o.map(o => OWNER[o]?.name ?? '').filter(Boolean).join('、'))) : null,
    h('button', { class: 'btn btn-ghost btn-block mt12', onclick: close }, '閉じる')
  ], { title: '図鑑' });
}

// ---------- 手紙 ----------
export function showLetter(app: App, ownerId: string, idx: number) {
  const o = OWNER[ownerId];
  const l = app.s.letters.find(x => x.owner === ownerId && x.idx === idx);
  A.readLetter(app.s, ownerId, idx);
  save(app.s);
  const itemName = l?.type ? ITEM[l.type]?.name ?? 'お届けの品' : 'お届けの品';
  const text = o.letters[idx].replaceAll('{item}', itemName);
  const nextUnread = app.s.letters.find(x => !x.read);
  const { close } = sheet(app, close => [
    h('div', { class: 'letter' }, h('div', { class: 'seal' }, String(idx + 1)), ...text.split('\n').map(p => h('p', { style: { margin: 0 } }, p)), h('div', { class: 'from' }, `―― ${o.name}`)),
    l?.type ? h('div', { class: 'enclosure' }, h('span', { class: 'chip' }, '同封の記録'), `返却品　${itemName}${l.item ? `　No.${pad(l.item)}` : ''}`) : null,
    h('div', { class: 'btn-row' },
      nextUnread ? h('button', { class: 'btn btn-primary', onclick: () => { close(); setTimeout(() => showLetter(app, nextUnread.owner, nextUnread.idx), 260); } }, '次の手紙へ', icon(I.arrow, 18))
        : app.s.mysterySeen < mysteryUnlocked(app.s) ? h('button', { class: 'btn btn-primary', onclick: () => { close(); setTimeout(() => app.go('catalog', 'mystery'), 260); } }, '綴じ込まれた頁を読む') : null,
      h('button', { class: 'btn btn-ghost', onclick: () => close() }, '手紙を閉じる'))
  ], { title: `${WORLD[l?.world ?? '']?.short ?? ''}からの手紙` });
  void close;
}

// ---------- 着任（はじめて） ----------
export function showIntro(app: App) {
  sheet(app, close => [
    h('div', { class: 'intro' },
      h('div', { class: 'receipt' }, h('h3', null, '辞令'),
        h('p', { style: { margin: 0, lineHeight: 2 } }, 'あなたを異世界遺失物センターの窓口係に任ずる。'),
        h('p', { style: { margin: '6px 0 0', lineHeight: 2 } }, '転送ゲートからは三時間ごとに、どこかの世界の落とし物が届く。それがどこから来たのかを見極め、直し、持ち主へ返すこと。'),
        h('div', { class: 'stamp press', style: { right: '14px', bottom: '16px' } }, '受理')),
      h('div', { class: 'flow' }, ...['開館', '→', '回収', '→', '処理', '→', '仕込み', '→', '閉館'].map(t => h('span', null, t))),
      h('p', null, '窓口の上部にある「次の一手」を順にこなせば、一日の業務が回ります。まずはゲート前に残された、前任者の10件から。'),
      h('button', { class: 'btn btn-primary btn-block', onclick: close }, '着任する'))
  ], { title: '異世界遺失物センター' });
}

// ---------- 開館（留守中のまとめ） ----------
export function showReport(app: App, r: Report, pages: { id: number; title: string }[] = [], note?: string) {
  const any = r.arrivals || r.appraised || r.repaired || r.trips || r.research.length || r.deferred || pages.length;
  const lines: [string, string][] = [
    ['留守にしていた時間', span(r.to - r.from)],
    ['ゲートに届いた品', `${r.arrivals}件`],
    ['鑑定士が鑑定した品', `${r.appraised}件`],
    ['工房で直した品', `${r.repaired}件`],
    ['帰還した配達員', `${r.trips}人（返却 ${r.returned}件）`],
    ['礼金', `+${num(r.fee)}`],
    ['信用', `+${num(r.credit)}`],
    ['届いた手紙', `${r.letters}通`]
  ];
  if (r.requests) lines.push(['かなった依頼', `${r.requests}件`]);
  if (r.deferred) lines.push(['見送られた便', `${r.deferred}便（ゲート前が満杯。回収して空きを作りましょう）`]);
  const senders = [...new Set(r.letterList.map(l => OWNER[l.owner]?.name).filter(Boolean))];
  if (senders.length) lines.push(['手紙の差出人', senders.slice(0, 3).join('、') + (senders.length > 3 ? ` ほか${senders.length - 3}人` : '')]);
  for (const p of pages) lines.push([`綴じ込まれた頁`, `第${p.id}頁「${p.title}」`]);
  const done: Record<string, number> = {};
  for (const n of r.research) done[n] = (done[n] ?? 0) + 1;
  for (const [n, c] of Object.entries(done)) lines.push(['完了した研究', c > 1 ? `${n}（${c}段）` : n]);
  sheet(app, close => [
    h('div', { class: 'receipt' }, h('h3', null, '留守中の記録'),
      ...lines.map(([k, v], i) => h('div', { class: 'ln', style: { animationDelay: `${0.25 + i * 0.06}s` } }, h('span', null, k), h('b', null, v))),
      !any ? h('p', { class: 'note', style: { textAlign: 'center' } }, '静かな留守番でした。') : null,
      r.capped ? h('p', { class: 'note', style: { textAlign: 'center', margin: '8px 0 4px' } }, '留守中の業務は、最後に閉じてから24時間分までしか進みません。') : null,
      note ? h('div', { class: 'journal' }, h('span', { class: 'chip' }, '日誌の余白'), h('p', null, note)) : null),
    h('div', { class: 'btn-row' },
      r.letterList.length ? h('button', { class: 'btn btn-ghost', onclick: () => { close(); setTimeout(() => app.go('catalog', 'letters'), 260); } }, '手紙を読む')
        : pages.length ? h('button', { class: 'btn btn-ghost', onclick: () => { close(); setTimeout(() => app.go('catalog', 'mystery'), 260); } }, '記録を読む') : null,
      h('button', { class: 'btn btn-primary', onclick: close }, '窓口を開ける'))
  ], { title: '開館' });
}

// ---------- 閉館 ----------
export function showClosed(app: App) {
  const s = app.s;
  const now = Date.now();
  app.modalOpen++;
  app.toasts.classList.add('top');
  const ss = s.session;
  const rec = A.recommendedOpen(s, now);
  const el = h('div', { class: 'closed', role: 'dialog', 'aria-modal': 'true' }, h('div', { class: 'inner' },
    h('div', { class: 'sign-wrap' }, h('div', { class: 'sign' }, h('div', { class: 'sign-board' }, '本日閉館'))),
    h('div', { class: 'rec' }, h('small', null, '次に開くおすすめ時刻'), h('div', { class: 't' }, clock(rec, now)), h('small', null, `いまから約${span(rec - now)}後`),
      h('p', { class: 'rec-note' }, `アプリを閉じて大丈夫です。品物は消えません。倉庫はあと約${span(Math.max(0, (B.storageCap(s) - storageUsed(s))) / B.perDelivery(s) * B.GATE_INTERVAL)}ぶんの空きがあります。`)),
    h('h2', null, '今回の成果'),
    h('div', { class: 'panel' },
      ...[['回収', `${ss.collected ?? 0}件`], ['鑑定', `${ss.appraised}件（的中 ${ss.correct}）`], ['修理', `${ss.repaired}件`], ['配達に出した品', `${ss.shipped ?? 0}件（${ss.dispatched}人）`], ['見込み礼金', `+${num(ss.shippedFee ?? 0)}`], ['受け取った礼金', `+${num(ss.fee)}`], ['受け取った信用', `+${num(ss.credit)}`], ['手紙', `${ss.letters}通`]]
        .map(([k, v]) => h('div', { class: 'ln' }, h('span', null, k), h('b', null, v)))),
    h('h2', null, '留守中の予定'),
    h('div', { class: 'panel' }, ...A.timers(s).map(t => h('div', { class: 'ln' },
      h('span', { class: 'row', style: { gap: '8px' } }, t.color ? h('span', { class: 'wdot', style: { background: t.color } }) : null, t.label),
      h('b', null, clock(t.at, now))))),
    s.items.some(i => i.stage === 'ready') ? h('p', { style: { fontSize: '12.5px', opacity: .8, textAlign: 'center', margin: '12px 0 0' } }, `返却待ち${s.items.filter(i => i.stage === 'ready').length}件は、配達員が戻りしだい出せます。`) : null,
    h('div', { class: 'actions' }, h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn-tag', onclick: () => done() }, '窓口に戻る')))));
  document.body.append(el);
  save(s);
  function done() {
    el.style.transition = 'opacity .25s'; el.style.opacity = '0';
    setTimeout(() => { el.remove(); app.modalOpen--; app.toasts.classList.remove('top'); app.render(); }, 250);
  }
}

// ---------- 世界 ----------
export function showWorld(app: App, wid: string) {
  const s = app.s;
  const w = WORLD[wid];
  const c = B.catalogWorld(s, wid);
  const out = s.staff.filter(x => x.task?.kind === 'trip' && x.task.world === wid);
  const owners = OWNERS_BY_WORLD[wid];
  sheet(app, close => [
    h('div', { class: 'card lift', style: { borderLeft: `10px solid ${w.color}` } },
      h('p', { style: { margin: 0, lineHeight: 1.95, fontSize: '14px' } }, w.desc)),
    h('div', { class: 'card mt12' }, h('dl', { class: 'kv' },
      h('dt', null, '素材'), h('dd', null, `${w.material} ${Math.floor(s.materials[wid] ?? 0)}`),
      h('dt', null, '配達の目安'), h('dd', null, `往復 ${w.travelHours}時間`),
      h('dt', null, '品物の格'), h('dd', null, `${w.value}`),
      h('dt', null, '図鑑'), h('dd', null, `${c.got}/${ITEMS_BY_WORLD[wid].length}`),
      h('dt', null, '手紙'), h('dd', null, `${s.letters.filter(l => l.world === wid).length}/${owners.length * 3}`),
      h('dt', null, '向かっている配達員'), h('dd', null, out.length ? out.map(x => x.name).join('、') : 'なし'))),
    h('button', { class: 'btn btn-ghost btn-block mt12', onclick: close }, '閉じる')
  ], { title: w.name });
}

// ---------- 移転 ----------
export function showRelocate(app: App) {
  const s = app.s;
  const next = RELOCATIONS[s.relocations];
  const gain = B.relocateGain(s);
  sheet(app, close => [
    h('div', { class: 'receipt' }, h('h3', null, '移転届'),
      h('div', { class: 'ln' }, h('span', null, '移転先'), h('b', null, A.nextPlace(s.relocations))),
      next ? h('div', { class: 'ln' }, h('span', null, '新しい世界'), h('b', null, WORLD[next.world].name)) : null,
      next ? h('div', { class: 'ln' }, h('span', null, '新しい仕組み'), h('b', null, next.mechanicName)) : null,
      next ? h('p', { class: 'note' }, next.mechanicDesc) : h('p', { class: 'note' }, '終点の先の窓口。新しい世界はないが、永続倍率がさらに積み上がる。'),
      h('div', { class: 'ln' }, h('span', null, '移転の倍率'), h('b', null, `×${(1 + s.perm).toFixed(2)} → ×${(1 + s.perm + gain).toFixed(2)}（+${gain.toFixed(2)}）`)),
      h('p', { class: 'note' }, '目標を超えて信用を貯めてから移転すると、加算が少し増えます（最大+1.0まで上乗せ）。')),
    h('div', { class: 'card' },
      h('div', { class: 'card-t' }, '引き継ぐもの'), h('p', { class: 'note', style: { margin: '4px 0 10px' } }, '職員（Lv・特性。Lvの合計が倍率になる）、図鑑（収集率が倍率になる）、持ち主の手紙、落とし主の記録、開通した世界'),
      h('div', { class: 'card-t' }, '置いていくもの'), h('p', { class: 'note', style: { margin: '4px 0 0' } }, '礼金、信用、素材、倉庫の品物、施設のLv（職員が働ける分は残す）、段階式の研究の残り半分（開通・自動化の規程と、研究の半分は残る）')),
    h('div', { class: 'btn-row mt16' },
      h('button', { class: 'btn btn-ghost', onclick: close }, 'やめておく'),
      h('button', { class: 'btn btn-red', onclick: () => { close(); app.act(A.relocate); setTimeout(() => { app.go('counter'); app.main.scrollTop = 0; }, 280); } }, '移転する'))
  ], { title: '支所の移転' });
}

// ---------- 設定 ----------
export function showSettings(app: App) {
  const s = app.s;
  const area = h('textarea', { class: 'field', readonly: true, 'aria-label': 'エクスポートした文字列' }) as HTMLTextAreaElement;
  const input = h('textarea', { class: 'field', placeholder: 'ここに書き出した文字列を貼り付け', 'aria-label': 'インポートする文字列' }) as HTMLTextAreaElement;
  const file = h('input', { type: 'file', accept: '.txt,.json,text/plain,application/json', style: { display: 'none' } }) as HTMLInputElement;
  file.addEventListener('change', async () => { const f = file.files?.[0]; if (f) input.value = await f.text(); });
  const toggle = (key: 'reduceMotion' | 'autoAssign', title: string, desc: string) => {
    const sw = h('span', { class: ['switch', s.settings[key] && 'on'], 'aria-hidden': 'true' });
    const row = h('button', { class: 'toggle toggle-row', role: 'switch', 'aria-checked': String(s.settings[key]) },
      h('div', null, h('div', { class: 'card-t' }, title), h('div', { class: 'card-s' }, desc)), sw);
    row.addEventListener('click', () => {
      s.settings[key] = !s.settings[key];
      sw.classList.toggle('on', s.settings[key]);
      row.setAttribute('aria-checked', String(s.settings[key]));
      app.applySettings(); save(s);
    });
    return row;
  };
  sheet(app, close => [
    h('div', { class: 'card' }, toggle('reduceMotion', '動きを減らす', 'アニメーションを最小限にします')),
    B.rlv(s, 'auto_assign') > 0 ? h('div', { class: 'card' }, toggle('autoAssign', '回収した品を鑑定士に回す', '「常時委任の規程」による自動の鑑定。止めると、すべて自分で鑑定できます')) : null,
    h('div', { class: 'card' },
      h('div', { class: 'card-t' }, 'エクスポート'),
      h('p', { class: 'note', style: { margin: '4px 0 8px' } }, '進行状況を文字列にして書き出します。別の端末へ移すときに使います。'),
      area,
      h('div', { class: 'btn-row mt8' },
        h('button', { class: 'btn btn-ghost btn-sm', onclick: () => { area.value = exportSave(s); area.select(); } }, '書き出す'),
        h('button', { class: 'btn btn-ghost btn-sm', onclick: async () => { area.value = exportSave(s); try { await navigator.clipboard.writeText(area.value); app.toast('コピーしました', 'good'); } catch { area.select(); app.toast('選択しました。手動でコピーしてください'); } } }, 'コピー'),
        h('button', { class: 'btn btn-ghost btn-sm', onclick: () => {
          const blob = new Blob([exportSave(s)], { type: 'text/plain' });
          const a = h('a', { href: URL.createObjectURL(blob), download: `isekai-lost-found-${new Date().toISOString().slice(0, 10)}.txt` });
          document.body.append(a); a.click(); a.remove();
        } }, 'ファイル'))),
    h('div', { class: 'card' },
      h('div', { class: 'card-t' }, 'インポート'),
      h('p', { class: 'note', style: { margin: '4px 0 8px' } }, '書き出した文字列から復元します。今の進行状況は上書きされます。'),
      input, file,
      h('div', { class: 'btn-row mt8' },
        h('button', { class: 'btn btn-ghost btn-sm', onclick: () => file.click() }, 'ファイルを選ぶ'),
        h('button', { class: 'btn btn-primary btn-sm', onclick: () => {
          try {
            const ns = importSave(input.value, Date.now());
            Object.assign(app.s, ns);
            save(app.s); close(); app.toast('読み込みました', 'good');
          } catch { app.toast('読み込めませんでした。書き出した文字列を、最初から最後まで丸ごと貼り付けてください', 'ng'); }
        } }, '読み込む'))),
    h('div', { class: 'card' },
      h('div', { class: 'card-t' }, 'はじめから'),
      h('p', { class: 'note', style: { margin: '4px 0 8px' } }, 'すべての記録を消して、着任の日からやり直します。'),
      h('button', { class: 'btn btn-red btn-sm', onclick: () => {
        if (!confirm('本当にすべての記録を消しますか？')) return;
        wipe(); Object.assign(app.s, createState(Date.now())); save(app.s); close(); location.reload();
      } }, '記録を消す')),
    h('p', { class: 'note', style: { textAlign: 'center' } }, `自動保存：5秒ごと／最終保存 ${clock(s.savedAt)}`)
  ], { title: '設定' });
}
