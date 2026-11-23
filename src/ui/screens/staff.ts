// 職員・施設
import type { App } from '../app';
import type { Role, FacilityId, Staff } from '../../core/types';
import * as A from '../../core/actions';
import * as B from '../../core/balance';
import { ROLES, trait, WORLD, ITEM } from '../../core/data';
import { h, icon } from '../dom';
import { I } from '../icons';
import { num, span } from '../fmt';
import { section, seg, pbar, countdown } from '../components';

const ROLE_ORDER: Role[] = ['appraiser', 'repairer', 'courier'];

function statLine(app: App, st: Staff): string {
  const s = app.s;
  if (st.role === 'appraiser') return `1件 約${span(B.appraiseTime(s, st))}`;
  if (st.role === 'repairer') return `1件 約${span(B.repairTime(s, st))}`;
  return `${B.courierCap(s, st)}件まで・${WORLD.w01.short}往復 約${span(B.tripTime(s, st, 'w01'))}`;
}

function taskLine(app: App, st: Staff): HTMLElement {
  const t = st.task;
  if (!t) return h('div', { class: 'staff-task muted' }, '手が空いています');
  const label = t.kind === 'trip' ? `${WORLD[t.world].name}へ配達中（${t.items.length}件）` :
    `${t.kind === 'appraise' ? '鑑定' : '修理'}中：${ITEM[app.s.items.find(i => i.id === t.item)?.type ?? '']?.name ?? ''}`;
  return h('div', { class: 'staff-task' }, h('div', { class: 'row' }, h('span', { class: 'grow' }, label), countdown(t.end)), pbar(t.start, t.end, t.kind === 'trip' ? '' : 'pb-tag'));
}

function staffCard(app: App, st: Staff): HTMLElement {
  const tr = trait(st.role, st.trait);
  const cost = B.levelCost(st);
  return h('div', { class: 'card lift' },
    h('div', { class: 'staff' },
      h('div', { class: ['badge', app.fresh(`lv${st.id}-${st.lv}`) && st.lv > 1 && 'lvup'] }, h('small', null, 'Lv'), h('b', null, String(st.lv))),
      h('div', null,
        h('div', { class: 'staff-name' }, st.name, h('span', { class: 'chip' }, ROLES[st.role].name), h('span', { class: 'chip outline', title: tr.desc }, tr.name)),
        h('div', { class: 'staff-stat' }, `${tr.desc}　／　${statLine(app, st)}`),
        taskLine(app, st),
        h('button', { class: 'btn btn-ghost btn-sm mt12', disabled: app.s.fee < cost, onclick: () => app.act(s => A.levelUp(s, st.id)) }, `Lv${st.lv + 1}へ`, h('span', { class: 'cost' }, `礼金 ${num(cost)}`)))));
}

export function renderStaff(app: App): HTMLElement {
  const s = app.s;
  const root = h('div', { class: 'screen' });
  root.append(seg(app, 'staff', [['staff', '職員'], ['facilities', '施設']]));

  if ((app.sub.staff ?? 'staff') === 'staff') {
    for (const role of ROLE_ORDER) {
      const list = s.staff.filter(x => x.role === role);
      const max = B.maxStaff(s, role);
      const cost = B.hireCost(s, role);
      const canHire = list.length < max;
      root.append(section(ROLES[role].name, `${list.length}/${max}人`,
        h('p', { class: 'note', style: { marginTop: 0 } }, ROLES[role].desc),
        ...list.map(st => staffCard(app, st)),
        h('div', { class: 'mt12' }, canHire ?
          h('div', { class: 'card cand' },
            h('div', { class: 'card-s', style: { marginBottom: '8px' } }, `採用候補（礼金 ${num(cost)}）`),
            ...s.candidates[role].map((c, i) => {
              const tr = trait(role, c.trait);
              return h('div', { class: 'row', style: { padding: '6px 0' } },
                h('div', { class: 'grow' }, h('b', null, c.name), ' ', h('span', { class: 'chip outline' }, tr.name), h('div', { class: 'card-s' }, tr.desc)),
                h('button', { class: 'btn btn-primary btn-sm', disabled: s.fee < cost, onclick: () => app.act((st, now) => A.hire(st, role, i, now)) }, '採用'));
            })) :
          h('p', { class: 'note' }, `これ以上雇うには${role === 'appraiser' ? '鑑定室' : role === 'repairer' ? '工房' : '転送ゲート'}を拡張してください。`))));
    }
  } else {
    const facs: FacilityId[] = ['gate', 'storage', 'appraisal', 'workshop'];
    const ill: Record<FacilityId, string> = { gate: I.gate, storage: I.storage, appraisal: I.loupe, workshop: I.wrench };
    const effect = (f: FacilityId, lv: number): string => {
      const t = { ...s, facilities: { ...s.facilities, [f]: lv } };
      if (f === 'gate') return `1便 ${B.perDelivery(t)}件・配達員 ${B.maxStaff(t, 'courier')}人まで`;
      if (f === 'storage') return `珍品率 ${(B.rareChance(t)[0] * 100).toFixed(1)}%・貼り紙 ${B.requestSlots(t)}枚`;
      if (f === 'appraisal') return `鑑定士 ${lv}人まで・速さ +${(lv - 1) * 5}%`;
      return `修理工 ${lv}人まで・速さ +${(lv - 1) * 5}%`;
    };
    root.append(section('施設', null, h('div', { id: 'a-facilities' }, ...facs.map(f => {
      const lv = s.facilities[f], def = B.FACILITY[f], max = lv >= def.max, cost = B.facilityCost(f, lv);
      return h('div', { class: 'card lift' },
        h('div', { class: 'card-h' },
          h('div', { class: 'fac-ill' }, icon(ill[f], 28)),
          h('div', { class: 'grow' },
            h('div', { class: 'card-t' }, def.name, ' ', h('span', { class: 'num', style: { fontWeight: 400, fontSize: '13px', color: 'var(--ink-3)' } }, `Lv${lv}`)),
            h('div', { class: 'card-s' }, def.desc),
            h('div', { class: 'lv-pips' }, ...Array.from({ length: Math.min(def.max, 30) }, (_, i) => h('i', { class: i < lv ? 'on' : '' }))))),
        h('div', { class: 'mt12', style: { fontSize: '12.5px' } },
          h('div', null, h('span', { class: 'muted' }, '現在　'), effect(f, lv)),
          !max ? h('div', null, h('span', { class: 'muted' }, '拡張後　'), effect(f, lv + 1)) : null),
        h('button', { class: 'btn btn-primary btn-block mt12', disabled: max || s.fee < cost, onclick: () => app.act(st => A.upgrade(st, f)) },
          max ? '最大まで拡張済み' : '拡張する', !max ? h('span', { class: 'cost' }, `礼金 ${num(cost)}`) : null));
    }))));
  }
  return root;
}
