import worldsJson from '../data/worlds.json';
import itemsJson from '../data/items.json';
import ownersJson from '../data/owners.json';
import mysteryJson from '../data/mystery.json';
import researchJson from '../data/research.json';
import staffJson from '../data/staff.json';
import relocJson from '../data/relocations.json';
import mapJson from '../data/map.json';
import type { WorldDef, ItemDef, OwnerDef, MysteryDef, ResearchDef, TraitDef, RelocationDef, Role } from './types';

export const WORLDS: WorldDef[] = worldsJson as WorldDef[];
export const WORLD: Record<string, WorldDef> = Object.fromEntries(WORLDS.map(w => [w.id, w]));
export const MAP = mapJson as { center: { x: number; y: number; name: string }; links: [string, string][] };
export const MYSTERY: MysteryDef[] = mysteryJson as MysteryDef[];
export const RESEARCH: ResearchDef[] = researchJson as ResearchDef[];
export const RESEARCH_BY_ID: Record<string, ResearchDef> = Object.fromEntries(RESEARCH.map(r => [r.id, r]));
export const RELOCATIONS: RelocationDef[] = relocJson as RelocationDef[];
export const ROLES = staffJson.roles as Record<Role, { name: string; desc: string }>;
export const STAFF_NAMES: string[] = staffJson.names;
export const TRAITS = staffJson.traits as Record<Role, TraitDef[]>;
export function trait(role: Role, id: string): TraitDef {
  return TRAITS[role].find(t => t.id === id) ?? TRAITS[role][TRAITS[role].length - 1];
}

// ---- 品物：データが無い世界には仮の品物を用意する ----
const GENERIC_ITEMS = [
  { n: '{m}の欠片', d: '{m}のかけら。光に透かすと、{s}の景色が少しだけ映る。', c: ['{m}でできている', '{s}の消印'] },
  { n: '{s}の合鍵', d: 'どの扉の鍵なのか、{s}の住人にしかわからない。', c: ['{m}の粉が付いている', '鍵穴の形が見慣れない'] },
  { n: '{s}からの封筒', d: '宛名のない封筒。封を開けると、{s}の匂いがする。', c: ['{s}の消印', '紙に{m}が漉き込まれている'] },
  { n: '{s}の帽子', d: '被ると、少しだけ{s}の時刻になる帽子。', c: ['裏地に{m}', '{s}の仕立て'] },
  { n: '{s}の小箱', d: '振ると音がするが、開けても何も入っていない。', c: ['{m}の留め金', '底に{s}の刻印'] },
  { n: '{s}の地図', d: '{s}のどこかを描いた地図。センターに来てから、描線が少し動いた。', c: ['{s}の地名', '{m}の染み'] }
];
const fill = (s: string, w: WorldDef) => s.replaceAll('{m}', w.material).replaceAll('{s}', w.short);

export const ITEMS: ItemDef[] = [...(itemsJson as ItemDef[])];
for (const w of WORLDS) {
  if (!ITEMS.some(i => i.world === w.id)) {
    GENERIC_ITEMS.forEach((g, k) => ITEMS.push({
      id: `g${w.id}_${k}`, world: w.id, name: fill(g.n, w), desc: fill(g.d, w), clues: g.c.map(c => fill(c, w)), generic: true
    }));
  }
}
export const ITEM: Record<string, ItemDef> = Object.fromEntries(ITEMS.map(i => [i.id, i]));
export const ITEMS_BY_WORLD: Record<string, ItemDef[]> = {};
for (const i of ITEMS) (ITEMS_BY_WORLD[i.world] ??= []).push(i);

// ---- 持ち主：データが無い世界には仮の持ち主と定型の手紙 ----
const NUMS = ['一', '二', '三', '四', '五', '六', '七', '八'];
const GENERIC_LETTERS = [
  '{item}、たしかに受け取りました。こちらでは、戻ってきた物はしばらく机の上に置いておく習わしです。ここにあることに、物のほうが慣れるまで。',
  'また一つ届きました。荷札の結び目が、前のものと同じでした。結んだのがどなたか、そちらではご存じですか。',
  'これで手元の失くし物は、ぜんぶ戻りました。不思議なことに、失くしたことのない物まで一つ混じっていました。それはそちらにお返しします。'
];
const ownersData = ownersJson as Record<string, OwnerDef[]>;
export const OWNERS_BY_WORLD: Record<string, OwnerDef[]> = {};
for (const w of WORLDS) {
  OWNERS_BY_WORLD[w.id] = ownersData[w.id] ?? NUMS.map((n, k) => ({
    id: `g${w.id}_o${k}`, name: `${w.short}の住人・${n}番`, profile: `${w.name}に住む人。手紙は短く、署名はいつも番号だけ。`,
    letters: GENERIC_LETTERS, generic: true
  }));
}
export const OWNER: Record<string, OwnerDef> = {};
for (const list of Object.values(OWNERS_BY_WORLD)) for (const o of list) OWNER[o.id] = o;
export const LETTER_THRESHOLDS = [1, 3, 6];
/** 品物の種類 → 持ち主（owners.json の items で指定されたもの） */
export const ITEM_OWNER: Record<string, string> = {};
for (const o of Object.values(OWNER)) for (const t of o.items ?? []) ITEM_OWNER[t] = o.id;
export const WORLD_INDEX: Record<string, number> = Object.fromEntries(WORLDS.map((w, i) => [w.id, i]));
