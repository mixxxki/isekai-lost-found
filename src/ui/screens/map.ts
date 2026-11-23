// 地図：世界とゲートの線、研究、支所の移転
import type { App } from '../app';
import * as A from '../../core/actions';
import * as B from '../../core/balance';
import { WORLDS, WORLD, MAP, RESEARCH_BY_ID, RELOCATIONS } from '../../core/data';
import { h, svg, icon } from '../dom';
import { I } from '../icons';
import { num, span } from '../fmt';
import { section, pbar, countdown } from '../components';
import { showWorld, showRelocate } from '../modals';

const Y = (y: number) => 40 + (y - 40) * 0.74;
const pos = (id: string) => id === 'center' ? { x: MAP.center.x, y: Y(MAP.center.y) } : { x: WORLD[id].x, y: Y(WORLD[id].y) };

export function renderMap(app: App): HTMLElement {
  const s = app.s;
  const root = h('div', { class: 'screen' });
  const open = new Set(B.openWorlds(s));
  const isOpen = (id: string) => id === 'center' || open.has(id);

  const H = Y(790);
  const m = svg('svg', { class: 'map', viewBox: `0 0 360 ${H}`, role: 'group', 'aria-label': '世界の地図' });
  // 線
  for (const [a, b] of MAP.links) {
    const p = pos(a), q = pos(b);
    const o = isOpen(a) && isOpen(b);
    m.append(svg('line', { x1: p.x, y1: p.y, x2: q.x, y2: q.y, class: `link ${o ? 'open' : 'closed'}` }));
  }
  // センター
  const c = pos('center');
  m.append(svg('g', { class: 'center', transform: `translate(${c.x} ${c.y})` },
    svg('rect', { x: -56, y: -16, width: 112, height: 32, rx: 8 }),
    svg('text', { x: 0, y: 4, 'text-anchor': 'middle' }, 'センター')));
  // 世界
  for (const w of WORLDS) {
    const p = pos(w.id);
    const o = open.has(w.id);
    const g = svg('g', { class: 'node', transform: `translate(${p.x} ${p.y})`, role: 'button', 'aria-label': o ? w.name : '未開通の世界', tabindex: 0 });
    if (o) {
      const busy = s.staff.some(x => x.task?.kind === 'trip' && x.task.world === w.id);
      if (busy) g.append(svg('circle', { r: 22, class: 'halo', stroke: w.color }));
      g.append(
        svg('circle', { r: 32, fill: 'transparent' }),
        svg('circle', { class: 'base', r: 20, fill: w.color, stroke: '#FBF9F4', 'stroke-width': 3, style: 'filter: drop-shadow(0 3px 3px rgba(30,42,40,.35))' }),
        svg('circle', { r: 6, fill: '#FBF9F4', opacity: .9 }),
        svg('text', { y: 36, 'text-anchor': 'middle' }, w.short));
      onActivate(g, () => showWorld(app, w.id));
    } else {
      g.append(
        svg('circle', { r: 32, fill: 'transparent' }),
        svg('circle', { class: 'base', r: 18, fill: '#F3EFE6', stroke: '#7D8683', 'stroke-width': 1.5, 'stroke-dasharray': '4 4' }),
        svg('text', { class: 'q', y: 6, 'text-anchor': 'middle' }, '?'),
        svg('text', { y: 34, 'text-anchor': 'middle', style: 'fill: #5F6966; font-weight: 400; font-size: 11px' }, '未開通'));
      onActivate(g, () => app.toast('まだゲートの線が届いていません。研究か移転で開通します。'));
    }
    m.append(g);
  }
  // 移動中の配達員（行きと帰りで往復）
  for (const st of s.staff) {
    if (st.task?.kind !== 'trip') continue;
    const p = pos('center'), q = pos(st.task.world);
    m.append(svg('g', { class: 'courier', 'data-trip-start': st.task.start, 'data-trip-end': st.task.end, 'data-x0': p.x, 'data-y0': p.y + 16, 'data-x1': q.x, 'data-y1': q.y, transform: `translate(${p.x} ${p.y})` },
      svg('rect', { x: -6, y: -8, width: 12, height: 15, rx: 2, transform: 'rotate(-8)' }),
      svg('circle', { cx: -1.5, cy: -4, r: 1.6, fill: '#1E2A28' })));
  }
  root.append(section('地図', `開通 ${open.size}/${WORLDS.length}`, h('div', { class: 'map-wrap' }, m),
    h('p', { class: 'note' }, '世界をタップすると詳しい情報を表示します。破線の先は、まだゲートが通じていない世界です。')));

  // 研究
  const act = s.research.active;
  const list = A.researchList(s);
  const queue = s.research.queue;
  const nx = queue.length >= A.RESEARCH_QUEUE;
  const rush = act ? A.rushCost(s) : 0;
  root.append(section('研究', act ? `進行中・予約 ${queue.length}/${A.RESEARCH_QUEUE}` : `${list.length}件 着手可能`, h('div', { id: 'a-research' },
    act ? h('div', { class: 'card research active' },
      h('div', { class: 'row' }, icon(I.flask, 20), h('b', { class: 'grow' }, RESEARCH_BY_ID[act.id].name, RESEARCH_BY_ID[act.id].max > 1 ? `　Lv${B.rlv(s, act.id) + 1}` : ''), countdown(act.end)),
      h('div', { class: 'mt8' }, pbar(act.start, act.end)),
      h('div', { class: 'row mt8' }, h('span', { class: 'card-s grow' }, '余った信用で、今すぐ終える'),
        h('button', { class: 'btn btn-ghost btn-sm', disabled: s.credit < rush, onclick: () => app.act(A.rushResearch) }, '早める', h('span', { class: 'cost' }, `信用 ${num(rush)}`))),
      ...queue.map((q, i) => h('div', { class: 'row mt8' }, h('span', { class: 'card-s grow' }, `予約${i + 1}：${RESEARCH_BY_ID[q].name}`),
        i === queue.length - 1 ? h('button', { class: 'btn btn-ghost btn-sm', onclick: () => app.act(A.cancelReservation) }, '取消') : null))) : null,
    ...list.map(r => {
      const cost = A.researchCostFor(s, r.id);
      const lv = B.rlv(s, r.id);
      const same = act?.id === r.id;
      const reserved = queue.includes(r.id);
      return h('div', { class: ['card', 'research', 'mt8', reserved && 'active'] },
        h('div', { class: 'row' },
          h('div', { class: 'grow' },
            h('div', { class: 'card-t' }, r.name, r.max > 1 ? h('span', { class: 'lv' }, `　${lv}/${B.researchMax(s, r.id)}`) : null, reserved ? h('span', { class: 'chip green', style: { marginLeft: '8px' } }, '予約済み') : same ? h('span', { class: 'chip', style: { marginLeft: '8px' } }, `進行中・次はLv${lv + 2}`) : null),
            h('div', { class: 'card-s' }, r.desc, r.keep ? '（移転しても残る）' : ''),
            r.kind === 'level' && lv > 0 ? h('div', { class: 'card-s', style: { color: 'var(--green)', fontWeight: 700 } }, `現在の合計：${effectNow(r.stat!, (r.per ?? 0) * lv)}`) : null),
        ),
        h('div', { class: 'row mt8' },
          h('span', { class: 'card-s grow' }, `所要 ${span(A.researchTimeFor(s, r.id))}`),
          h('button', { class: 'btn btn-primary btn-sm', disabled: (!!act && !!nx) || reserved || s.credit < cost, onclick: () => app.act((st, now) => A.startResearch(st, r.id, now)) }, act ? '予約' : '着手', h('span', { class: 'cost' }, `信用 ${num(cost)}`))));
    }),
    !list.length && !act ? h('div', { class: 'empty' }, '今は着手できる研究がありません。返却を重ねると増えていきます。') : null)));

  // 移転
  const next = RELOCATIONS[s.relocations];
  {
    const need = B.relocateAt(s.relocations);
    const p = Math.min(1, s.branchCredit / need);
    root.append(section('支所の移転', `第${s.relocations + 1}期`, h('div', { class: 'card lift', id: 'a-relocate' },
      h('div', { class: 'card-t' }, `次の移転先：${A.nextPlace(s.relocations)}`),
      h('div', { class: 'card-s' }, next ? `新しい世界「${WORLD[next.world].name}」と、仕組み「${next.mechanicName}」が加わります。` : 'ここから先は、永続倍率を積み上げるための移転です。'),
      h('div', { class: 'cap mt12' }, h('div', { class: 'pbar lg' }, h('i', { style: { width: `${p * 100}%` } })), h('span', { class: 'num' }, `${num(s.branchCredit)}/${num(need)}`)),
      h('p', { class: 'note' }, A.canRelocate(s) ? `移転できます。移転すると、礼金と信用にずっと掛かる倍率が ×${(1 + s.perm).toFixed(2)} から ×${(1 + s.perm + B.relocateGain(s)).toFixed(2)} になります（目標を超えて貯めるほど少し増えます）。` : 'この期に受け取った信用の合計が目標に届いたら、移転できます。'),
      h('div', { class: 'keep-grid' },
        h('div', null, h('b', null, '残るもの'), h('p', null, '職員とそのLv、図鑑、手紙、落とし主の記録、開通した世界、自動化の規程、段階式の研究の半分')),
        h('div', null, h('b', null, 'なくなるもの'), h('p', null, '礼金、信用、素材、倉庫の品物、施設のLv（職員が働ける分は残る）'))),
      h('button', { class: ['btn', 'btn-block', A.canRelocate(s) ? 'btn-red' : 'btn-ghost'], disabled: !A.canRelocate(s), onclick: () => showRelocate(app) }, A.canRelocate(s) ? '移転の手続きへ' : `あと 信用 ${num(Math.max(0, need - s.branchCredit))}`))));
  }
  root.append(h('div', { class: 'card' }, h('dl', { class: 'kv' },
    h('dt', null, '永続倍率'), h('dd', null, `×${B.branchMult(s).toFixed(2)}`),
    h('dt', null, '　移転の加算'), h('dd', null, `×${(1 + s.perm).toFixed(2)}（${s.relocations}回）`),
    h('dt', null, '　職員の熟練'), h('dd', null, `×${B.staffMult(s).toFixed(2)}`),
    h('dt', null, '　図鑑の収集'), h('dd', null, `×${B.archiveMult(s).toFixed(2)}`))));
  return root;
}

function effectNow(stat: string, v: number): string {
  const pct = `+${Math.round(v * 100)}%`;
  return ({ fee: `礼金 ${pct}`, credit: `信用 ${pct}`, appraise: `鑑定の速さ ${pct}`, repair: `修理の速さ ${pct}`, travel: `所要時間 -${Math.round(v * 100)}%`, material: `素材 ${pct}`, rare: `珍品率 ${pct}`, arrival: `届く量 ${pct}` } as Record<string, string>)[stat] ?? pct;
}

/** タップでも Enter / Space でも同じ動作 */
function onActivate(el: Element, fn: () => void) {
  el.addEventListener('click', fn);
  el.addEventListener('keydown', e => { const k = (e as KeyboardEvent).key; if (k === 'Enter' || k === ' ') { e.preventDefault(); fn(); } });
}
