// モーダル類：鑑定、品物、手紙、開館、閉館、設定、世界、移転
import type { App } from './app';
import type { Report } from '../core/types';
import * as A from '../core/actions';
import * as B from '../core/balance';
import { ITEM, WORLD, OWNER, RELOCATIONS, ITEMS_BY_WORLD, OWNERS_BY_WORLD } from '../core/data';
import { h, icon } from './dom';
import { I } from './icons';
import { num, clock, span, pad } from './fmt';
import { stringSvg, tilt, STAGE_LABEL, isRequested } from './components';
import { exportSave, importSave, save, wipe } from '../core/save';
import { createState } from '../core/engine';

type Closer = () => void;
function sheet(app: App, build: (close: Closer) => (Node | null)[], opts: { title?: string; onClose?: () => void } = {}) {
  app.modalOpen++;
  const layer = h('div', { class: 'layer', role: 'dialog', 'aria-modal': 'true' });
  let closed = false;
  const close = () => {
    if (closed) return; closed = true;
    layer.classList.add('closing'); body.classList.add('closing');
    setTimeout(() => { layer.remove(); app.modalOpen--; opts.onClose?.(); if (app.modalOpen === 0) app.render(); }, 240);
  };
  const scrim = h('div', { class: 'scrim', onclick: close });
  const body = h('div', { class: 'sheet' }, h('div', { class: 'grab' }),
    opts.title ? h('div', { class: 'sheet-h' }, opts.title, h('span', { class: 'x' }, h('button', { class: 'x-btn', 'aria-label': '閉じる', onclick: close }, icon(I.close, 20)))) : null,
    ...build(close));
  layer.append(scrim, body);
  document.body.append(layer);
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
  const tag = h('div', { class: 'tag big-tag unknown', style: { '--rot': tilt(it.id, 1) } },
    stringSvg(), h('span', { class: 'hole' }),
    h('div', { class: 'tag-no' }, `No.${pad(it.id)}`),
    h('div', { class: 'tag-name' }, def.name),
    h('div', { class: 'desc' }, def.desc),
    h('div', { class: 'tag-foot' }, it.rarity ? h('span', { class: 'chip red' }, B.RARITY_NAME[it.rarity]) : null, isRequested(s, it) ? h('span', { class: 'chip green' }, '依頼品') : null));
  const clues = h('div', { class: 'clues' }, ...def.clues.map((c, i) => h('div', { class: 'clue' }, h('b', null, `手がかり${i + 1}`), c)));
  const after = h('div');
  const choiceBtns = it.choices.map(wid => {
    const w = WORLD[wid];
    const opened = B.openWorlds(s).includes(wid);
    const b = h('button', { class: ['choice', it.strike === wid && 'struck'], style: { '--wc': w.color } },
      h('div', null, w.name, h('small', null, opened ? `素材：${w.material}` : '未開通の世界')));
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
    tag.append(h('div', { class: ['stamp', 'big', 'press', !right && 'gray'] }, right ? '的中' : '外れ'));
    const nextOne = app.s.items.find(i => i.stage === 'unknown');
    after.append(
      h('div', { class: 'result-band' }, right ? `${WORLD[it!.world].name}の品でした。礼金が上乗せされます。` : `正しくは${WORLD[it!.world].name}の品でした。`,
        it!.damaged ? ' 破損しているので修理が必要です。' : ''),
      h('div', { class: 'btn-row mt12' },
        nextOne ? h('button', { class: 'btn btn-primary', onclick: () => { close(); setTimeout(() => showGuess(app, nextOne.id), 260); } }, '次の品へ', icon(I.arrow, 18)) : null,
        h('button', { class: 'btn btn-ghost', onclick: close }, '閉じる')));
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
      h('dt', null, '持ち主'), h('dd', null, OWNER[it.owner]?.name ?? '不明'),
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
    h('button', { class: 'btn btn-ghost btn-block mt12', onclick: close }, '閉じる')
  ], { title: '図鑑' });
}

// ---------- 手紙 ----------
export function showLetter(app: App, ownerId: string, idx: number) {
  const o = OWNER[ownerId];
  A.readLetter(app.s, ownerId, idx);
  save(app.s);
  const text = o.letters[idx].replaceAll('{item}', 'お届けの品');
  sheet(app, close => [
    h('div', { class: 'letter' }, h('div', { class: 'seal' }, String(idx + 1)), ...text.split('\n').map(p => h('p', { style: { margin: 0 } }, p)), h('div', { class: 'from' }, `―― ${o.name}`)),
    h('button', { class: 'btn btn-ghost btn-block', onclick: close }, '手紙を閉じる')
  ], { title: `${WORLD[app.s.letters.find(l => l.owner === ownerId)?.world ?? '']?.short ?? ''}からの手紙` });
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
export function showReport(app: App, r: Report) {
  const any = r.arrivals || r.appraised || r.repaired || r.trips || r.research.length;
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
  for (const n of r.research) lines.push(['完了した研究', n]);
  sheet(app, close => [
    h('div', { class: 'receipt' }, h('h3', null, '留守中の記録'),
      ...lines.map(([k, v], i) => h('div', { class: 'ln', style: { animationDelay: `${0.25 + i * 0.06}s` } }, h('span', null, k), h('b', null, v))),
      !any ? h('p', { class: 'note', style: { textAlign: 'center' } }, '静かな留守番でした。') : null),
    h('button', { class: 'btn btn-primary btn-block', onclick: close }, '窓口を開ける')
  ], { title: '開館' });
}

// ---------- 閉館 ----------
export function showClosed(app: App) {
  const s = app.s;
  const now = Date.now();
  app.modalOpen++;
  const ss = s.session;
  const rec = A.recommendedOpen(s, now);
  const el = h('div', { class: 'closed', role: 'dialog', 'aria-modal': 'true' }, h('div', { class: 'inner' },
    h('div', { class: 'sign-wrap' }, h('div', { class: 'sign' }, h('div', { class: 'sign-board' }, '本日閉館'))),
    h('h2', null, '今回の成果'),
    h('div', { class: 'panel' },
      ...[['鑑定', `${ss.appraised}件（的中 ${ss.correct}）`], ['修理', `${ss.repaired}件`], ['派遣', `${ss.dispatched}人`], ['返却', `${ss.returned}件`], ['礼金', `+${num(ss.fee)}`], ['信用', `+${num(ss.credit)}`], ['手紙', `${ss.letters}通`]]
        .map(([k, v]) => h('div', { class: 'ln' }, h('span', null, k), h('b', null, v)))),
    h('h2', null, '留守中の予定'),
    h('div', { class: 'panel' }, ...A.timers(s).map(t => h('div', { class: 'ln' },
      h('span', { class: 'row', style: { gap: '8px' } }, t.color ? h('span', { class: 'wdot', style: { background: t.color } }) : null, t.label),
      h('b', null, clock(t.at, now))))),
    h('div', { class: 'rec' }, h('small', null, '次に開くおすすめ時刻'), h('div', { class: 't' }, clock(rec, now)), h('small', null, `いまから約${span(rec - now)}後`)),
    h('div', { class: 'btn-row mt16' },
      h('button', { class: 'btn btn-tag', onclick: () => done() }, '窓口に戻る'))));
  document.body.append(el);
  save(s);
  function done() {
    el.style.transition = 'opacity .25s'; el.style.opacity = '0';
    setTimeout(() => { el.remove(); app.modalOpen--; app.render(); }, 250);
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
  if (!next) return;
  sheet(app, close => [
    h('div', { class: 'receipt' }, h('h3', null, '移転届'),
      h('div', { class: 'ln' }, h('span', null, '移転先'), h('b', null, next.place)),
      h('div', { class: 'ln' }, h('span', null, '新しい世界'), h('b', null, WORLD[next.world].name)),
      h('div', { class: 'ln' }, h('span', null, '新しい仕組み'), h('b', null, next.mechanicName)),
      h('p', { class: 'note' }, next.mechanicDesc),
      h('div', { class: 'ln' }, h('span', null, '永続倍率'), h('b', null, `×${B.branchMult(s).toFixed(1)} → ×${(B.branchMult(s) + 0.5).toFixed(1)}`))),
    h('div', { class: 'card' },
      h('div', { class: 'card-t' }, '引き継ぐもの'), h('p', { class: 'note', style: { margin: '4px 0 10px' } }, '職員（Lv・特性）、図鑑、持ち主の手紙、落とし主の記録、開通した世界'),
      h('div', { class: 'card-t' }, '置いていくもの'), h('p', { class: 'note', style: { margin: '4px 0 0' } }, '礼金、信用、素材、倉庫の品物、施設のLv（職員が働ける分は残す）、研究（開通以外）')),
    h('div', { class: 'btn-row mt16' },
      h('button', { class: 'btn btn-ghost', onclick: close }, 'やめておく'),
      h('button', { class: 'btn btn-red', onclick: () => { close(); app.act(A.relocate); app.go('counter'); } }, '移転する'))
  ], { title: '支所の移転' });
}

// ---------- 設定 ----------
export function showSettings(app: App) {
  const s = app.s;
  const area = h('textarea', { class: 'field', readonly: true, 'aria-label': 'エクスポートした文字列' }) as HTMLTextAreaElement;
  const input = h('textarea', { class: 'field', placeholder: 'ここに書き出した文字列を貼り付け', 'aria-label': 'インポートする文字列' }) as HTMLTextAreaElement;
  const file = h('input', { type: 'file', accept: '.txt,.json,text/plain,application/json', style: { display: 'none' } }) as HTMLInputElement;
  file.addEventListener('change', async () => { const f = file.files?.[0]; if (f) input.value = await f.text(); });
  const sw = h('button', { class: ['switch', s.settings.reduceMotion && 'on'], 'aria-label': '動きを減らす', role: 'switch', 'aria-checked': String(s.settings.reduceMotion) });
  sw.addEventListener('click', () => {
    s.settings.reduceMotion = !s.settings.reduceMotion;
    sw.classList.toggle('on', s.settings.reduceMotion);
    sw.setAttribute('aria-checked', String(s.settings.reduceMotion));
    app.applySettings(); save(s);
  });
  sheet(app, close => [
    h('div', { class: 'card' }, h('div', { class: 'toggle' }, h('div', null, h('div', { class: 'card-t' }, '動きを減らす'), h('div', { class: 'card-s' }, 'アニメーションを最小限にします')), sw)),
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
          } catch (e) { app.toast(`読み込めませんでした：${(e as Error).message}`, 'ng'); }
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
