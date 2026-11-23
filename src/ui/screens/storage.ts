// 倉庫：回収・鑑定・修理・返却の段取り
import type { App } from '../app';
import type { ItemInst } from '../../core/types';
import * as A from '../../core/actions';
import * as B from '../../core/balance';
import { WORLD, ITEM } from '../../core/data';
import { expressCost } from '../../core/engine';
import { num } from '../fmt';
import { storageUsed } from '../../core/engine';
import { h, icon } from '../dom';
import { I } from '../icons';
import { span } from '../fmt';
import { section, tagCard, emptyNote, worldDot } from '../components';
import { showGuess, showItem } from '../modals';

export function renderStorage(app: App): HTMLElement {
  const s = app.s;
  const root = h('div', { class: 'screen' });
  const by = (st: ItemInst['stage'][]) => s.items.filter(i => st.includes(i.stage));
  const used = storageUsed(s), cap = B.storageCap(s);

  root.append(h('div', { class: 'card', style: { marginBottom: '22px' } },
    h('div', { class: 'cap' }, icon(I.storage, 20), h('span', null, '倉庫'),
      h('div', { class: 'pbar lg' }, h('i', { style: { width: `${Math.min(100, used / cap * 100)}%`, background: used >= cap ? 'var(--red)' : '' } })),
      h('span', { class: 'num' }, `${used}/${cap}`)),
    h('p', { class: 'note', style: { margin: '6px 0 0' } }, `上限はゲート24時間分（1便${B.perDelivery(s)}件×8便）。ゲートを広げると上限も増えます。`)));

  // ゲート前
  const gate = by(['gate']);
  if (gate.length) {
    root.append(section('ゲート前', `${gate.length}件`,
      h('div', { id: 'a-gate' },
        h('button', { class: 'btn btn-primary btn-block', disabled: used >= cap, onclick: () => app.act(A.collectAll) }, icon(I.box, 20), used >= cap ? '倉庫がいっぱい' : `倉庫へ回収する（${Math.min(cap - used, gate.length)}件）`))));
  }

  // 未鑑定
  const unknown = by(['unknown']);
  root.append(section('未鑑定', `${unknown.length}件`,
    h('div', { id: 'a-unknown' },
      unknown.length ? h('div', null,
        h('p', { class: 'note', style: { marginTop: 0 } }, '札をタップして出どころを当てると礼金×2。まとめて鑑定士に任せることもできます（1件約3分）。'),
        h('div', { class: 'btn-row', style: { marginBottom: '14px' } },
          h('button', { class: 'btn btn-tag', onclick: () => showGuess(app, unknown[0].id) }, icon(I.loupe, 20), '順に鑑定する'),
          h('button', { class: 'btn btn-ghost', onclick: () => app.act(A.delegateAll) }, 'すべて任せる')),
        tagList(app, 'unknown', unknown, it => showGuess(app, it.id))) :
        emptyNote(gate.length ? (used >= cap ? '倉庫がいっぱいです。返却待ちを配達に出して、空きを作りましょう' : 'まずはゲート前の品物を回収しましょう') : (B.rlv(s, 'auto_assign') > 0 && s.settings.autoAssign ? '回収した品は鑑定士に回っています（珍品と依頼品は手元に残ります）' : '未鑑定の品物はありません')))));

  // 鑑定中
  const appr = by(['qAppraise', 'appraising']);
  if (appr.length) {
    const n = s.staff.filter(x => x.role === 'appraiser').length;
    root.append(section('鑑定士に任せた品', `${appr.length}件・鑑定士${n}人`,
      tagList(app, 'appr', appr, it => showItem(app, it.id))));
  }

  // 破損
  const dmg = by(['damaged']);
  const rep = by(['qRepair', 'repairing']);
  if (dmg.length || rep.length) {
    root.append(section('修理', `破損${dmg.length}件・工房${rep.length}件`,
      h('div', { id: 'a-damaged' },
        dmg.length ? h('div', null,
          h('div', { class: 'dispatch' }, '素材：', ...[...new Set(dmg.map(i => i.world))].map(w =>
            h('span', { class: 'row', style: { gap: '4px' } }, worldDot(w), `${WORLD[w].material} ${Math.floor(s.materials[w] ?? 0)}（1件に${B.repairMaterials(s, w)}）`))),
          h('button', { class: 'btn btn-primary btn-block', style: { marginBottom: '14px' }, onclick: () => app.act(A.repairAll) }, icon(I.wrench, 20), '工房へ回す')) : null,
        tagList(app, 'dmg', [...dmg, ...rep], it => showItem(app, it.id)))));
  }

  // 返却待ち
  const ready = by(['ready']);
  const idle = A.idleCouriers(s);
  root.append(section('返却待ち', `${ready.length}件・手の空いた配達員${idle.length}人`,
    h('div', { id: 'a-ready' }, ready.length ? h('div', null, ...[...new Set(ready.map(i => i.world))].sort((a, b) => ready.filter(i => i.world === b).length - ready.filter(i => i.world === a).length).map(w => {
      const list = ready.filter(i => i.world === w);
      const c = idle[0];
      const express = B.hasMechanic(s, 'express');
      const trainee = s.totals.trips < 3 && s.relocations === 0;
      return h('div', { class: 'group' },
        h('div', { class: 'group-h' }, worldDot(w), WORLD[w].name, h('span', { class: 'muted', style: { fontWeight: 400, fontSize: '12px' } }, `${list.length}件`)),
        h('div', { class: 'dispatch' },
          c ? h('span', { class: 'grow' }, `${c.name}（${B.courierCap(s, c)}件まで）・往復 約${span(trainee ? B.FIRST_TRIP : B.tripTime(s, c, w))}`, trainee ? h('span', { class: 'chip', style: { marginLeft: '6px' } }, `研修便 残り${3 - s.totals.trips}回`) : null) : h('span', { class: 'grow' }, '配達員は全員出発しています'),
          h('button', { class: 'btn btn-primary btn-sm', disabled: !c, onclick: (e: Event) => { const el = e.currentTarget as Element; const r = app.act((st, now) => A.send(st, w, now)); if (r.ok) app.fly(el, '出発', '#1F4D3F'); } }, '配達に出す'),
          express && c && !trainee ? h('button', { class: 'btn btn-red btn-sm', onclick: () => app.act((st, now) => A.send(st, w, now, true)) }, '速達', h('span', { class: 'cost' }, num(expressCost(s, list.slice(0, B.courierCap(s, c)))))) : null),
        tagList(app, 'ready-' + w, list, it => showItem(app, it.id)));
    })) : emptyNote('返却を待っている品物はありません'))));

  // 配達中
  const ship = by(['shipping']);
  if (ship.length) {
    root.append(section('配達中', `${ship.length}件`, h('div', { class: 'card' }, ...s.staff.filter(x => x.task?.kind === 'trip').map(st => {
      const t = st.task as Extract<NonNullable<typeof st.task>, { kind: 'trip' }>;
      return h('div', { class: 'row', style: { padding: '6px 0', fontSize: '13px' } }, worldDot(t.world), h('b', null, st.name),
        h('span', { class: 'grow muted', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, t.items.map(id => ITEM[s.items.find(i => i.id === id)?.type ?? '']?.name).filter(Boolean).join('、')));
    }))));
  }
  return root;
}

/** 荷札の一覧。多いときは24件ずつ折りたたむ（長い倉庫でも重くならないように） */
function tagList(app: App, key: string, list: ItemInst[], onTap: (it: ItemInst) => void): HTMLElement {
  const limit = Number(app.sub['more-' + key] ?? 24);
  const shown = list.slice(0, limit);
  return h('div', null,
    h('div', { class: 'tags' }, ...shown.map(it => tagCard(app, it, () => onTap(it)))),
    list.length > limit ? h('button', { class: 'btn btn-ghost more', onclick: () => { app.sub['more-' + key] = String(limit + 48); app.render(); } }, `残り${list.length - limit}件を表示`) : null);
}
