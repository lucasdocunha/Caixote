// Meters/kg. x = across width, y = depth from cabin (0) to door, z = up. Item sizes are in cm.

export interface Vehicle { width: number; depth: number; height: number; maxWeightKg: number; gap: number }
export interface PalletSpec { width: number; depth: number; baseH: number; maxH: number; maxKg: number }
export interface Item {
  id: string; name: string;
  l: number; w: number; h: number; // cm
  kg: number; qty: number;
  priority: number; // 1 = goes first
  stackable: boolean; // another pallet may go on top
  mixable: boolean; // leftovers may share a pallet with other items
  color: string;
}
export interface Rect { x: number; y: number; w: number; d: number }
export interface Box extends Rect { z: number; h: number; item: Item }
export interface Pallet {
  id: number; item: Item; items: Item[]; width: number; depth: number; height: number; kg: number; boxes: Box[];
  priority: number; stackable: boolean;
}
export interface ItemPlan {
  item: Item; perLayer: number; layers: number; perPallet: number; interlock: boolean;
  layerA: Rect[]; layerB: Rect[]; pallets: Pallet[]; rest: number; error?: string;
}
export interface Placement { n: number; pallet: Pallet; x: number; y: number; z: number; w: number; d: number; h: number; layer: number; rotated: boolean }
export interface Load { placements: Placement[]; left: Pallet[]; volumePct: number; floorPct: number; weightKg: number; cg: { x: number; y: number } }
export interface Plan { items: ItemPlan[]; mixed: Pallet[]; loads: Load[]; left: Pallet[] }

const EPS = 1e-9;

// ---------- amarração (pallet loading) ----------

function grid(x0: number, y0: number, W: number, D: number, a: number, b: number): Rect[] {
  const r: Rect[] = [];
  for (let i = 0; i < Math.floor(W / a + EPS); i++)
    for (let j = 0; j < Math.floor(D / b + EPS); j++) r.push({ x: x0 + i * a, y: y0 + j * b, w: a, d: b });
  return r;
}

export const key = (rs: Rect[]) => rs.map((r) => `${r.x.toFixed(3)},${r.y.toFixed(3)},${r.w.toFixed(3)}`).sort().join('|');

function center(rs: Rect[], L: number, W: number): Rect[] {
  const dx = (L - Math.max(0, ...rs.map((r) => r.x + r.w))) / 2;
  const dy = (W - Math.max(0, ...rs.map((r) => r.y + r.d))) / 2;
  return rs.map((r) => ({ ...r, x: r.x + dx, y: r.y + dy }));
}

/**
 * Best layer for an a×b box on an L×W pallet, plus an alternate layer for interlocking (amarração).
 * ponytail: two-block patterns only (split once along length or width); 4-block/Lins patterns squeeze ~1 more box in odd cases.
 */
export function layers(L: number, W: number, a: number, b: number): [Rect[], Rect[]] {
  const cands: Rect[][] = [];
  for (const [p, q] of [[a, b], [b, a]]) {
    for (let k = 0; k * p <= L + EPS; k++) cands.push([...grid(0, 0, k * p, W, p, q), ...grid(k * p, 0, L - k * p, W, q, p)]);
    for (let k = 0; k * q <= W + EPS; k++) cands.push([...grid(0, 0, L, k * q, p, q), ...grid(0, k * q, L, W - k * q, q, p)]);
  }
  const max = Math.max(...cands.map((c) => c.length));
  const best = cands.filter((c) => c.length === max).map((c) => center(c, L, W));
  const A = best[0];
  const mirror = A.map((r) => ({ ...r, x: L - r.x - r.w, y: W - r.y - r.d })); // 180° turn
  const B = key(mirror) !== key(A) ? mirror : best.find((c) => key(c) !== key(A)) ?? A;
  return [A, B];
}

export function palletize(item: Item, s: PalletSpec): ItemPlan {
  const [a, b, h] = [item.l / 100, item.w / 100, item.h / 100];
  const [A, B] = layers(s.width, s.depth, a, b);
  const byHeight = Math.floor((s.maxH - s.baseH) / h + EPS) * A.length;
  const perPallet = Math.min(byHeight, item.kg > 0 ? Math.floor(s.maxKg / item.kg) : Infinity);
  const plan: ItemPlan = {
    item, perLayer: A.length, layers: A.length ? Math.ceil(perPallet / A.length) : 0, perPallet,
    interlock: key(A) !== key(B), layerA: A, layerB: B, pallets: [], rest: 0,
  };
  if (!A.length) return { ...plan, error: 'maior que o pallet' };
  if (!perPallet) return { ...plan, error: 'alto ou pesado demais para o pallet' };

  const full = Math.floor(item.qty / perPallet), rest = item.qty % perPallet;
  for (let i = 0; i < full; i++) plan.pallets.push(build(layersOf(plan, perPallet), s));
  if (rest) plan.rest = rest;
  return plan;
}

type Block = { plan: ItemPlan; count: number }; // one layer of one item

const layersOf = (plan: ItemPlan, count: number): Block[] =>
  Array.from({ length: Math.ceil(count / plan.perLayer) }, (_, i) => ({ plan, count: Math.min(plan.perLayer, count - i * plan.perLayer) }));

const blockH = (b: Block) => b.plan.item.h / 100;
const blockKg = (b: Block) => b.count * b.plan.item.kg;

type Top = { item: Item; rects: Rect[] }[]; // top layer: may mix items/heights, nothing goes above it

/** Stacks layers bottom-up; layers alternate pattern A/B (amarração). Only the top layer may be partial. */
function build(blocks: Block[], s: PalletSpec, top: Top = []): Pallet {
  let z = s.baseH;
  const boxes: Box[] = [];
  blocks.forEach((b, layer) => {
    const pattern = layer % 2 ? b.plan.layerB : b.plan.layerA;
    for (let i = 0; i < b.count; i++) boxes.push({ ...pattern[i], z, h: blockH(b), item: b.plan.item });
    z += blockH(b);
  });
  for (const t of top) for (const r of t.rects) boxes.push({ ...r, z, h: t.item.h / 100, item: t.item });
  const items = [...new Set(boxes.map((b) => b.item))];
  return {
    id: 0, item: items[0], items, width: s.width, depth: s.depth, boxes,
    height: z + Math.max(0, ...top.map((t) => t.item.h / 100)),
    kg: boxes.reduce((t, b) => t + b.item.kg, 0),
    priority: Math.min(...items.map((i) => i.priority)),
    stackable: items.every((i) => i.stackable),
  };
}

/** Fits n boxes of `item` into the empty areas left by `used`, or null if they don't all fit. */
function fill(used: Rect[], item: Item, n: number, s: PalletSpec): Rect[] | null {
  const [a, b] = [item.l / 100, item.w / 100];
  const out = freeRects(used, s.width, s.depth).flatMap((f) => {
    const g1 = grid(f.x, f.y, f.w, f.d, a, b), g2 = grid(f.x, f.y, f.w, f.d, b, a);
    return g1.length >= g2.length ? g1 : g2;
  });
  return out.length >= n ? out.slice(0, n) : null;
}

/**
 * Leftovers of mixable items share pallets: heavy full layers at the bottom,
 * partial layers on top, filling each other's empty spaces.
 */
function mix(rests: ItemPlan[], s: PalletSpec): Pallet[] {
  const blocks = rests.flatMap((p) => layersOf(p, p.rest));
  const full = blocks.filter((b) => b.count === b.plan.perLayer).sort((a, b) => blockKg(b) - blockKg(a));
  const partial = blocks.filter((b) => b.count < b.plan.perLayer).sort((a, b) => b.count - a.count);
  type P = { blocks: Block[]; top: Top };
  const pallets: P[] = [];
  const ok = (p: P, addH: number, addKg: number) =>
    s.baseH + p.blocks.reduce((t, b) => t + blockH(b), 0) + addH <= s.maxH + EPS &&
    p.blocks.reduce((t, b) => t + blockKg(b), 0) + p.top.reduce((t, x) => t + x.rects.length * x.item.kg, 0) + addKg <= s.maxKg;

  for (const b of full) {
    let p = pallets.find((p) => ok(p, blockH(b), blockKg(b)));
    if (!p) pallets.push((p = { blocks: [], top: [] }));
    p.blocks.push(b);
  }
  for (const b of partial) {
    const topH = (p: P) => Math.max(blockH(b), ...p.top.map((t) => t.item.h / 100));
    const rectsFor = (p: P) =>
      p.top.length
        ? fill(p.top.flatMap((t) => t.rects), b.plan.item, b.count, s)
        : (p.blocks.length % 2 ? b.plan.layerB : b.plan.layerA).slice(0, b.count);
    let target: P | undefined, rects: Rect[] | null = null;
    for (const p of pallets) if (ok(p, topH(p), blockKg(b)) && (rects = rectsFor(p))) { target = p; break; }
    if (!target) pallets.push((target = { blocks: [], top: [] })), (rects = b.plan.layerA.slice(0, b.count));
    target.top.push({ item: b.plan.item, rects: rects! });
  }
  return pallets.map((p) => build(p.blocks, s, p.top));
}

/** Empty areas of one layer (top view), merged into rectangles. */
export function freeRects(rs: Rect[], L: number, W: number): Rect[] {
  const cuts = (vals: number[]) => [...new Set(vals.map((n) => +n.toFixed(4)))].sort((a, b) => a - b);
  const xs = cuts([0, L, ...rs.flatMap((r) => [r.x, r.x + r.w])]);
  const ys = cuts([0, W, ...rs.flatMap((r) => [r.y, r.y + r.d])]);
  const covered = (x: number, y: number) => rs.some((r) => x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.d);
  let out: Rect[] = [];
  for (let j = 0; j + 1 < ys.length; j++) {
    let run: Rect | null = null;
    for (let i = 0; i + 1 < xs.length; i++) {
      const free = !covered((xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2);
      if (free && run) run.w = xs[i + 1] - run.x;
      else if (free) out.push((run = { x: xs[i], y: ys[j], w: xs[i + 1] - xs[i], d: ys[j + 1] - ys[j] }));
      else run = null;
    }
  }
  // merge strips with the same span stacked vertically
  out = out.reduce<Rect[]>((acc, r) => {
    const above = acc.find((a) => Math.abs(a.x - r.x) < EPS && Math.abs(a.w - r.w) < EPS && Math.abs(a.y + a.d - r.y) < EPS);
    if (above) above.d += r.d;
    else acc.push({ ...r });
    return acc;
  }, []);
  return out.filter((r) => r.w > 0.005 && r.d > 0.005);
}

// ---------- loading pallets into a vehicle ----------

type Stack = { items: Pallet[]; h: number };

function buildStacks(units: Pallet[], v: Vehicle, topKg: number, stacking: boolean): Stack[] {
  const stacks: Stack[] = [];
  for (const u of units) {
    const ok = (s: Stack) =>
      s.items[s.items.length - 1].stackable &&
      s.h + u.height <= v.height + EPS &&
      s.items.every((_, i) => s.items.slice(i + 1).reduce((kg, a) => kg + a.kg, u.kg) <= topKg);
    const open = stacking ? stacks.filter(ok) : [];
    const target = open.find((s) => s.items[0].item.id === u.item.id) ?? open[0];
    if (target) target.items.push(u), (target.h += u.height);
    else stacks.push({ items: [u], h: u.height });
  }
  return stacks;
}

// ponytail: shelf (row) packing along the depth; fine since all pallets share one footprint
function packOnce(pallets: Pallet[], v: Vehicle, topKg: number, stacking: boolean, wide: boolean): Load {
  const left: Pallet[] = [];
  const units = [...pallets].sort((a, b) => a.priority - b.priority || b.kg - a.kg);
  let kg = 0;
  const accepted = units.filter((u) => {
    if (kg + u.kg > v.maxWeightKg) return left.push(u), false;
    return (kg += u.kg), true;
  });

  const placements: Placement[] = [];
  let x = v.gap, rowY = v.gap, rowD = 0;
  for (const s of buildStacks(accepted, v, topKg, stacking)) {
    const b = s.items[0];
    const big = Math.max(b.width, b.depth), small = Math.min(b.width, b.depth);
    let orients: [number, number][] = wide ? [[big, small], [small, big]] : [[small, big], [big, small]];
    if (rowD) orients = orients.sort((p, q) => +(p[1] > rowD) - +(q[1] > rowD));
    const fits = ([w, d]: [number, number], cx: number, cy: number) =>
      cx + w + v.gap <= v.width + EPS && cy + d + v.gap <= v.depth + EPS && s.h <= v.height + EPS;

    let o = orients.find((o) => fits(o, x, rowY));
    if (!o && rowD) {
      const ny = rowY + rowD + v.gap;
      o = orients.find((o) => fits(o, v.gap, ny));
      if (o) (x = v.gap), (rowY = ny), (rowD = 0);
    }
    if (!o) {
      left.push(...s.items);
      continue;
    }
    const [w, d] = o;
    let z = 0;
    s.items.forEach((p, layer) => {
      placements.push({ n: 0, pallet: p, x, y: rowY, z, w, d, h: p.height, layer, rotated: w !== p.width });
      z += p.height;
    });
    x += w + v.gap;
    rowD = Math.max(rowD, d);
  }

  // load order: cabin → door, one whole stack at a time
  placements.sort((a, b) => a.y - b.y || a.x - b.x || a.z - b.z).forEach((p, i) => (p.n = i + 1));

  const weightKg = placements.reduce((s, p) => s + p.pallet.kg, 0);
  const cg = { x: 0, y: 0 };
  for (const p of placements) {
    cg.x += ((p.x + p.w / 2) * p.pallet.kg) / (weightKg || 1);
    cg.y += ((p.y + p.d / 2) * p.pallet.kg) / (weightKg || 1);
  }
  return {
    placements, left, weightKg, cg,
    volumePct: (100 * placements.reduce((s, p) => s + p.w * p.d * p.h, 0)) / (v.width * v.depth * v.height),
    floorPct: (100 * placements.filter((p) => !p.layer).reduce((s, p) => s + p.w * p.d, 0)) / (v.width * v.depth),
  };
}

/** One vehicle: tries a few strategies, most pallets wins (ties → floor-only, the first tried). */
export function pack(pallets: Pallet[], v: Vehicle, topKg: number): Load {
  let best: Load | null = null;
  for (const stacking of [false, true])
    for (const wide of [true, false]) {
      const r = packOnce(pallets, v, topKg, stacking, wide);
      if (!best || r.placements.length > best.placements.length) best = r;
    }
  return best!;
}

/** Items → pallets → as many vehicles as needed. */
export function plan(items: Item[], s: PalletSpec, v: Vehicle): Plan {
  const plans = items.filter((i) => i.qty > 0).map((i) => palletize(i, s));
  const rests = plans.filter((p) => p.rest);
  const mixing = rests.filter((p) => p.item.mixable);
  const mixed = mixing.length > 1 ? mix(mixing, s) : [];
  for (const p of rests) if (!mixed.length || !p.item.mixable) p.pallets.push(build(layersOf(p, p.rest), s));

  let id = 0;
  let rest = [...plans.flatMap((p) => p.pallets), ...mixed];
  rest.forEach((p) => (p.id = ++id));
  const loads: Load[] = [];
  while (rest.length) {
    const load = pack(rest, v, s.maxKg);
    if (!load.placements.length) break; // what's left fits in no vehicle at all
    loads.push(load);
    rest = load.left;
  }
  return { items: plans, mixed, loads, left: rest };
}
