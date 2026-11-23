// ===== 静的データの型 =====
export interface WorldDef {
  id: string; name: string; short: string; color: string; material: string;
  travelHours: number; value: number; desc: string; x: number; y: number;
}
export interface ItemDef { id: string; world: string; name: string; desc: string; clues: string[]; generic?: boolean }
export interface OwnerDef { id: string; name: string; profile: string; letters: string[]; generic?: boolean }
export interface MysteryReq { letters?: number; relocations?: number; worlds?: number; catalog?: number }
export interface MysteryDef { id: number; title: string; req: MysteryReq; text: string | null }
export interface ResearchReq { returns?: number; research?: string }
export interface ResearchDef {
  id: string; name: string; desc: string; kind: 'world' | 'flag' | 'level';
  world?: string; stat?: string; per?: number; max: number; cost: number; growth: number;
  hours: number; hoursGrowth?: number; keep?: boolean; req?: ResearchReq;
}
export interface TraitDef {
  id: string; name: string; desc: string;
  appraise?: number; hint?: number; autoFee?: number; rare?: number; cheap?: number;
  repair?: number; thrift?: number; repairFee?: number;
  travel?: number; cap?: number; credit?: number; material?: number;
}
export interface RelocationDef { n: number; place: string; world: string; mechanic: Mechanic; mechanicName: string; mechanicDesc: string }
export type Mechanic = 'express' | 'bulletin' | 'bigcart' | 'nightshift' | 'hint' | 'archive';

// ===== 実行時の状態 =====
export type Role = 'appraiser' | 'repairer' | 'courier';
export type FacilityId = 'storage' | 'appraisal' | 'workshop' | 'gate';
export type Rarity = 0 | 1 | 2;
export type ItemStage =
  | 'gate'        // ゲート前（未回収）
  | 'unknown'     // 倉庫・未鑑定
  | 'qAppraise'   // 鑑定待ち（鑑定士に任せた）
  | 'appraising'  // 鑑定中
  | 'damaged'     // 鑑定済み・破損
  | 'qRepair'     // 修理待ち
  | 'repairing'   // 修理中
  | 'ready'       // 返却準備完了
  | 'shipping';   // 配達中

export interface ItemInst {
  id: number; type: string; world: string; owner: string;
  rarity: Rarity; damaged: boolean; stage: ItemStage;
  verdict: 'correct' | 'wrong' | 'auto' | null;
  choices: string[]; strike: string | null;
  repaired: boolean; autoFeeBonus: number; arrivedAt: number;
}

export type Task =
  | { kind: 'appraise'; item: number; start: number; end: number }
  | { kind: 'repair'; item: number; start: number; end: number }
  | { kind: 'trip'; world: string; items: number[]; start: number; end: number; express: boolean };

export interface Staff { id: number; role: Role; name: string; lv: number; trait: string; task: Task | null; hiredAt: number }
export interface Candidate { name: string; trait: string }

export interface Letter { owner: string; world: string; idx: number; at: number; read: boolean }
export interface RequestPost { id: number; type: string; world: string; owner: string; postedAt: number; expiresAt: number; done: boolean }

export interface Report {
  from: number; to: number;
  arrivals: number; appraised: number; repaired: number; trips: number; returned: number;
  fee: number; credit: number; letters: number; research: string[]; requests: number;
}

export interface SessionStats {
  startedAt: number; fee: number; credit: number; appraised: number; correct: number;
  repaired: number; returned: number; letters: number; dispatched: number; acted: boolean; closedShown: boolean;
}

export interface GameState {
  version: number;
  createdAt: number; lastTick: number; savedAt: number;
  rng: number; nextId: number;
  fee: number; credit: number; branchCredit: number;
  materials: Record<string, number>;
  facilities: Record<FacilityId, number>;
  staff: Staff[];
  candidates: Record<Role, Candidate[]>;
  items: ItemInst[];
  gate: { next: number; deliveries: number };
  research: { active: { id: string; start: number; end: number } | null; levels: Record<string, number> };
  catalog: Record<string, { n: number; best: Rarity; r?: number }>;
  ownerReturns: Record<string, number>;
  letters: Letter[];
  requests: RequestPost[];
  mysterySeen: number;
  relocations: number;
  firstTrip: boolean;
  totals: { returned: number; appraised: number; correct: number; fee: number; credit: number; trips: number };
  session: SessionStats;
  report: Report | null;   // 留守中のまとめ（開館時に表示）
  settings: { reduceMotion: boolean };
  log: { at: number; text: string }[];
}
