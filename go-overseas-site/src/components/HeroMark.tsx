// @ts-nocheck
"use client";
// components/HeroMark.tsx
// go overseas — 3D hero logo mark (react-three-fiber)
//
// Production version of the hero mark from the static site, as a clean React
// component: the open ring (C), the green growth corner, and the blue dot,
// auto-rotating + floating + tilting toward the cursor/touch, lit in the brand
// palette. Respects prefers-reduced-motion.
//
// Deps:  three  @react-three/fiber  @react-three/drei
//   npm i three @react-three/fiber @react-three/drei
//
// Next.js: WebGL is client-only. Import it without SSR:
//   import dynamic from "next/dynamic";
//   const HeroMark = dynamic(() => import("@/components/HeroMark"), { ssr: false });
//
// GLB swap (pixel-exact logo): export your mark to /public/logo.glb and use the
// <GlbMark/> path at the bottom instead of <PrimitiveMark/>.

import { Canvas, useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import type * as THREE from "three";

const BRAND = {
  ring: "#EEF2F7",
  green: "#32C46A",
  blue: "#00AEEF",
  purple: "#6C3EF4",
} as const;

function PrimitiveMark() {
  const outer = useRef<THREE.Group>(null!); // pointer tilt + float
  const spin = useRef<THREE.Group>(null!); // continuous auto-rotation

  const reduce = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  useFrame((state, delta) => {
    if (!outer.current || !spin.current) return;
    const t = state.clock.elapsedTime;
    const px = state.pointer.x; // -1..1 across the canvas
    const py = state.pointer.y; // -1..1 (up is +)

    // ease the whole mark toward the pointer
    outer.current.rotation.y += (px * 0.5 - outer.current.rotation.y) * 0.06;
    outer.current.rotation.x +=
      (-0.12 - py * 0.4 - outer.current.rotation.x) * 0.06;

    // auto-rotate + gentle float
    if (!reduce) {
      spin.current.rotation.y += delta * 0.35;
      outer.current.position.y = Math.sin(t * 1.1) * 0.06;
    }
  });

  return (
    <group ref={outer} position={[-0.42, 0, 0]}>
      <group ref={spin}>
        {/* open ring (the C) — gap faces right */}
        <mesh rotation={[0, 0, Math.PI / 4]}>
          <torusGeometry args={[1.15, 0.33, 24, 120, Math.PI * 1.5]} />
          <meshStandardMaterial color={BRAND.ring} metalness={0.32} roughness={0.34} />
        </mesh>
        {/* green growth corner: horizontal bar + vertical bar */}
        <mesh position={[0.5, 0.36, 0]}>
          <boxGeometry args={[0.92, 0.42, 0.42]} />
          <meshStandardMaterial color={BRAND.green} metalness={0.15} roughness={0.45} />
        </mesh>
        <mesh position={[0.92, -0.06, 0]}>
          <boxGeometry args={[0.42, 1.0, 0.42]} />
          <meshStandardMaterial color={BRAND.green} metalness={0.15} roughness={0.45} />
        </mesh>
        {/* dot */}
        <mesh position={[0.32, -1.16, 0]}>
          <sphereGeometry args={[0.28, 32, 32]} />
          <meshStandardMaterial color={BRAND.blue} metalness={0.35} roughness={0.28} />
        </mesh>
      </group>
    </group>
  );
}

export default function HeroMark({
  className,
  height = 300,
}: {
  className?: string;
  height?: number;
}) {
  return (
    <div
      className={className}
      style={{ width: "100%", maxWidth: 360, height, margin: "0 auto", position: "relative" }}
    >
      <Canvas
        camera={{ position: [0, 0, 7], fov: 38 }}
        dpr={[1, 2]}
        gl={{ alpha: true, antialias: true }}
        style={{ width: "100%", height: "100%" }}
      >
        <ambientLight intensity={0.6} />
        <directionalLight position={[3, 4, 5]} intensity={0.95} />
        <pointLight position={[-5, 2, 4]} intensity={1.0} distance={30} color={BRAND.blue} />
        <pointLight position={[4, -3, 3]} intensity={0.9} distance={30} color={BRAND.purple} />
        <PrimitiveMark />
      </Canvas>
    </div>
  );
}

/* ----------------------------------------------------------------------------
   GLB path (pixel-exact). Export your logo to /public/logo.glb, then replace
   <PrimitiveMark/> above with <GlbMark/> and keep the same lights + animation.

   import { useGLTF } from "@react-three/drei";
   function GlbMark() {
     const outer = useRef<THREE.Group>(null!);
     const { scene } = useGLTF("/logo.glb");
     useFrame((state, delta) => {
       if (!outer.current) return;
       const px = state.pointer.x, py = state.pointer.y;
       outer.current.rotation.y += (px * 0.5 - outer.current.rotation.y) * 0.06;
       outer.current.rotation.x += (-0.12 - py * 0.4 - outer.current.rotation.x) * 0.06;
       outer.current.rotation.y += delta * 0.35;
     });
     return <primitive ref={outer} object={scene} />;
   }
   useGLTF.preload("/logo.glb");
---------------------------------------------------------------------------- */
