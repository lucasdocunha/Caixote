import { expect, test } from 'vitest';
import { freeRects, layers, plan, type Item, type Load, type PalletSpec, type Rect, type Vehicle } from './pack';

const trailer: Vehicle = { width: 2.45, depth: 13.6, height: 2.7, maxWeightKg: 30000, gap: 0 };
const pbr: PalletSpec = { width: 1.2, depth: 1.0, baseH: 0.15, maxH: 1.65, maxKg: 1200 };
const item = (o: Partial<Item>): Item => ({
  id: 'a', name: 'Caixa', l: 40, w: 30, h: 25, kg: 8, qty: 60, priority: 1, stackable: false, mixable: false, color: '#f00', ...o,
});

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w - 1e-9 && b.x < a.x + a.w - 1e-9 && a.y < b.y + b.d - 1e-9 && b.y < a.y + a.d - 1e-9;

function assertLayer(rs: Rect[], L: number, W: number) {
  for (const r of rs) expect(r.x >= -1e-9 && r.y >= -1e-9 && r.x + r.w <= L + 1e-9 && r.y + r.d <= W + 1e-9).toBe(true);
  rs.forEach((a, i) => rs.slice(i + 1).forEach((b) => expect(overlaps(a, b)).toBe(false)));
}

function assertLoad(l: Load, v: Vehicle) {
  for (const p of l.placements) {
    expect(p.x + p.w + v.gap).toBeLessThanOrEqual(v.width + 1e-9);
    expect(p.y + p.d + v.gap).toBeLessThanOrEqual(v.depth + 1e-9);
    expect(p.z + p.h).toBeLessThanOrEqual(v.height + 1e-9);
  }
  l.placements.forEach((a, i) =>
    l.placements.slice(i + 1).forEach((b) => expect(overlaps(a, b) && a.z < b.z + b.h && b.z < a.z + a.h).toBe(false)),
  );
  expect(l.weightKg).toBeLessThanOrEqual(v.maxWeightKg);
}

test('amarração: 40×30 box on PBR → 10 per layer, interlocked', () => {
  const [A, B] = layers(1.2, 1.0, 0.4, 0.3);
  expect(A.length).toBe(10); // plain grid only gets 9
  expect(B.length).toBe(10);
  assertLayer(A, 1.2, 1.0);
  assertLayer(B, 1.2, 1.0);
  const r = plan([item({})], pbr, trailer);
  expect(r.items[0].interlock).toBe(true);
  expect(r.items[0].perPallet).toBe(60); // 6 layers × 10
});

test('partial pallet keeps the bottom full', () => {
  const r = plan([item({ qty: 75 })], pbr, trailer);
  const [, last] = r.items[0].pallets;
  expect(last.boxes).toHaveLength(15);
  expect(last.boxes.filter((b) => b.z === pbr.baseH)).toHaveLength(10);
});

test('overflow goes to a second vehicle, priority 1 first', () => {
  const r = plan(
    [item({ id: 'low', priority: 2, qty: 20 * 60 }), item({ id: 'high', priority: 1, qty: 10 * 60 })],
    pbr,
    trailer,
  );
  expect(r.loads).toHaveLength(2);
  expect(r.loads[0].placements).toHaveLength(26);
  expect(r.loads[1].placements).toHaveLength(4);
  expect(r.loads[0].placements.filter((p) => p.pallet.item.id === 'high')).toHaveLength(10);
  r.loads.forEach((l) => assertLoad(l, trailer));
});

test('stacks stackable pallets when floor is short, never over weight', () => {
  const v = { ...trailer, depth: 4, maxWeightKg: 5000 };
  const r = plan([item({ stackable: true, qty: 16 * 30, h: 25 })], { ...pbr, maxH: 1.15 }, v);
  r.loads.forEach((l) => assertLoad(l, v));
  expect(r.loads[0].placements.some((p) => p.layer > 0)).toBe(true);
  expect(r.left).toHaveLength(0);
});

test('box bigger than pallet is reported', () => {
  const r = plan([item({ l: 200 })], pbr, trailer);
  expect(r.items[0].error).toBeTruthy();
  expect(r.loads).toHaveLength(0);
});

test('free space of a layer = pallet minus boxes', () => {
  const [A] = layers(1.2, 1.0, 0.4, 0.3);
  const free = freeRects(A, 1.2, 1.0);
  const area = (rs: Rect[]) => rs.reduce((t, r) => t + r.w * r.d, 0);
  expect(area(free)).toBeCloseTo(1.2 - area(A), 6);
  free.forEach((f) => A.forEach((b) => expect(overlaps(f, b)).toBe(false)));
  expect(freeRects([{ x: 0, y: 0, w: 1.2, d: 1.0 }], 1.2, 1.0)).toHaveLength(0);
});

test('leftovers of mixable items share one pallet, partial layer on top', () => {
  const r = plan(
    [item({ id: 'a', qty: 60 + 25, mixable: true }), item({ id: 'b', qty: 15, kg: 4, mixable: true }), item({ id: 'c', qty: 5 })],
    pbr,
    trailer,
  );
  expect(r.mixed).toHaveLength(1);
  const m = r.mixed[0];
  expect(m.items.map((i) => i.id).sort()).toEqual(['a', 'b']);
  expect(m.boxes).toHaveLength(40);
  const tops = [...new Set(m.boxes.map((b) => b.z))].sort((x, y) => x - y);
  // every layer but the top one is full
  tops.slice(0, -1).forEach((z) => expect(m.boxes.filter((b) => b.z === z)).toHaveLength(10));
  tops.forEach((z) => assertLayer(m.boxes.filter((b) => b.z === z), 1.2, 1.0));
  expect(m.height).toBeLessThanOrEqual(pbr.maxH + 1e-9);
  // non-mixable 'c' keeps its own pallet
  expect(r.items.find((p) => p.item.id === 'c')!.pallets).toHaveLength(1);
});
