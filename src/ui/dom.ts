// 最小限のDOMヘルパー
type Child = Node | string | number | null | undefined | false | Child[];
type Props = Record<string, any> | null;

function apply(el: Element, props: Props) {
  if (!props) return;
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.setAttribute('class', Array.isArray(v) ? v.filter(Boolean).join(' ') : v);
    else if (k === 'style' && typeof v === 'object') for (const [sk, sv] of Object.entries(v)) (el as HTMLElement).style.setProperty(sk.startsWith('--') ? sk : sk.replace(/[A-Z]/g, c => '-' + c.toLowerCase()), String(sv));
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') (el as HTMLElement).innerHTML = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
}
function append(el: Element, children: Child[]) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : String(c));
  }
}
export function h(tag: string, props?: Props, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  apply(el, props ?? null);
  append(el, children);
  return el;
}
const NS = 'http://www.w3.org/2000/svg';
export function svg(tag: string, props?: Props, ...children: Child[]): SVGElement {
  const el = document.createElementNS(NS, tag);
  apply(el, props ?? null);
  append(el, children);
  return el as SVGElement;
}
export function icon(paths: string, size = 24): SVGElement {
  const el = svg('svg', { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
  el.innerHTML = paths;
  return el;
}
