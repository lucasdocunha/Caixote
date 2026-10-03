import { useEffect, useMemo, useState } from 'react';
import { plan as calc, type Item, type Pallet, type PalletSpec, type Plan, type Vehicle } from './pack';
import { PalletScene, TruckScene } from './Scene';
import { LoadInfo, PalletInfo, card } from './Panels';

const VEHICLES: Record<string, Omit<Vehicle, 'gap'>> = {
  'Carreta 13,6 m': { width: 2.45, depth: 13.6, height: 2.7, maxWeightKg: 27000 },
  'Truck 8,5 m': { width: 2.45, depth: 8.5, height: 2.6, maxWeightKg: 14000 },
  'Toco 6,5 m': { width: 2.4, depth: 6.5, height: 2.5, maxWeightKg: 7000 },
  "Contêiner 20'": { width: 2.35, depth: 5.9, height: 2.39, maxWeightKg: 28000 },
  "Contêiner 40'": { width: 2.35, depth: 12.03, height: 2.39, maxWeightKg: 26700 },
  "Contêiner 40' HC": { width: 2.35, depth: 12.03, height: 2.69, maxWeightKg: 26500 },
};
const PALLETS: Record<string, Pick<PalletSpec, 'width' | 'depth'>> = {
  'PBR 1,20 × 1,00': { width: 1.2, depth: 1.0 },
  'Euro 1,20 × 0,80': { width: 1.2, depth: 0.8 },
  'Americano 1,22 × 1,02': { width: 1.22, depth: 1.02 },
};
const COLORS = ['#0ea5e9', '#f97316', '#8b5cf6', '#10b981', '#f43f5e', '#eab308', '#14b8a6', '#d946ef'];

const newItem = (i: number): Item => ({
  id: crypto.randomUUID(), name: `Item ${i + 1}`, l: 40, w: 30, h: 25, kg: 8, qty: 0, priority: 1, stackable: true, mixable: false, color: COLORS[i % COLORS.length],
});

function useSaved<T>(key: string, init: T) {
  const [v, set] = useState<T>(() => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? 'null') ?? init;
    } catch {
      return init;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(v));
    } catch { /* storage off: still works for this session */ }
  }, [key, v]);
  return [v, set] as const;
}

const input = 'w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-200 focus:border-sky-400';

function Num({ label, value, onChange, step = 1, min = 0 }: { label: string; value: number; onChange: (n: number) => void; step?: number; min?: number }) {
  return (
    <label className="block text-[11px] text-slate-500">
      {label}
      <input type="number" inputMode="decimal" min={min} step={step} value={value} className={input} onChange={(e) => onChange(Math.max(min, +e.target.value))} />
    </label>
  );
}

function Section({ title, open, children }: { title: string; open?: boolean; children: React.ReactNode }) {
  return (
    <details open={open} className={`${card} group`}>
      <summary className="cursor-pointer list-none px-4 py-3 font-medium text-slate-700 flex justify-between items-center">
        {title}
        <span className="text-slate-400 transition group-open:rotate-180">⌄</span>
      </summary>
      <div className="px-4 pb-4 space-y-3">{children}</div>
    </details>
  );
}

export default function App() {
  const [items, setItems] = useSaved<Item[]>('caixote.items', [{ ...newItem(0), name: 'Caixa padrão', qty: 600 }]);
  const [vehicle, setVehicle] = useSaved<Vehicle>('caixote.vehicle', { ...VEHICLES['Carreta 13,6 m'], gap: 0.02 });
  const [spec, setSpec] = useSaved<PalletSpec>('caixote.pallet', { ...PALLETS['PBR 1,20 × 1,00'], baseH: 0.15, maxH: 1.6, maxKg: 1200 });

  const [result, setResult] = useState<Plan | null>(null);
  const [phase, setPhase] = useState<'pallet' | 'truck'>('pallet');
  const [idx, setIdx] = useState(0);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [selected, setSelected] = useState<number | null>(null);

  const setT = (id: string, patch: Partial<Item>) => setItems(items.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const show = (p: typeof phase, i: number) => (setPhase(p), setIdx(i), setStep(0), setPlaying(true), setSelected(null));

  // distinct pallets to show in step 1 (identical ones grouped)
  const kinds = useMemo(() => {
    if (!result) return [];
    const all = [...result.items.flatMap((p) => p.pallets), ...result.mixed];
    const groups = new Map<string, { pallet: Pallet; count: number; name: string }>();
    let mixedN = 0;
    for (const p of all) {
      const sig = p.items.map((i) => i.id).join() + p.boxes.length + p.height.toFixed(3);
      const g = groups.get(sig);
      if (g) g.count++;
      else groups.set(sig, { pallet: p, count: 1, name: p.items.length > 1 ? `Misto ${++mixedN}` : p.item.name });
    }
    const kinds = [...groups.values()];
    for (const k of kinds) // a single-item pallet with fewer boxes than its full sibling is the leftover
      if (k.pallet.items.length === 1 && kinds.some((o) => o.pallet.item === k.pallet.item && o.pallet.boxes.length > k.pallet.boxes.length)) k.name += ' (resto)';
    return kinds;
  }, [result]);
  const kind = phase === 'pallet' ? kinds[idx] : undefined;
  const load = phase === 'truck' ? result?.loads[idx] : undefined;
  const total = kind ? kind.pallet.boxes.length : load?.placements.length ?? 0;
  const rate = (phase === 'pallet' ? 8 : 1.5) * speed; // boxes or pallets per second
  const player = { total, playing, speed: rate, setStep, setPlaying };

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800">
      <header className="px-4 sm:px-6 py-4 flex items-baseline gap-3">
        <h1 className="text-xl font-bold tracking-tight">📦 Caixote</h1>
        <span className="text-sm text-slate-500">monte pallets e carregue o veículo</span>
      </header>

      <div className="px-4 sm:px-6 pb-8 grid gap-4 lg:grid-cols-[360px_1fr] items-start">
        <aside className="space-y-3 lg:sticky lg:top-4">
          <Section title="Itens" open>
            {items.map((t) => (
              <div key={t.id} className="rounded-xl border border-slate-200 p-3 space-y-2">
                <div className="flex gap-2 items-center">
                  <input type="color" value={t.color} onChange={(e) => setT(t.id, { color: e.target.value })} className="h-7 w-7 shrink-0 rounded cursor-pointer" aria-label="Cor" />
                  <input className={input} value={t.name} onChange={(e) => setT(t.id, { name: e.target.value })} aria-label="Nome" />
                  <button className="text-slate-400 hover:text-rose-500 px-1" onClick={() => setItems(items.filter((x) => x.id !== t.id))} aria-label={`Remover ${t.name}`}>✕</button>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  <Num label="Compr. cm" value={t.l} onChange={(n) => setT(t.id, { l: n })} min={1} />
                  <Num label="Larg. cm" value={t.w} onChange={(n) => setT(t.id, { w: n })} min={1} />
                  <Num label="Alt. cm" value={t.h} onChange={(n) => setT(t.id, { h: n })} min={1} />
                  <Num label="Peso kg" value={t.kg} onChange={(n) => setT(t.id, { kg: n })} step={0.1} />
                  <Num label="Quantidade" value={t.qty} onChange={(n) => setT(t.id, { qty: Math.floor(n) })} />
                  <Num label="Prioridade" value={t.priority} onChange={(n) => setT(t.id, { priority: Math.floor(n) })} min={1} />
                  <div className="col-span-2 flex flex-col justify-end gap-1 text-xs text-slate-600">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={t.stackable} onChange={(e) => setT(t.id, { stackable: e.target.checked })} className="accent-sky-500" />
                      Aceita pallet em cima
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={!!t.mixable} onChange={(e) => setT(t.id, { mixable: e.target.checked })} className="accent-sky-500" />
                      Pode misturar
                    </label>
                  </div>
                </div>
              </div>
            ))}
            <button className="w-full rounded-xl border border-dashed border-slate-300 py-2 text-sm text-slate-500 hover:border-sky-400 hover:text-sky-600" onClick={() => setItems([...items, newItem(items.length)])}>
              + Novo item
            </button>
            <p className="text-[11px] text-slate-400">Itens ficam salvos neste navegador. Quantidade 0 = fora desta carga. Prioridade 1 entra primeiro.</p>
          </Section>

          <Section title="Veículo">
            <select className={input} value="" onChange={(e) => e.target.value && setVehicle({ ...VEHICLES[e.target.value], gap: vehicle.gap })}>
              <option value="">Escolher modelo…</option>
              {Object.keys(VEHICLES).map((k) => <option key={k}>{k}</option>)}
            </select>
            <div className="grid grid-cols-3 gap-2">
              <Num label="Altura m" value={vehicle.height} onChange={(n) => setVehicle({ ...vehicle, height: n })} step={0.01} />
              <Num label="Profund. m" value={vehicle.depth} onChange={(n) => setVehicle({ ...vehicle, depth: n })} step={0.01} />
              <Num label="Largura m" value={vehicle.width} onChange={(n) => setVehicle({ ...vehicle, width: n })} step={0.01} />
              <Num label="Carga máx kg" value={vehicle.maxWeightKg} onChange={(n) => setVehicle({ ...vehicle, maxWeightKg: n })} step={100} />
              <Num label="Folga cm" value={Math.round(vehicle.gap * 100)} onChange={(n) => setVehicle({ ...vehicle, gap: n / 100 })} />
            </div>
          </Section>

          <Section title="Pallet">
            <select className={input} value="" onChange={(e) => e.target.value && setSpec({ ...spec, ...PALLETS[e.target.value] })}>
              <option value="">Escolher modelo…</option>
              {Object.keys(PALLETS).map((k) => <option key={k}>{k}</option>)}
            </select>
            <div className="grid grid-cols-3 gap-2">
              <Num label="Compr. m" value={spec.width} onChange={(n) => setSpec({ ...spec, width: n })} step={0.01} />
              <Num label="Larg. m" value={spec.depth} onChange={(n) => setSpec({ ...spec, depth: n })} step={0.01} />
              <Num label="Base m" value={spec.baseH} onChange={(n) => setSpec({ ...spec, baseH: n })} step={0.01} />
              <Num label="Altura máx m" value={spec.maxH} onChange={(n) => setSpec({ ...spec, maxH: n })} step={0.05} />
              <Num label="Peso máx kg" value={spec.maxKg} onChange={(n) => setSpec({ ...spec, maxKg: n })} step={50} />
            </div>
          </Section>

          <button
            onClick={() => (setResult(calc(items, spec, vehicle)), show('pallet', 0))}
            className="w-full rounded-2xl bg-sky-500 hover:bg-sky-600 active:scale-[.99] transition text-white font-semibold py-3 shadow-lg shadow-sky-500/25"
          >
            Calcular
          </button>
        </aside>

        <main className="space-y-3 min-w-0">
          {!result ? (
            <div className={`${card} p-10 text-center text-slate-500`}>
              Cadastre os itens, informe as quantidades e clique em <b>Calcular</b>.
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-xl bg-slate-200/70 p-1 text-sm">
                  {(['pallet', 'truck'] as const).map((p, i) => (
                    <button key={p} onClick={() => show(p, 0)} className={`rounded-lg px-3 py-1.5 transition ${phase === p ? 'bg-white shadow-sm font-medium' : 'text-slate-600'}`}>
                      {i + 1}. {p === 'pallet' ? 'Montagem dos pallets' : 'Carregamento'}
                    </button>
                  ))}
                </div>
                {(phase === 'pallet' ? kinds.map((k) => (k.count > 1 ? `${k.name} ×${k.count}` : k.name)) : result.loads.map((_, i) => `Veículo ${i + 1}`)).map((name, i) => (
                  <button key={i} onClick={() => show(phase, i)} className={`rounded-full px-3 py-1 text-sm border transition ${idx === i ? 'border-sky-400 bg-sky-50 text-sky-700' : 'border-slate-200 bg-white text-slate-600'}`}>
                    {name}
                  </button>
                ))}
              </div>

              {result.loads.length > 1 && (
                <p className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
                  Não coube tudo em um veículo: o 1º leva o máximo possível (priorizando os de prioridade 1) e o resto segue para mais {result.loads.length - 1}.
                </p>
              )}
              {(result.left.length > 0 || result.items.some((p) => p.error)) && (
                <p className="rounded-xl bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-700">
                  {result.items.filter((p) => p.error).map((p) => `${p.item.name}: ${p.error}. `)}
                  {result.left.length > 0 && `${result.left.length} pallet(s) não cabem no veículo nem sozinhos.`}
                </p>
              )}

              {total > 0 && (
                <div className={`${card} relative h-[55vh] lg:h-[60vh] overflow-hidden`}>
                  {kind && <PalletScene key={idx} pallet={kind.pallet} step={step} player={player} />}
                  {load && <TruckScene key={idx} v={vehicle} load={load} step={step} selected={selected} onSelect={setSelected} player={player} />}
                  <div className="absolute bottom-3 inset-x-3 flex items-center gap-3 rounded-xl bg-white/90 backdrop-blur px-3 py-2 shadow">
                    <button className="w-8 h-8 rounded-full bg-sky-500 text-white text-xs shrink-0" onClick={() => (step >= total ? (setStep(0), setPlaying(true)) : setPlaying(!playing))} aria-label={playing ? 'Pausar' : 'Reproduzir'}>
                      {playing ? '❚❚' : '▶'}
                    </button>
                    <input type="range" className="flex-1 accent-sky-500" min={0} max={total} step={0.01} value={step} onChange={(e) => (setPlaying(false), setStep(+e.target.value))} aria-label="Passo" />
                    <span className="text-xs tabular-nums text-slate-600 w-14 text-right">{Math.floor(step)}/{total}</span>
                    <button className="text-xs text-slate-500 w-8" onClick={() => setSpeed(speed >= 4 ? 1 : speed * 2)} aria-label="Velocidade">{speed}×</button>
                  </div>
                </div>
              )}

              <div className={`${card} p-4`}>
                {kind && <PalletInfo pallet={kind.pallet} count={kind.count} s={spec} />}
                {load && <LoadInfo v={vehicle} load={load} step={step} selected={selected} onSelect={setSelected} />}
                {!kind && !load && <p className="text-sm text-slate-500">Nada para mostrar aqui.</p>}
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
