// 窓口：次の一手・ゲート・配達状況・掲示板・日誌
import type { App } from '../app';
import * as A from '../../core/actions';
import * as B from '../../core/balance';
import { ITEM, WORLD } from '../../core/data';
import { storageUsed } from '../../core/engine';
import { h, svg, icon } from '../dom';
import { I } from '../icons';
import { clock, num } from '../fmt';
import { section, pbar, countdown, worldDot, tilt, ownerName } from '../components';
import { showClosed } from '../modals';

export function renderCounter(app: App): HTMLElement {
  const s = app.s;
  const now = Date.now();
  const root = h('div', { class: 'screen' });

  // ---- 次の一手 ----
  const adv = A.advice(s, now, 20).filter(a => app.tabUnlocked(a.tab).ok).slice(0, 3);
  const closable = A.canClose(s);
  root.append(section('次の一手', closable ? 'いまできることは済みました' : `${adv.length}件`,
    closable ? h('button', { class: 'close-card', onclick: () => showClosed(app) },
      h('span', { class: 'mini-sign' }, '閉館'),
      h('div', { class: 'grow' }, h('div', { style: { fontWeight: 700 } }, '窓口を閉める'), h('div', { style: { fontSize: '12px', opacity: .75 } }, '成果と、次に開くとよい時刻を確認する')),
      icon(I.arrow)) : null,
    adv.length ? h('div', { class: 'tickets' }, ...adv.map((a, i) =>
      h('button', { class: 'ticket', onclick: () => app.go(a.tab, a.anchor) },
        h('div', { class: 'ticket-no' }, h('b', null, String(i + 1)), h('small', null, a.sub)),
        h('div', { class: 'ticket-body' }, h('div', { class: 't' }, a.text)),
        h('div', { class: 'ticket-go' }, icon(I.arrow))))) :
      (!closable ? h('div', { class: 'empty' }, '今は待つ時間です。配達員の帰りと、次の便を待ちましょう。') : null)
  ));

  // ---- 転送ゲート ----
  const gateItems = s.items.filter(i => i.stage === 'gate');
  const start = s.gate.next - B.GATE_INTERVAL;
  const R = 42, len = 2 * Math.PI * R;
  const ring = svg('svg', { viewBox: '0 0 100 100', 'aria-hidden': 'true' },
    svg('circle', { cx: 50, cy: 50, r: 47, fill: 'none', stroke: '#1E2A28', 'stroke-opacity': .12, 'stroke-width': 1, 'stroke-dasharray': '2 4', class: 'spin2' }),
    svg('circle', { cx: 50, cy: 50, r: R, fill: '#FBF9F4', stroke: '#1E2A28', 'stroke-opacity': .1, 'stroke-width': 6 }),
    svg('circle', { cx: 50, cy: 50, r: R, fill: 'none', stroke: '#1F4D3F', 'stroke-width': 6, 'stroke-linecap': 'round', 'stroke-dasharray': len, 'stroke-dashoffset': len, transform: 'rotate(-90 50 50)', 'data-ring-start': start, 'data-ring-end': s.gate.next, 'data-len': len }),
    svg('circle', { cx: 50, cy: 50, r: 33, fill: 'none', stroke: '#E6CF9C', 'stroke-width': 2, 'stroke-dasharray': '6 5', class: 'spin' }));
  const room = B.storageCap(s) - storageUsed(s);
  root.append(section('転送ゲート', `Lv${s.facilities.gate}　1便 ${B.perDelivery(s)}件`,
    h('div', { class: 'card lift', id: 'a-gate' },
      h('div', { class: ['gate', gateItems.length > 0 && 'has'] },
        h('div', { class: 'gate-ring' }, ring, h('div', { class: 'count' }, h('div', null, String(gateItems.length), h('small', null, '到着済み')))),
        h('div', { class: 'grow' },
          h('div', { class: 'card-s' }, '次の便まで'),
          h('div', { class: 'num', style: { fontSize: '22px' } }, countdown(s.gate.next)),
          h('div', { class: 'card-s' }, `${clock(s.gate.next)} 着`),
          gateItems.length ? h('div', { class: 'gate-pile' }, ...gateItems.slice(0, 14).map((_, i) => h('i', { style: { animationDelay: `${i * 40}ms` } }))) : null)),
      gateItems.length ? h('div', { class: 'mt12' },
        h('button', { class: 'btn btn-primary btn-block', disabled: room <= 0, onclick: (e: Event) => { const r = app.act(A.collectAll); if (r.ok) app.fly(e.currentTarget as Element, '回収', '#1F4D3F'); } },
          icon(I.box, 20), room > 0 ? `回収する（${Math.min(room, gateItems.length)}件）` : '倉庫がいっぱい'),
        room < gateItems.length ? h('p', { class: 'note' }, `倉庫に入りきらない${gateItems.length - Math.max(0, room)}件はゲート前で待っています（消えません）。`) : null) : null)
  ));

  // ---- 処理能力（1日あたりの目安） ----
  if (s.totals.trips > 0) root.append(section('一日の処理能力', '目安', flowBars(app)));

  // ---- 配達・作業の様子 ----
  const busy = s.staff.filter(x => x.task);
  if (busy.length) {
    root.append(section('ただいまの業務', `${busy.length}人が作業中`,
      h('div', { class: 'card' }, ...busy.map(st => {
        const t = st.task!;
        const label = t.kind === 'trip' ? `${WORLD[t.world].short}へ配達（${t.items.length}件）${t.express ? '・速達' : ''}` :
          t.kind === 'appraise' ? `鑑定中：${ITEM[s.items.find(i => i.id === t.item)?.type ?? '']?.name ?? ''}` :
          `修理中：${ITEM[s.items.find(i => i.id === t.item)?.type ?? '']?.name ?? ''}`;
        return h('div', { style: { padding: '8px 0' } },
          h('div', { class: 'row' }, t.kind === 'trip' ? worldDot(t.world) : null, h('b', { style: { fontSize: '13.5px' } }, st.name),
            h('span', { class: 'grow', style: { fontSize: '12.5px', color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, label),
            h('span', { style: { fontSize: '12px' } }, countdown(t.end))),
          h('div', { class: 'mt8' }, pbar(t.start, t.end, t.kind === 'trip' ? '' : 'pb-tag')));
      }))));
  }

  // ---- 掲示板 ----
  if (s.totals.returned > 0) {
    const reqs = s.requests.filter(q => !q.done && q.expiresAt > now);
    root.append(section('探しています', `貼り出し枠 ${B.requestSlots(s)}`,
      h('div', { class: 'board', id: 'a-requests' },
        ...(reqs.length ? reqs.map(q => h('div', { class: 'poster', style: { '--rot': tilt(q.id, 2.2) } },
          h('h4', null, '探しています'),
          h('div', { class: 'pn' }, ITEM[q.type].name),
          h('div', { class: 'note', style: { textAlign: 'center', marginTop: '4px' } }, `${ownerName(q.owner, q.world)}（${WORLD[q.world].short}）`),
          h('div', { class: 'pf' }, h('span', null, `報酬×${B.REQUEST_MULT * (B.hasMechanic(s, 'bulletin') ? 1.5 : 1)}`), h('span', null, '残り', countdown(q.expiresAt))))) :
          [h('div', { class: 'board-empty' }, '貼り紙は次の便とともに届きます')])),
      h('p', { class: 'note' }, '依頼品を返却すると、礼金と信用が大きく上乗せされます。届いた品物には「依頼品」の印が付きます。')));
  }

  // ---- 本日の業務 ----
  const ss = s.session;
  root.append(section('本日の窓口', `開館 ${clock(ss.startedAt)}`,
    h('div', { class: 'card' }, h('dl', { class: 'kv' },
      h('dt', null, '鑑定'), h('dd', null, `${ss.appraised}件（的中 ${ss.correct}）`),
      h('dt', null, '修理'), h('dd', null, `${ss.repaired}件`),
      h('dt', null, '返却'), h('dd', null, `${ss.returned}件`),
      h('dt', null, '礼金'), h('dd', null, `+${num(ss.fee)}`),
      h('dt', null, '信用'), h('dd', null, `+${num(ss.credit)}`)))));

  // ---- 業務日誌 ----
  if (s.log.length) {
    root.append(section('業務日誌', null, h('ul', { class: 'log card' }, ...s.log.slice(0, 6).map(l => h('li', null, h('time', null, clock(l.at)), h('span', null, l.text))))));
  }
  return root;
}

/** 到着・鑑定・修理・配達を、1日に何件さばけるかで比べる */
function flowBars(app: App): HTMLElement {
  const s = app.s;
  const open = B.openWorlds(s);
  // 新しい世界ほど多く届くので、その重みで平均の世界を出す
  const wts = open.map((_, i) => 1 + i * 0.35);
  const sum = wts.reduce((a, b) => a + b, 0);
  const avg = (f: (w: string) => number) => open.reduce((a, w, i) => a + f(w) * wts[i], 0) / sum;
  const DAY = 24 * B.HOUR;
  const staff = (r: string) => s.staff.filter(x => x.role === r);
  const arrive = B.perDelivery(s) * 8;
  const appraise = staff('appraiser').reduce((a, st) => a + DAY / avg(w => B.appraiseTime(s, st, w)), 0);
  const dmg = avg(w => B.damageChance(w));
  const repair = staff('repairer').reduce((a, st) => a + DAY / avg(w => B.repairTime(s, st, w)), 0) / Math.max(0.05, dmg);
  const deliver = staff('courier').reduce((a, st) => a + B.courierCap(s, st) * DAY / avg(w => B.tripTime(s, st, w)), 0);
  const rows: [string, number, string][] = [
    ['到着', arrive, 'ゲートLv・研究'],
    ['鑑定', appraise, '鑑定士・鑑定室'],
    ['修理', repair, '修理工・工房'],
    ['配達', deliver, '配達員（出発させた場合）']
  ];
  const max = Math.max(...rows.map(r => r[1]));
  // 配達がたまっているなら、流量の比較より優先して配達を赤にする
  const short = A.courierShort(s);
  const low = short ? rows[3] : rows.slice(1).reduce((a, r) => (r[1] < a[1] ? r : a));
  const tight = !short && low[1] >= arrive && low[1] < arrive * 1.2;
  const mat = A.materialShort(s);
  return h('div', { class: 'card' },
    h('div', { class: 'flowbars' }, ...rows.map(([k, v]) => h('div', { class: ['flowbar', ((k === low[0] && (short || v < arrive)) || (k === '修理' && mat.length > 0)) && 'low'] },
      h('span', null, k), h('div', { class: 'pbar' }, h('i', { style: { width: `${Math.max(2, v / max * 100)}%` } })), h('span', { class: 'v' }, `${num(v)}件`)))),
    h('p', { class: 'note', style: { margin: '10px 0 0' } }, mat.length ? `修理の素材（${mat.map(w => WORLD[w].material).join('・')}）が足りません。その世界の品を返すと手に入ります。` : short ? '返却待ちがたまっています。配達員を雇うか、Lvを上げましょう。' : low[1] < arrive ? `いま一番詰まりやすいのは「${low[0]}」。強化するなら${low[2]}。` : tight ? `どの工程も届く量をさばけていますが、「${low[0]}」はぎりぎりです。` : '届く量より、どの工程も多くさばけています。ゲートを広げる余裕があります。'));
}
