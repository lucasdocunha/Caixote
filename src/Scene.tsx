import { Canvas, useFrame } from '@react-three/fiber';
import { Edges, Html, Instance, Instances, OrbitControls } from '@react-three/drei';
import { Color } from 'three';
import { Suspense, type ReactNode } from 'react';
import type { Box, Load, Pallet, Vehicle } from './pack';

const ease = (t: number) => 1 - (1 - t) ** 3;
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

export interface PlayerProps {
  total: number;
  playing: boolean;
  speed: number;
  setStep: (f: (s: number) => number) => void;
  setPlaying: (b: boolean) => void;
}

function Player({ total, playing, speed, setStep, setPlaying }: PlayerProps) {
  useFrame((_, dt) => {
    if (playing)
      setStep((s) => {
        const next = Math.min(total, s + dt * speed);
        if (next >= total) setPlaying(false);
        return next;
      });
  });
  return null;
}

function Stage({ children, camera, target, maxDistance, player }: { children: ReactNode; camera: [number, number, number]; target: [number, number, number]; maxDistance: number; player: PlayerProps }) {
  return (
    <Canvas shadows camera={{ position: camera, fov: 40 }} dpr={[1, 2]}>
      <color attach="background" args={['#f8fafc']} />
      <ambientLight intensity={0.9} />
      <directionalLight position={[6, 12, 8]} intensity={1.4} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-10} shadow-camera-right={10} shadow-camera-top={10} shadow-camera-bottom={-10} />
      <OrbitControls makeDefault target={target} minDistance={1.5} maxDistance={maxDistance} maxPolarAngle={Math.PI / 2.1} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.03, 0]} receiveShadow>
        <circleGeometry args={[maxDistance, 64]} />
        <meshStandardMaterial color="#e2e8f0" />
      </mesh>
      <Suspense fallback={null}>{children}</Suspense>
      <Player {...player} />
    </Canvas>
  );
}

/** A pallet with its boxes, origin at the pallet's corner. `shown` = boxes visible (fractional → last one dropping). */
function PalletModel({ p, rotated = false, shown = Infinity, highlight = false }: { p: Pallet; rotated?: boolean; shown?: number; highlight?: boolean }) {
  const [W, D] = rotated ? [p.depth, p.width] : [p.width, p.depth];
  const baseH = p.boxes[0]?.z ?? 0.15;
  const levels = [...new Set(p.boxes.map((b) => b.z))].sort((a, b) => a - b);
  const tint = (b: Box) => { // even layers lighter → amarração is visible
    const c = new Color(b.item.color);
    return levels.indexOf(b.z) % 2 ? c.lerp(new Color('#ffffff'), 0.35) : c;
  };
  return (
    <group>
      <mesh position={[W / 2, baseH / 2, D / 2]} castShadow receiveShadow>
        <boxGeometry args={[W, baseH, D]} />
        <meshStandardMaterial color="#b45309" roughness={0.9} />
        {highlight && <Edges color="#0ea5e9" scale={1.02} />}
      </mesh>
      <Instances limit={p.boxes.length} castShadow receiveShadow>
        <boxGeometry />
        <meshStandardMaterial roughness={0.6} />
        {p.boxes.map((b, i) => {
          const t = clamp01(shown - i);
          if (!t) return null;
          const [x, y, w, d] = rotated ? [b.y, b.x, b.d, b.w] : [b.x, b.y, b.w, b.d];
          return (
            <Instance
              key={i}
              position={[x + w / 2, b.z + b.h / 2 + 0.6 * (1 - ease(t)), y + d / 2]}
              scale={[w * 0.97, b.h * 0.97, d * 0.97]}
              color={tint(b)}
            />
          );
        })}
      </Instances>
    </group>
  );
}

// DOM labels: no font download (the drei <Text> fetches one, which sandboxed hosts block)
function Label({ position, className, children }: { position: [number, number, number]; className: string; children: ReactNode }) {
  return (
    <Html position={position} center className={`pointer-events-none select-none text-xs font-semibold ${className}`}>
      {children}
    </Html>
  );
}

export function PalletScene({ pallet, step, player }: { pallet: Pallet; step: number; player: PlayerProps }) {
  const s = Math.max(pallet.width, pallet.depth, pallet.height);
  return (
    <Stage camera={[s * 1.6, s * 1.5, s * 1.9]} target={[0, pallet.height / 2.5, 0]} maxDistance={s * 5} player={player}>
      <group position={[-pallet.width / 2, 0, -pallet.depth / 2]}>
        <PalletModel p={pallet} shown={step} />
      </group>
    </Stage>
  );
}

export function TruckScene({ v, load, step, selected, onSelect, player }: { v: Vehicle; load: Load; step: number; selected: number | null; onSelect: (n: number) => void; player: PlayerProps }) {
  return (
    <Stage camera={[v.width * 2.5, v.height * 3, v.depth / 2 + 5]} target={[0, v.height / 3, 0]} maxDistance={v.depth * 1.6 + 6} player={player}>
      <mesh position={[0, -0.015, 0]} receiveShadow>
        <boxGeometry args={[v.width, 0.03, v.depth]} />
        <meshStandardMaterial color="#cbd5e1" />
      </mesh>
      <mesh position={[0, v.height / 2, 0]}>
        <boxGeometry args={[v.width, v.height, v.depth]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        <Edges color="#64748b" />
      </mesh>
      <mesh position={[0, v.height / 2, v.depth / 2]}>
        <planeGeometry args={[v.width, v.height]} />
        <meshBasicMaterial color="#f59e0b" transparent opacity={0.08} depthWrite={false} />
        <Edges color="#f59e0b" />
      </mesh>
      <Label position={[0, v.height + 0.3, v.depth / 2]} className="text-amber-600">PORTA</Label>
      <Label position={[0, v.height + 0.3, -v.depth / 2]} className="text-slate-400">CABINE</Label>

      {load.placements.map((p) => {
        const t = ease(clamp01(step - (p.n - 1)));
        if (!t) return null;
        const outside = v.depth + 2; // slides in through the door
        return (
          <group
            key={p.n}
            position={[p.x - v.width / 2, p.z + 0.25 * (1 - t), outside + (p.y - outside) * t - v.depth / 2]}
            onClick={(e) => (e.stopPropagation(), onSelect(p.n))}
          >
            <PalletModel p={p.pallet} rotated={p.rotated} highlight={selected === p.n} />
            <Label position={[p.w / 2, p.h + 0.05, p.d / 2]} className="rounded-full bg-white/90 px-1.5 text-slate-800 shadow">
              {p.n}
            </Label>
          </group>
        );
      })}
    </Stage>
  );
}
