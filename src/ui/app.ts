// ===== 画面全体の制御：状態の保持、毎秒の更新、タブ、モーダル、トースト =====
import type { GameState, Report } from '../core/types';
import type { Tab, Result } from '../core/actions';
import * as A from '../core/actions';
import { advance, newReport, mysteryUnlocked } from '../core/engine';
import { load, save, catchUp, startSession } from '../core/save';
import { h, icon } from './dom';
import { I } from './icons';
import { num, dur } from './fmt';
import { renderCounter } from './screens/counter';
import { renderStorage } from './screens/storage';
import { renderStaff } from './screens/staff';
import { renderMap } from './screens/map';
import { renderCatalog } from './screens/catalog';
import { showReport, showClosed, showIntro, showSettings } from './modals';
import { RELOCATIONS } from '../core/data';
import { slide } from './components';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'counter', label: '窓口', icon: I.counter },
  { id: 'storage', label: '倉庫', icon: I.storage },
  { id: 'staff', label: '職員', icon: I.staff },
  { id: 'map', label: '地図', icon: I.map },
  { id: 'catalog', label: '図鑑', icon: I.catalog }
];
const SESSION_GAP = 5 * 60_000;

export class App {
  s: GameState;
  tab: Tab = 'counter';
  sub: Record<string, string> = { staff: 'staff', catalog: 'items' };
  seen = new Set<string>();
  prevIdx: Record<string, number> = {};
  root: HTMLElement;
  main!: HTMLElement;
  header!: HTMLElement;
  tabbar!: HTMLElement;
  toasts!: HTMLElement;
  sig = '';
  hiddenAt = 0;
  modalOpen = 0;
  shown = { fee: 0, credit: 0 };

  constructor(root: HTMLElement) {
    this.root = root;
    const now = Date.now();
    const { state, fresh } = load(now);
    this.s = state;
    this.shown = { fee: state.fee, credit: state.credit };
    this.build();
    if (fresh) {
      this.render();
      showIntro(this);
    } else {
      const r = catchUp(this.s, now);
      const away = now - r.from;
      startSession(this.s, now);
      this.render();
      if (away > SESSION_GAP) showReport(this, r);
    }
    this.applySettings();
    save(this.s);
    setInterval(() => this.tick(), 1000);
    setInterval(() => save(this.s), 5000);
    document.addEventListener('visibilitychange', () => this.onVisibility());
    window.addEventListener('pagehide', () => save(this.s));
  }

  applySettings() {
    document.documentElement.classList.toggle('reduce-motion', this.s.settings.reduceMotion);
  }

  // ---------- 骨組み ----------
  build() {
    this.header = h('header', { class: 'hdr' });
    this.main = h('main', { class: 'main', id: 'main' });
    this.tabbar = h('nav', { class: 'tabbar', 'aria-label': 'メインメニュー' });
    this.toasts = h('div', { class: 'toasts', 'aria-live': 'polite' });
    this.root.append(this.header, this.main, this.tabbar, this.toasts);
  }

  tabUnlocked(t: Tab): { ok: boolean; why: string } {
    const s = this.s;
    switch (t) {
      case 'staff': return { ok: s.totals.appraised > 0 || s.relocations > 0, why: '品物を1件鑑定すると開きます' };
      case 'map': return { ok: s.totals.trips > 0 || s.relocations > 0, why: '配達員を一度派遣すると開きます' };
      case 'catalog': return { ok: s.totals.returned > 0 || s.relocations > 0, why: '品物を1件返却すると開きます' };
      default: return { ok: true, why: '' };
    }
  }

  go(tab: Tab, anchor?: string) {
    const u = this.tabUnlocked(tab);
    if (!u.ok) { this.toast(u.why, 'ng'); return; }
    const changed = tab !== this.tab;
    this.tab = tab;
    if (anchor && tab === 'staff' && anchor === 'facilities') this.sub.staff = 'facilities';
    if (anchor && tab === 'catalog' && (anchor === 'letters' || anchor === 'mystery')) this.sub.catalog = anchor;
    this.render(changed);
    if (changed) this.main.scrollTo({ top: 0, behavior: 'auto' });
    if (anchor) requestAnimationFrame(() => {
      const el = this.main.querySelector(`#a-${anchor}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  // ---------- 描画 ----------
  render(animate = false) {
    this.renderHeader();
    this.renderTabs();
    const top = this.main.scrollTop;
    const screen = this.renderScreen();
    if (!animate) screen.style.animation = 'none';
    this.main.replaceChildren(screen);
    if (!animate) this.main.scrollTop = top;
    this.updateTimers();
    this.sig = this.signature();
  }

  renderScreen(): HTMLElement {
    switch (this.tab) {
      case 'storage': return renderStorage(this);
      case 'staff': return renderStaff(this);
      case 'map': return renderMap(this);
      case 'catalog': return renderCatalog(this);
      default: return renderCounter(this);
    }
  }

  renderHeader() {
    const s = this.s;
    const place = s.relocations ? RELOCATIONS[s.relocations - 1].place : '本所';
    const coin = (label: string, key: 'fee' | 'credit') =>
      h('div', { class: 'coin' }, h('span', { class: 'coin-label' }, label), h('span', { class: 'coin-val', 'data-coin': key }, num(this.shown[key])));
    this.header.replaceChildren(
      h('div', { class: 'hdr-top' },
        h('div', { class: 'brand' },
          h('div', { class: 'brand-title' }, '異世界遺失物センター'),
          h('div', { class: 'brand-sub' }, `${place}　第${s.relocations + 1}期`)),
        h('button', { class: 'icon-btn', 'aria-label': '設定', onclick: () => showSettings(this) }, icon(I.gear, 22))),
      h('div', { class: 'wallet' }, coin('礼金', 'fee'), coin('信用', 'credit'))
    );
    this.animateCoins();
  }

  /** 所持金の表示をなめらかに数え上げる */
  animateCoins() {
    for (const key of ['fee', 'credit'] as const) {
      const target = this.s[key];
      const from = this.shown[key];
      const el = this.header.querySelector<HTMLElement>(`[data-coin="${key}"]`);
      if (!el || Math.floor(from) === Math.floor(target)) { this.shown[key] = target; continue; }
      if (target > from) {
        el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
        el.addEventListener('animationend', () => el.classList.remove('bump'), { once: true });
      }
      const t0 = performance.now();
      const step = (t: number) => {
        const p = Math.min(1, (t - t0) / 700);
        const e = 1 - Math.pow(1 - p, 3);
        el.textContent = num(from + (target - from) * e);
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
      this.shown[key] = target;
    }
  }

  renderTabs() {
    const s = this.s;
    const dots: Partial<Record<Tab, boolean>> = {
      storage: s.items.some(i => i.stage === 'unknown' || i.stage === 'gate'),
      catalog: s.letters.some(l => !l.read) || s.mysterySeen < this.mysteryCount(),
      map: A.canRelocate(s)
    };
    const idx = TABS.findIndex(t => t.id === this.tab);
    const ind = slide(this, 'tab', idx, h('div', { class: 'tab-ind', style: { width: `calc((100% - 12px - var(--sal) - var(--sar)) / 5)`, left: 'calc(6px + var(--sal))' } }));
    this.tabbar.replaceChildren(ind, ...TABS.map(t => {
      const u = this.tabUnlocked(t.id);
      return h('button', {
        class: ['tab', t.id === this.tab && 'on', !u.ok && 'locked'],
        'aria-label': t.label, 'aria-current': t.id === this.tab ? 'page' : null,
        onclick: () => this.go(t.id)
      }, icon(u.ok ? t.icon : I.lock), t.label, dots[t.id] && u.ok && t.id !== this.tab ? h('span', { class: 'dot' }) : null);
    }));
  }

  mysteryCount() { return mysteryUnlocked(this.s); }

  /** 状態の要約。変わったときだけ画面を描き直す */
  signature(): string {
    const s = this.s;
    return [
      s.items.length, s.items.map(i => i.stage[0] + i.stage.length).join(''),
      Math.floor(s.fee), Math.floor(s.credit), s.letters.length,
      s.staff.map(x => (x.task ? x.task.kind[0] + x.task.end : '-') + x.lv).join(','),
      s.research.active?.id ?? '', s.gate.next, s.requests.length, s.relocations, this.tab
    ].join('|');
  }

  // ---------- 毎秒 ----------
  tick() {
    if (document.hidden) return;
    const now = Date.now();
    const r = newReport(now);
    advance(this.s, now, r);
    this.announce(r);
    if (this.signature() !== this.sig) {
      if (this.modalOpen === 0) this.render();
      else { this.renderHeader(); this.renderTabs(); }
    }
    this.updateTimers();
    this.maybeClose();
  }

  /** 開いている間に起きた出来事をトーストで知らせる */
  announce(r: Report) {
    if (r.trips) this.toast(`配達員が帰還　礼金 +${num(r.fee)}　信用 +${num(r.credit)}`, 'good');
    if (r.letters) this.toast(`持ち主から手紙が${r.letters}通届きました`, 'good');
    if (r.arrivals) this.toast(`ゲートに落とし物が${r.arrivals}件届きました`);
    for (const n of r.research) this.toast(`研究「${n}」が完了しました`, 'good');
  }

  updateTimers() {
    const now = Date.now();
    document.querySelectorAll<HTMLElement>('[data-end]').forEach(el => {
      const end = Number(el.dataset.end), start = Number(el.dataset.start ?? 0);
      if (el.classList.contains('pbar')) {
        const p = start ? Math.max(0, Math.min(1, (now - start) / (end - start))) : 0;
        const fill = el.firstElementChild as HTMLElement | null;
        if (fill) fill.style.width = `${(p * 100).toFixed(2)}%`;
      } else {
        el.textContent = dur(end - now);
      }
    });
    document.querySelectorAll<SVGElement>('[data-ring-end]').forEach(el => {
      const end = Number(el.dataset.ringEnd), start = Number(el.dataset.ringStart);
      const p = Math.max(0, Math.min(1, (now - start) / (end - start)));
      const len = Number(el.dataset.len);
      el.setAttribute('stroke-dashoffset', String(len * (1 - p)));
    });
    document.querySelectorAll<SVGGElement>('[data-trip-end]').forEach(el => {
      const end = Number(el.dataset.tripEnd), start = Number(el.dataset.tripStart);
      const p = Math.max(0, Math.min(1, (now - start) / (end - start)));
      const leg = p < .5 ? p * 2 : (1 - p) * 2;
      const x0 = Number(el.dataset.x0), y0 = Number(el.dataset.y0), x1 = Number(el.dataset.x1), y1 = Number(el.dataset.y1);
      el.setAttribute('transform', `translate(${x0 + (x1 - x0) * leg} ${y0 + (y1 - y0) * leg})`);
    });
  }

  maybeClose() {
    const s = this.s;
    // すぐ戻ってくる配達員がいるなら、閉館を勧めずに待つ
    const soon = s.staff.some(x => x.task?.kind === 'trip' && x.task.end - Date.now() < 15 * 60_000);
    if (this.modalOpen === 0 && s.session.acted && !s.session.closedShown && !soon && A.canClose(s)) {
      s.session.closedShown = true;
      showClosed(this);
    }
  }

  onVisibility() {
    const now = Date.now();
    if (document.hidden) { this.hiddenAt = now; save(this.s, now); return; }
    if (this.hiddenAt && now - this.hiddenAt > SESSION_GAP) {
      const r = catchUp(this.s, now);
      startSession(this.s, now);
      this.render();
      showReport(this, r);
    } else this.tick();
  }

  // ---------- 操作 ----------
  act(fn: (s: GameState, now: number) => Result, quiet = false): Result {
    const now = Date.now();
    advance(this.s, now);
    const r = fn(this.s, now);
    if (r.msg && (!quiet || !r.ok)) this.toast(r.msg, r.ok ? undefined : 'ng');
    save(this.s, now);
    if (this.modalOpen === 0) this.render();
    else { this.renderHeader(); this.renderTabs(); }
    return r;
  }

  toast(msg: string, kind?: 'ng' | 'good') {
    const el = h('div', { class: ['toast', kind] }, msg);
    this.toasts.append(el);
    while (this.toasts.children.length > 3) this.toasts.firstElementChild?.remove();
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, 2600);
  }

  /** 画面上の位置から数字を浮かび上がらせる */
  fly(from: Element | null, text: string, color?: string) {
    if (!from) return;
    const r = from.getBoundingClientRect();
    const el = h('div', { class: 'fly', style: { left: `${r.left + r.width / 2 - 20}px`, top: `${r.top}px`, ...(color ? { color } : {}) } }, text);
    document.body.append(el);
    setTimeout(() => el.remove(), 1300);
  }

  /** 初登場の要素にだけ入場アニメーションを付ける */
  fresh(key: string): boolean {
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    return true;
  }
}
