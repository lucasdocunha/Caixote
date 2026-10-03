import { freeRects, key, type Box, type Load, type Pallet, type PalletSpec, type Rect, type Vehicle } from './pack';

export const card = 'rounded-2xl bg-white border border-slate-200/80 shadow-sm';

export function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className={`font-semibold tabular-nums ${warn ? 'text-amber-600' : 'text-slate-800'}`}>{value}</div>
    </div>
  );
}

const area = (rs: Rect[]) => rs.reduce((t, r) => t + r.w * r.d, 0);
const cm = (m: number) => Math.round(m * 100);

function LayerMap({ n, boxes, s }: { n: number; boxes: Box[]; s: PalletSpec }) {
  const free = freeRects(boxes, s.width, s.depth);
  const freePct = (100 * area(free)) / (s.width * s.depth);
  return (
    <figure>
      <svg viewBox={`-0.03 -0.03 ${s.width + 0.06} ${s.depth + 0.06}`} className="w-full">
        <defs>
          <pattern id={`hatch-${n}`} width={0.04} height={0.04} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width={0.04} height={0.04} fill="#fff1f2" />
            <line x1={0} y1={0} x2={0} y2={0.04} stroke="#fb7185" strokeWidth={0.012} />
          </pattern>
        </defs>
        <rect width={s.width} height={s.depth} fill="#fde68a" stroke="#b45309" strokeWidth={0.01} rx={0.01} />
        {free.map((r, i) => (
          <g key={`f${i}`}>
            <rect x={r.x} y={r.y} width={r.w} height={r.d} fill={`url(#hatch-${n})`} stroke="#fb7185" strokeWidth={0.006}>
              <title>Livre: {cm(r.w)} × {cm(r.d)} cm</title>
            </rect>
            {r.w >= 0.16 && r.d >= 0.06 && (
              <text x={r.x + r.w / 2} y={r.y + r.d / 2} fontSize={0.045} textAnchor="middle" dominantBaseline="central" fill="#be123c" fontWeight={600}>
                {cm(r.w)}×{cm(r.d)}
              </text>
            )}
          </g>
        ))}
        {boxes.map((r, i) => (
          <rect key={i} x={r.x} y={r.y} width={r.w} height={r.d} fill={r.item.color} stroke="#fff" strokeWidth={0.008} rx={0.008} />
        ))}
      </svg>
      <figcaption className="text-xs text-slate-500 text-center mt-1">
        Camada {n} · {boxes.length} cx · <span className={freePct > 10 ? 'text-rose-600' : ''}>{freePct.toFixed(0)}% livre</span>
      </figcaption>
    </figure>
  );
}

export function PalletInfo({ pallet, count, s }: { pallet: Pallet; count: number; s: PalletSpec }) {
  const levels = [...new Set(pallet.boxes.map((b) => b.z))].sort((a, b) => a - b).map((z) => pallet.boxes.filter((b) => b.z === z));
  const baseFree = 100 - (100 * area(levels[0] ?? [])) / (s.width * s.depth);
  const noInterlock = levels.some((l, i) => i > 0 && l[0].item === levels[i - 1][0].item && key(l) === key(levels[i - 1]));
  const top = levels[levels.length - 1] ?? [];
  const topFree = freeRects(top, s.width, s.depth).filter((r) => r.w >= 0.1 && r.d >= 0.1);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Caixas" value={String(pallet.boxes.length)} />
        <Stat label="Camadas" value={String(levels.length)} />
        <Stat label="Peso · altura" value={`${pallet.kg.toFixed(0)} kg · ${pallet.height.toFixed(2)} m`} />
        <Stat label="Pallets iguais" value={String(count)} />
      </div>
      {pallet.items.length > 1 && (
        <div className="flex flex-wrap gap-3 text-sm">
          {pallet.items.map((it) => (
            <span key={it.id} className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: it.color }} />
              {it.name} · {pallet.boxes.filter((b) => b.item === it).length} cx
            </span>
          ))}
        </div>
      )}
      {baseFree > 10 && (
        <p className="text-xs text-rose-600">A base tem {baseFree.toFixed(0)}% de área livre: o pallet fica menos estável.</p>
      )}
      {topFree.length > 0 && (
        <p className="text-xs text-slate-600">
          Sobra espaço na camada de cima: {topFree.map((r) => `${cm(r.w)} × ${cm(r.d)} cm`).join(', ')} (hachurado em vermelho).
        </p>
      )}
      {noInterlock && (
        <p className="text-xs text-amber-600">Esse tamanho de caixa só forma colunas (sem amarração): use filme stretch ou cantoneiras.</p>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-4">
        {levels.map((l, i) => <LayerMap key={i} n={i + 1} boxes={l} s={s} />)}
      </div>
    </div>
  );
}

export function LoadInfo({ v, load, step, selected, onSelect }: { v: Vehicle; load: Load; step: number; selected: number | null; onSelect: (n: number) => void }) {
  const levels = [...new Set(load.placements.map((p) => p.layer))].sort();
  const sideCg = load.cg.x - v.width / 2;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Pallets" value={String(load.placements.length)} />
        <Stat label="Volume ocupado" value={`${load.volumePct.toFixed(0)}%`} />
        <Stat label="Peso" value={`${(load.weightKg / 1000).toFixed(1)} / ${(v.maxWeightKg / 1000).toFixed(1)} t`} />
        <Stat label="Centro de gravidade" value={`${sideCg >= 0 ? '+' : ''}${(sideCg * 100).toFixed(0)} cm lateral`} warn={Math.abs(sideCg) > 0.1} />
      </div>
      {levels.map((level) => (
        <div key={level}>
          <div className="text-xs text-slate-500 mb-1">{levels.length > 1 ? `Nível ${level + 1} (vista de cima)` : 'Vista de cima'}</div>
          <svg viewBox={`-0.5 -0.05 ${v.depth + 1} ${v.width + 0.1}`} className="w-full">
            <rect width={v.depth} height={v.width} fill="#f1f5f9" stroke="#94a3b8" strokeWidth={0.03} rx={0.05} />
            <line x1={v.depth} y1={0} x2={v.depth} y2={v.width} stroke="#f59e0b" strokeWidth={0.08} />
            <text x={-0.25} y={v.width / 2} fontSize={0.2} fill="#94a3b8" textAnchor="middle" transform={`rotate(-90 -0.25 ${v.width / 2})`}>CABINE</text>
            <text x={v.depth + 0.25} y={v.width / 2} fontSize={0.2} fill="#d97706" textAnchor="middle" transform={`rotate(90 ${v.depth + 0.25} ${v.width / 2})`}>PORTA</text>
            {load.placements.filter((p) => p.layer === level).map((p) => (
              <g key={p.n} onClick={() => onSelect(p.n)} className="cursor-pointer" opacity={step >= p.n ? 1 : 0.3}>
                <rect x={p.y} y={p.x} width={p.d} height={p.w} fill={p.pallet.item.color} stroke={selected === p.n ? '#0ea5e9' : '#fff'} strokeWidth={selected === p.n ? 0.08 : 0.03} rx={0.04} />
                <text x={p.y + p.d / 2} y={p.x + p.w / 2} fontSize={0.3} textAnchor="middle" dominantBaseline="central" fill="#fff" fontWeight={700}>{p.n}</text>
              </g>
            ))}
          </svg>
        </div>
      ))}
      <div className="overflow-x-auto">
        <table className="w-full text-sm tabular-nums">
          <thead className="text-slate-500 text-xs">
            <tr className="text-left">{['#', 'Item', 'Caixas', 'Da cabine', 'Lateral', 'Nível'].map((h) => <th key={h} className="px-2 py-1 font-medium">{h}</th>)}</tr>
          </thead>
          <tbody>
            {load.placements.map((p) => (
              <tr key={p.n} onClick={() => onSelect(p.n)} className={`cursor-pointer border-t border-slate-100 ${selected === p.n ? 'bg-sky-50' : ''} ${step >= p.n ? '' : 'text-slate-400'}`}>
                <td className="px-2 py-1 font-semibold">{p.n}</td>
                <td className="px-2 py-1 whitespace-nowrap"><span className="inline-block w-2 h-2 rounded-full mr-2" style={{ background: p.pallet.item.color }} />{p.pallet.items.map((i) => i.name).join(' + ')}</td>
                <td className="px-2 py-1">{p.pallet.boxes.length}</td>
                <td className="px-2 py-1">{p.y.toFixed(2)} m</td>
                <td className="px-2 py-1">{p.x.toFixed(2)} m</td>
                <td className="px-2 py-1">{p.layer + 1}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
