import { useEffect, useRef, useState } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Edges, OrbitControls, TransformControls } from "@react-three/drei";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { Box } from "./model";

export type ViewKind = "3d" | "top" | "front" | "side";
export type ViewRequest = { kind: ViewKind; nonce: number };
export type GizmoMode = "translate" | "rotate";

const CM = 0.01; // 1 three.js unit = 1 m
const round1 = (v: number) => Math.round(v * 10) / 10;

type Props = {
  boxes: Box[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onDragStart: () => void;
  onDrag: (id: string, patch: Partial<Box>) => void;
  gizmo: GizmoMode;
  snapCm: number;
  showLabels: boolean;
  view: ViewRequest;
};

// Phones/tablets: lower resolution, no shadows — a Galaxy Fold kept losing its GPU context
const LOW_POWER = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;

export default function Scene(props: Props) {
  const lastDragEnd = useRef(0);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [contextLost, setContextLost] = useState(false);
  const [canvasKey, setCanvasKey] = useState(0);
  const losses = useRef<number[]>([]);

  // Mobile browsers drop WebGL contexts (e.g. when switching apps). Remount the canvas
  // with a fresh context instead of dying; only give up if it keeps happening.
  const onContextLost = () => {
    const now = Date.now();
    losses.current = [...losses.current.filter((t) => now - t < 30_000), now];
    if (losses.current.length > 3) {
      setContextLost(true);
      return;
    }
    const remount = () => {
      if (document.hidden) {
        document.addEventListener("visibilitychange", remount, { once: true });
        return;
      }
      setTimeout(() => setCanvasKey((k) => k + 1), 100);
    };
    remount();
  };
  const labelled = props.showLabels ? props.boxes : [];
  return (
    <div className="relative h-full w-full">
    <Canvas
      key={canvasKey}
      shadows={!LOW_POWER}
      // Render only on changes and cap the pixel ratio: continuous 60 fps at DPR 3 got the tab killed on phones
      frameloop="demand"
      dpr={LOW_POWER ? [1, 1.5] : [1, 2]}
      gl={{ powerPreference: "low-power" }}
      onCreated={({ gl }) => {
        gl.domElement.addEventListener("webglcontextlost", (e) => {
          e.preventDefault();
          onContextLost();
        });
      }}
      camera={{ position: [3, 2.4, 3.6], fov: 45, near: 0.05, far: 500 }}
      onPointerMissed={() => {
        if (performance.now() - lastDragEnd.current > 250) props.onSelect(null);
      }}
    >
      <color attach="background" args={["#e7e5e4"]} />
      <ambientLight intensity={0.9} />
      <hemisphereLight args={["#ffffff", "#a8a29e", 0.6]} />
      <directionalLight
        position={[6, 10, 4]}
        intensity={1.6}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-12}
        shadow-camera-right={12}
        shadow-camera-top={12}
        shadow-camera-bottom={-12}
        shadow-bias={-0.0004}
      />
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[200, 200]} />
        <shadowMaterial opacity={0.18} />
      </mesh>
      {/* Plain line grids: far cheaper on mobile GPUs than drei's full-screen <Grid> shader */}
      <gridHelper args={[20, 200, "#d6d3d1", "#d6d3d1"]} position={[0, 0.001, 0]}>
        <lineBasicMaterial attach="material" color="#a8a29e" transparent opacity={0.35} />
      </gridHelper>
      <gridHelper args={[20, 20, "#78716c", "#78716c"]} position={[0, 0.002, 0]} />
      <axesHelper args={[0.4]} position={[0, 0.002, 0]} />
      <SceneContent {...props} lastDragEnd={lastDragEnd} />
      <OrbitControls makeDefault maxPolarAngle={Math.PI / 2 - 0.01} />
      <LabelProjector boxes={props.boxes} overlay={overlayRef} visible={props.showLabels} />
    </Canvas>
      {contextLost && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-stone-200/95 p-6 text-center">
          <p className="max-w-sm text-sm text-stone-700">
            Die 3D-Ansicht wurde vom Browser mehrfach beendet (Grafikspeicher). Andere Tabs mit 3D-Inhalten schließen hilft;
            blockiert der Browser WebGL danach weiter, ihn einmal komplett neu starten.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="rounded-md bg-stone-800 px-4 py-2 text-sm font-medium text-white"
          >
            Neu laden
          </button>
        </div>
      )}
      <div ref={overlayRef} className="pointer-events-none absolute inset-0 overflow-hidden">
        {labelled.map((box) => {
          const selected = box.id === props.selectedId;
          return (
            <div key={box.id} data-id={box.id} className="absolute top-0 left-0" style={{ visibility: "hidden" }}>
              <div
                className={`-translate-x-1/2 -translate-y-full rounded px-1.5 py-0.5 text-center text-[11px] leading-tight whitespace-nowrap shadow ${
                  selected ? "bg-orange-600 text-white" : "bg-white/90 text-stone-800"
                }`}
              >
                {box.name && <div className="font-semibold">{box.name}</div>}
                <div>
                  {fmt(box.l)} × {fmt(box.b)} × {fmt(box.h)}
                </div>
                <div className="opacity-75">OK +{fmt(box.y + box.h)}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SceneContent({
  boxes,
  selectedId,
  onSelect,
  onDragStart,
  onDrag,
  gizmo,
  snapCm,
  showLabels,
  view,
  lastDragEnd,
}: Props & { lastDragEnd: React.RefObject<number> }) {
  const [selectedObj, setSelectedObj] = useState<THREE.Group | null>(null);
  const allRef = useRef<THREE.Group>(null);
  const selected = boxes.find((b) => b.id === selectedId) ?? null;

  const commitFromObject = () => {
    if (!selectedObj || !selected) return;
    const p = selectedObj.position;
    let rot = round1(THREE.MathUtils.radToDeg(selectedObj.rotation.y));
    rot = ((((rot + 180) % 360) + 360) % 360) - 180;
    onDrag(selected.id, {
      x: round1(p.x / CM),
      y: round1(p.y / CM),
      z: round1(p.z / CM),
      rot,
    });
  };

  return (
    <>
      <group ref={allRef}>
        {boxes.map((b) => (
          <BoxMesh
            key={b.id}
            box={b}
            selected={b.id === selectedId}
            onSelect={onSelect}
            registerObject={b.id === selectedId ? setSelectedObj : undefined}
          />
        ))}
      </group>
      {selected && selectedObj && (
        <TransformControls
          object={selectedObj}
          mode={gizmo}
          translationSnap={snapCm > 0 ? snapCm * CM : null}
          rotationSnap={THREE.MathUtils.degToRad(15)}
          showX={gizmo === "translate"}
          showZ={gizmo === "translate"}
          size={0.8}
          onMouseDown={onDragStart}
          onObjectChange={commitFromObject}
          onMouseUp={() => {
            lastDragEnd.current = performance.now();
            commitFromObject();
          }}
        />
      )}
      <CameraRig view={view} target={allRef} />
    </>
  );
}

function BoxMesh({
  box,
  selected,
  onSelect,
  registerObject,
}: {
  box: Box;
  selected: boolean;
  onSelect: (id: string) => void;
  registerObject?: (o: THREE.Group | null) => void;
}) {
  const ref = useRef<THREE.Group>(null);
  useEffect(() => {
    if (!registerObject) return;
    registerObject(ref.current);
    return () => registerObject(null);
  }, [registerObject]);

  const l = box.l * CM;
  const b = box.b * CM;
  const h = box.h * CM;
  // Shared unit cube scaled per box: resizing never allocates new GPU geometry

  return (
    <group
      ref={ref}
      position={[box.x * CM, box.y * CM, box.z * CM]}
      rotation={[0, THREE.MathUtils.degToRad(box.rot), 0]}
    >
      <mesh
        position={[l / 2, h / 2, b / 2]}
        scale={[l, h, b]}
        geometry={UNIT_BOX}
        castShadow
        receiveShadow
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          onSelect(box.id);
        }}
      >
        <meshStandardMaterial
          color={box.color}
          roughness={0.85}
          emissive={selected ? "#f97316" : "#000000"}
          emissiveIntensity={selected ? 0.12 : 0}
        />
        <Edges color={selected ? "#ea580c" : "#292524"} lineWidth={selected ? 2 : 1} />
      </mesh>
    </group>
  );
}

// Positions the DOM labels above each box every frame (drei <Html> renders empty with React 19)
function LabelProjector({
  boxes,
  overlay,
  visible,
}: {
  boxes: Box[];
  overlay: React.RefObject<HTMLDivElement | null>;
  visible: boolean;
}) {
  // frameloop is "demand": newly mounted labels need a frame to get positioned
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => invalidate(), [boxes, visible, invalidate]);
  const boxesRef = useRef(boxes);
  boxesRef.current = boxes;
  const v = useRef(new THREE.Vector3()).current;

  useFrame(({ camera, size }) => {
    const root = overlay.current;
    if (!root) return;
    const byId = new Map(boxesRef.current.map((b) => [b.id, b]));
    for (const el of Array.from(root.children) as HTMLElement[]) {
      const box = byId.get(el.dataset.id ?? "");
      if (!box) continue;
      const a = THREE.MathUtils.degToRad(box.rot);
      const lx = (box.l / 2) * CM;
      const lz = (box.b / 2) * CM;
      // rotate the top-center anchor around the reference corner (three.js Y rotation)
      v.set(
        box.x * CM + lx * Math.cos(a) + lz * Math.sin(a),
        (box.y + box.h) * CM + 0.03,
        box.z * CM - lx * Math.sin(a) + lz * Math.cos(a),
      ).project(camera);
      if (v.z > 1 || Math.abs(v.x) > 1.2 || Math.abs(v.y) > 1.2) {
        el.style.visibility = "hidden";
        continue;
      }
      el.style.visibility = "visible";
      el.style.transform = `translate(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px)`;
    }
  });
  return null;
}

const fmt = (v: number) => String(round1(v)).replace(".", ",");

const VIEW_DIRS: Record<ViewKind, THREE.Vector3> = {
  "3d": new THREE.Vector3(1, 0.85, 1.25).normalize(),
  top: new THREE.Vector3(0, 1, 0.0001).normalize(),
  front: new THREE.Vector3(0, 0.0001, 1).normalize(),
  side: new THREE.Vector3(1, 0.0001, 0).normalize(),
};

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);

// Survives canvas remounts so a recovered context keeps the user's camera
const cameraMemory = { pos: null as THREE.Vector3 | null, target: new THREE.Vector3(), nonce: -1 };

function CameraRig({ view, target }: { view: ViewRequest; target: React.RefObject<THREE.Group | null> }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    if (!controls) return;
    const save = () => {
      cameraMemory.pos = camera.position.clone();
      cameraMemory.target.copy(controls.target);
    };
    controls.addEventListener("change", save);
    return () => controls.removeEventListener("change", save);
  }, [controls, camera]);

  useEffect(() => {
    if (!controls || !target.current) return;
    if (cameraMemory.pos && cameraMemory.nonce === view.nonce) {
      camera.position.copy(cameraMemory.pos);
      controls.target.copy(cameraMemory.target);
      controls.update();
      invalidate();
      return;
    }
    cameraMemory.nonce = view.nonce;
    const bbox = new THREE.Box3().setFromObject(target.current);
    const sphere = new THREE.Sphere();
    if (bbox.isEmpty()) {
      sphere.center.set(0, 0.2, 0);
      sphere.radius = 1;
    } else {
      bbox.getBoundingSphere(sphere);
      sphere.radius = Math.max(sphere.radius, 0.8);
    }
    const fov = THREE.MathUtils.degToRad(camera.fov);
    const dist = (sphere.radius / Math.sin(Math.min(fov, fov * camera.aspect) / 2)) * 1.5;
    camera.position.copy(sphere.center).addScaledVector(VIEW_DIRS[view.kind], dist);
    controls.target.copy(sphere.center);
    controls.update();
    invalidate();
    // only react to explicit view requests
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.nonce, controls]);

  return null;
}
