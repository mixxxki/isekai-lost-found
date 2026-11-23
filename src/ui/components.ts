import type { ItemInst, GameState } from '../core/types';
import { ITEM, WORLD } from '../core/data';
import { RARITY_NAME } from '../core/balance';
import { h, svg } from './dom';
import { pad } from './fmt';
import type { App } from './app';

export const STAGE_LABEL: Record<ItemInst['stage'], string> = {
  gate: 'ゲート前', unknown: '未鑑定', qAppraise: '鑑定待ち', appraising: '鑑定中',
  damaged: '破損', qRepair: '修理待ち', repairing: '修理中', ready: '返却待ち', shipping: '配達中'
};

/** idから決まる小さな傾き（ピンで留めた荷札らしさ） */
export const tilt = (id: number, amp = 1.6) => `${(((id * 9301 + 49297) % 233280) / 233280 * 2 - 1) * amp}deg`;

export function pbar(start: number, end: number, cls = ''): HTMLElement {
  return h('div', { class: `pbar live ${cls}`, 'data-start': start, 'data-end': end }, h('i'));
}
export const countdown = (end: number) => h('span', { class: 'num', 'data-end': end }, '');

export function stringSvg(): SVGElement {
  // 荷札の穴から伸びる紐
  return svg('svg', { class: 'string', viewBox: '0 0 34 34', 'aria-hidden': 'true' },
    svg('path', { d: 'M22 23 C 14 18, 10 8, 2 0', stroke: '#8C6E46', 'stroke-width': 1.6, fill: 'none', 'stroke-linecap': 'round' }),
    svg('path', { d: 'M22 23 C 20 14, 22 6, 18 -2', stroke: '#8C6E46', 'stroke-width': 1.3, fill: 'none', 'stroke-linecap': 'round', opacity: .7 }));
}

export function isRequested(s: GameState, it: ItemInst) {
  return s.requests.some(q => !q.done && q.type === it.type && q.expiresAt > Date.now());
}

/** 荷札の形のカード */
export function tagCard(app: App, it: ItemInst, onclick?: () => void): HTMLElement {
  const def = ITEM[it.type];
  const known = it.verdict !== null;
  const w = WORLD[it.world];
  const task = app.s.staff.find(x => x.task && (x.task.kind === 'appraise' || x.task.kind === 'repair') && x.task.item === it.id)?.task;
  const el = h('button', {
    class: ['tag', !known && 'unknown', it.rarity === 1 && 'rar-1', it.rarity === 2 && 'rar-2', app.fresh('i' + it.id) && 'enter', task && 'busy'],
    style: { '--rot': tilt(it.id), ...(known ? { '--wc': w.color } : {}) },
    'aria-label': `${def.name}（${STAGE_LABEL[it.stage]}）`,
    onclick
  },
    stringSvg(),
    h('span', { class: 'hole' }),
    h('div', { class: 'tag-no' }, `No.${pad(it.id)}`),
    h('div', { class: 'tag-name' }, def.name),
    h('div', { class: 'tag-world' }, h('i'), known ? w.short : '出どころ不明'),
    h('div', { class: 'tag-foot' },
      h('span', { class: 'chip' }, STAGE_LABEL[it.stage]),
      it.rarity ? h('span', { class: 'chip red' }, RARITY_NAME[it.rarity]) : null,
      known && it.damaged && !it.repaired && it.stage !== 'damaged' ? h('span', { class: 'chip outline' }, '要修理') : null,
      isRequested(app.s, it) ? h('span', { class: 'chip green' }, '依頼品') : null,
      it.verdict === 'correct' ? h('span', { class: 'chip outline', style: { color: 'var(--red)' } }, '的中') : null
    ),
    task ? h('div', { class: 'mt8' }, pbar(task.start, task.end, 'pb-tag')) : null
  );
  return el;
}

export function worldDot(id: string) {
  return h('span', { class: 'wdot', style: { background: WORLD[id].color } });
}

export function emptyNote(text: string) { return h('div', { class: 'empty' }, text); }

export function section(title: string, aside: Node | string | null, ...body: (Node | null | false)[]): HTMLElement {
  return h('section', { class: 'sec' }, h('h2', { class: 'sec-h' }, title, aside ? h('span', { class: 'aside' }, aside) : null), ...body);
}

export function seg(app: App, key: string, opts: [string, string][]): HTMLElement {
  const cur = app.sub[key] ?? opts[0][0];
  const idx = Math.max(0, opts.findIndex(o => o[0] === cur));
  const ind = slide(app, 'seg-' + key, idx, h('div', { class: 'seg-ind', style: { width: `calc((100% - 8px) / ${opts.length})` } }));
  return h('div', { class: 'seg', role: 'tablist' },
    ind,
    ...opts.map(([id, label]) => h('button', {
      class: id === cur ? 'on' : '', role: 'tab', 'aria-selected': id === cur ? 'true' : 'false',
      onclick: () => { app.sub[key] = id; app.render(); }
    }, label)));
}

/** 前回の位置から今回の位置へ滑らせる（描き直しても動きが途切れないように） */
export function slide(app: App, key: string, idx: number, el: HTMLElement): HTMLElement {
  const prev = app.prevIdx[key] ?? idx;
  el.style.transform = `translateX(${prev * 100}%)`;
  app.prevIdx[key] = idx;
  if (prev !== idx) requestAnimationFrame(() => requestAnimationFrame(() => { el.style.transform = `translateX(${idx * 100}%)`; }));
  else el.style.transform = `translateX(${idx * 100}%)`;
  return el;
}
