// 図鑑：品物・手紙・「落とし主」の記録
import type { App } from '../app';
import * as B from '../../core/balance';
import { WORLDS, WORLD, ITEM, OWNER, ITEMS_BY_WORLD, OWNERS_BY_WORLD, LETTER_THRESHOLDS, MYSTERY } from '../../core/data';
import type { GameState, MysteryReq } from '../../core/types';
import { mysteryUnlocked } from '../../core/engine';
import { h, svg } from '../dom';
import { section, seg, worldDot } from '../components';
import { showCatalogItem, showLetter } from '../modals';

function envelope(): SVGElement {
  return svg('svg', { viewBox: '0 0 56 44', 'aria-hidden': 'true' },
    svg('path', { d: 'M3 6 L28 25 L53 6', fill: 'none', stroke: '#1E2A28', 'stroke-opacity': .3, 'stroke-width': 1.2 }));
}

export function renderCatalog(app: App): HTMLElement {
  const s = app.s;
  const root = h('div', { class: 'screen' });
  const unread = s.letters.filter(l => !l.read).length;
  const unlocked = mysteryUnlocked(s);
  const sub = app.sub.catalog ?? 'items';
  // 記録を開いたら、その場で「新」を消す（強調表示には開く前の値を使う）
  const prevSeen = s.mysterySeen;
  if (sub === 'mystery') s.mysterySeen = Math.max(s.mysterySeen, unlocked);
  root.append(seg(app, 'catalog', [['items', '品物'], ['letters', unread ? `手紙・${unread}` : '手紙'], ['mystery', unlocked > s.mysterySeen ? '記録・新' : '記録']]));
  const open = new Set(B.openWorlds(s));

  if (sub === 'items') {
    const total = Object.values(ITEMS_BY_WORLD).reduce((a, l) => a + l.length, 0);
    root.append(h('p', { class: 'note', style: { marginTop: 0 } }, `収集 ${Object.keys(s.catalog).length}/${total}種。世界ごとに5種集めるたびに礼金・信用+5%、全種そろうと+50%。${B.hasMechanic(s, 'archive') ? '（永久保存庫で効果2倍）' : ''}`));
    for (const w of WORLDS) {
      if (!open.has(w.id) && !ITEMS_BY_WORLD[w.id].some(i => s.catalog[i.id])) continue;
      const c = B.catalogWorld(s, w.id);
      root.append(section(w.name, `${c.got}/${c.total}`,
        h('div', { class: 'set-bonus', style: { marginBottom: '10px' } }, worldDot(w.id), ' セットボーナス ', h('b', null, `×${B.catalogBonus(s, w.id).toFixed(2)}`), c.complete ? '　全種収集' : ''),
        h('div', { class: 'cat-grid' }, ...ITEMS_BY_WORLD[w.id].map(it => {
          const e = s.catalog[it.id];
          if (!e) return h('div', { class: 'mini none', style: { '--wc': w.color }, 'aria-label': '未収集' }, '?');
          return h('button', { class: 'mini', style: { '--wc': w.color }, onclick: () => showCatalogItem(app, it.id) },
            it.name,
            h('span', { class: 'cnt' }, `×${e.n}${e.best ? (e.best === 2 ? ' 逸' : ' 珍') : ''}`),
            (e.r ?? 0) > 0 ? h('span', { class: 'stamp' }, '返却済') : null);
        }))));
    }
  } else if (sub === 'letters') {
    root.append(h('p', { class: 'note', style: { marginTop: 0 }, id: 'a-letters' }, `持ち主の品を返すたびに、手紙が届くことがあります（${LETTER_THRESHOLDS.join('・')}件目）。受け取った手紙 ${s.letters.length}通。`));
    const fresh = s.letters.filter(l => !l.read).sort((a, b) => a.at - b.at);
    if (fresh.length) root.append(section('新着', `${fresh.length}通`, h('div', { class: 'new-letters' }, ...fresh.slice(0, 12).map(l =>
      h('button', { class: 'new-letter', onclick: () => showLetter(app, l.owner, l.idx) },
        h('span', { class: 'seal-s' }, String(l.idx + 1)),
        h('div', { class: 'grow' }, h('div', { style: { fontWeight: 700, fontSize: '14px' } }, OWNER[l.owner]?.name ?? ''), h('div', { class: 'card-s' }, `${WORLD[l.world].short}から・${l.idx === 0 && l.type ? `${ITEM[l.type]?.name ?? ''}の礼状` : OWNER[l.owner]?.letterItems?.[l.idx] && l.type ? `${ITEM[l.type]?.name ?? ''}のこと（${l.idx + 1}通目）` : `便り（${l.idx + 1}通目）`}`)))))));
    for (const w of WORLDS) {
      if (!open.has(w.id)) continue;
      const owners = OWNERS_BY_WORLD[w.id];
      const met = owners.filter(o => (s.ownerReturns[o.id] ?? 0) > 0);
      const unmet = owners.length - met.length;
      root.append(section(w.name, `${s.letters.filter(l => l.world === w.id).length}/${owners.length * 3}通`, h('div', { class: 'card' },
        ...met.map(o => {
          const n = s.ownerReturns[o.id] ?? 0;
          return h('div', { class: 'owner' },
            h('div', { class: 'grow' },
              h('div', { style: { fontWeight: 700 } }, o.name, h('span', { class: 'muted num', style: { fontWeight: 400, fontSize: '11px', marginLeft: '8px' } }, `返却${n}件`)),
              h('div', { class: 'card-s' }, o.profile),
              h('div', { class: 'envs' }, ...[0, 1, 2].map(i => {
                const l = s.letters.find(x => x.owner === o.id && x.idx === i);
                if (!l) return h('div', { class: 'env locked', title: `あと${LETTER_THRESHOLDS[i] - n}件` }, `あと${Math.max(0, LETTER_THRESHOLDS[i] - n)}`);
                return h('button', { class: ['env', 'got', !l.read && 'unread'], 'aria-label': `${o.name}の手紙 ${i + 1}通目`, onclick: () => showLetter(app, o.id, i) }, envelope(), h('span', { style: { position: 'relative', marginTop: '14px' } }, `${i + 1}`));
              }))));
        }),
        unmet ? h('div', { class: met.length ? 'owner' : '' }, h('div', { class: 'card-s' }, `まだ品物を返していない持ち主が${unmet}人います。`)) : null)));
    }
  } else {
    root.append(section('落とし主の記録', `${unlocked}/${MYSTERY.length}頁`, h('div', { id: 'a-mystery', class: 'card' }, ...MYSTERY.map(m => {
      const got = m.id <= unlocked;
      return h('div', { class: ['myst', !got && 'locked', got && m.id > prevSeen && 'new'] },
        h('div', { class: 'myst-no' }, String(m.id)),
        h('div', { class: 'myst-t' }, got ? m.title : '――――'),
        h('div', { class: 'myst-b' }, got ? (m.text ?? '（この頁は、まだ綴じられていない。）') : m.id === unlocked + 1 ? h('span', { class: 'muted', style: { fontSize: '12.5px' } }, nextHint(s, m.req)) : null));
    }))));
  }
  return root;
}

/** 次の頁の手がかり（数字ではなく、窓口の言葉で） */
function nextHint(s: GameState, q: MysteryReq): string {
  if ((q.relocations ?? 0) > s.relocations) return '次の頁は、支所を移した先にあるらしい。';
  const need = (q.letters ?? 0) - s.letters.length;
  if (need > 0) return `持ち主たちの手紙が、あと${need}通ほど集まれば綴じられそうだ。`;
  if ((q.catalog ?? 0) > B.catalogRatio(s)) return '図鑑がもう少し埋まれば、何かがわかりそうだ。';
  if (q.lettersOf && !q.lettersOf.every(k => { const [o, i] = k.split(':'); return s.letters.some(l => l.owner === o && l.idx === Number(i)); })) return 'まだ届いていない便りが、どこかにあるらしい。';
  if (q.progress) return '今期の仕事がもう少し進めば、綴じられそうだ。';
  return 'もうすぐ綴じられる。';
}
