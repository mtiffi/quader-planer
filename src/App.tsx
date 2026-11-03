import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Scene, { type GizmoMode, type ViewKind, type ViewRequest } from "./Scene";
import {
  PRESET_COLORS,
  buildShareUrl,
  DEFAULT_SCENE,
  createBox,
  decodeBoxes,
  readBoxesFromUrl,
  volumeM3,
  type Box,
} from "./model";

const HISTORY_LIMIT = 200;

function initialBoxes(): Box[] {
  return readBoxesFromUrl() ?? decodeBoxes(DEFAULT_SCENE);
}

export default function App() {
  const [boxes, setBoxesRaw] = useState<Box[]>(initialBoxes);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [gizmo, setGizmo] = useState<GizmoMode>("translate");
  const [snapCm, setSnapCm] = useState(5);
  const [showLabels, setShowLabels] = useState(true);
  // List is always visible on desktop; on mobile it starts collapsed to leave room for the editor
  const [listOpen, setListOpen] = useState(() => window.matchMedia("(min-width: 768px)").matches);
  const [view, setView] = useState<ViewRequest>({ kind: "3d", nonce: 0 });
  const [toast, setToast] = useState<string | null>(null);

  const past = useRef<Box[][]>([]);
  const future = useRef<Box[][]>([]);
  const [, forceRender] = useState(0);
  const boxesRef = useRef(boxes);
  boxesRef.current = boxes;

  const record = useCallback(() => {
    past.current.push(boxesRef.current);
    if (past.current.length > HISTORY_LIMIT) past.current.shift();
    future.current = [];
    forceRender((n) => n + 1);
  }, []);

  // Recorded change: pushes an undo step
  const commit = useCallback(
    (next: Box[]) => {
      record();
      setBoxesRaw(next);
    },
    [record],
  );

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(boxesRef.current);
    setBoxesRaw(prev);
  }, []);

  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(boxesRef.current);
    setBoxesRaw(next);
  }, []);

  // Keep URL in sync so a reload or copy from the address bar works too
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        window.history.replaceState(null, "", buildShareUrl(boxes));
      } catch {
        // Safari rate-limits replaceState; the next change will try again
      }
    }, 500);
    return () => clearTimeout(t);
  }, [boxes]);

  const selected = boxes.find((b) => b.id === selectedId) ?? null;

  const updateSelected = (patch: Partial<Box>) => {
    if (!selected) return;
    commit(boxes.map((b) => (b.id === selected.id ? { ...b, ...patch } : b)));
  };

  // Live drag updates are transient; the undo step is recorded on drag start
  const onDrag = useCallback((id: string, patch: Partial<Box>) => {
    setBoxesRaw((bs) => bs.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }, []);

  const addBox = () => {
    const maxX = boxes.reduce((m, b) => Math.max(m, b.x + b.l), -Infinity);
    const box = createBox(
      selected
        ? { ...selected, id: undefined, name: "", x: maxX + 20, y: 0 }
        : { x: boxes.length ? maxX + 20 : 0 },
    );
    box.id = createBox().id;
    commit([...boxes, box]);
    setSelectedId(box.id);
  };

  const removeSelected = useCallback(() => {
    if (!selectedId) return;
    commit(boxesRef.current.filter((b) => b.id !== selectedId));
    setSelectedId(null);
  }, [selectedId, commit]);

  const share = async () => {
    const url = buildShareUrl(boxes);
    try {
      if (navigator.share && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) {
        await navigator.share({ title: "Quader-Planer", url });
        return;
      }
      await navigator.clipboard.writeText(url);
      flash("Link kopiert");
    } catch {
      window.prompt("Link zum Teilen:", url);
    }
  };

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1800);
  };

  const requestView = (kind: ViewKind) => setView((v) => ({ kind, nonce: v.nonce + 1 }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        removeSelected();
      } else if (e.key === "Escape") {
        setSelectedId(null);
      } else if (e.key === "g") {
        setGizmo("translate");
      } else if (e.key === "r") {
        setGizmo("rotate");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, removeSelected]);

  const totalVolume = useMemo(() => boxes.reduce((s, b) => s + volumeM3(b), 0), [boxes]);
  const topEdge = useMemo(() => boxes.reduce((m, b) => Math.max(m, b.y + b.h), 0), [boxes]);

  return (
    <div className="flex h-full flex-col-reverse text-stone-800 md:flex-row">
      <aside className="flex max-h-[46vh] w-full shrink-0 flex-col overflow-y-auto border-t border-stone-300 bg-stone-50 md:max-h-none md:w-80 md:border-r md:border-t-0">
        <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-stone-200 bg-stone-50/95 px-3 py-2 backdrop-blur">
          <h1 className="mr-auto text-base font-semibold">Quader-Planer</h1>
          <IconBtn title="Rückgängig (Strg+Z)" onClick={undo} disabled={!past.current.length}>
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-3" /></svg>
          </IconBtn>
          <IconBtn title="Wiederholen (Strg+Y)" onClick={redo} disabled={!future.current.length}>
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="m15 14 5-5-5-5" /><path d="M20 9H9a5 5 0 0 0 0 10h3" /></svg>
          </IconBtn>
          <button
            onClick={share}
            className="rounded-md bg-stone-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-stone-700"
          >
            Teilen
          </button>
        </header>

        <div className="space-y-4 p-3">
          <section>
            <div className="mb-1.5 flex items-center justify-between">
              <button
                onClick={() => setListOpen((v) => !v)}
                className="flex items-center gap-1 text-xs font-semibold tracking-wide text-stone-500 uppercase md:pointer-events-none"
              >
                <svg
                  viewBox="0 0 24 24"
                  className={`size-4 transition-transform md:hidden ${listOpen ? "rotate-90" : ""}`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="m9 6 6 6-6 6" />
                </svg>
                Quader ({boxes.length})
              </button>
              <button
                onClick={addBox}
                className="rounded-md bg-orange-600 px-2.5 py-1 text-sm font-medium text-white hover:bg-orange-500"
              >
                + Quader
              </button>
            </div>
            <ul className={`space-y-1 ${listOpen ? "" : "hidden md:block"}`}>
              {boxes.map((b, i) => (
                <li key={b.id}>
                  <button
                    onClick={() => setSelectedId(b.id === selectedId ? null : b.id)}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${
                      b.id === selectedId ? "bg-orange-100 ring-1 ring-orange-400" : "hover:bg-stone-200/70"
                    }`}
                  >
                    <span className="size-4 shrink-0 rounded border border-stone-400" style={{ background: b.color }} />
                    <span className="truncate">{b.name || `Quader ${i + 1}`}</span>
                    <span className="ml-auto shrink-0 text-xs text-stone-500 tabular-nums">
                      {b.l}×{b.b}×{b.h}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {boxes.length > 0 && (
              <p className="mt-2 text-xs text-stone-500">
                Volumen gesamt {totalVolume.toFixed(3).replace(".", ",")} m³ · höchste Oberkante {topEdge} cm
              </p>
            )}
          </section>

          {selected ? (
            <BoxEditor
              key={selected.id}
              box={selected}
              index={boxes.indexOf(selected)}
              onChange={updateSelected}
              onDelete={removeSelected}
              onDuplicateRow={(count, dx, dy, dz) => {
                const copies: Box[] = [];
                for (let k = 1; k <= count; k++) {
                  copies.push({
                    ...selected,
                    id: createBox().id,
                    name: numberedName(selected.name, k),
                    x: selected.x + dx * k,
                    y: selected.y + dy * k,
                    z: selected.z + dz * k,
                  });
                }
                commit([...boxes, ...copies]);
                setSelectedId(copies[copies.length - 1]?.id ?? selected.id);
              }}
            />
          ) : (
            <p className="rounded-md bg-stone-200/60 p-3 text-sm text-stone-600">
              Quader in der Liste oder in der 3D-Ansicht antippen, um Maße, Position und Farbe zu bearbeiten.
            </p>
          )}

          <section className="space-y-2 border-t border-stone-200 pt-3">
            <h2 className="text-xs font-semibold tracking-wide text-stone-500 uppercase">Einstellungen</h2>
            <Row label="Ziehen">
              <Segmented
                value={gizmo}
                options={[
                  ["translate", "Verschieben"],
                  ["rotate", "Drehen"],
                ]}
                onChange={(v) => setGizmo(v as GizmoMode)}
              />
            </Row>
            <Row label="Raster">
              <Segmented
                value={String(snapCm)}
                options={[
                  ["0", "aus"],
                  ["1", "1"],
                  ["5", "5"],
                  ["10", "10 cm"],
                ]}
                onChange={(v) => setSnapCm(Number(v))}
              />
            </Row>
            <p className="text-xs leading-relaxed text-stone-500">
              Alle Maße in cm. Position = Ecke unten/links/hinten. Länge läuft in X, Breite in Z, Höhe in Y. Rasterlinien:
              10 cm fein, 1 m kräftig. „OK" = Oberkante über Boden.
            </p>
          </section>
        </div>
      </aside>

      <main className="relative min-h-0 flex-1">
        <Scene
          boxes={boxes}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onDragStart={record}
          onDrag={onDrag}
          gizmo={gizmo}
          snapCm={snapCm}
          showLabels={showLabels}
          view={view}
        />
        <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-end p-2">
          <div className="pointer-events-auto flex gap-1 rounded-lg bg-white/85 p-1 shadow backdrop-blur">
            {(
              [
                ["3d", "3D"],
                ["top", "Oben"],
                ["front", "Vorne"],
                ["side", "Seite"],
              ] as [ViewKind, string][]
            ).map(([k, label]) => (
              <button
                key={k}
                onClick={() => requestView(k)}
                className="rounded-md px-2.5 py-1 text-sm hover:bg-stone-200"
              >
                {label}
              </button>
            ))}
            <span className="mx-0.5 w-px bg-stone-300" />
            <button
              onClick={() => setShowLabels((v) => !v)}
              title={showLabels ? "Beschriftungen ausblenden" : "Beschriftungen einblenden"}
              className={`rounded-md px-2.5 py-1 text-sm ${showLabels ? "bg-stone-800 text-white" : "hover:bg-stone-200"}`}
            >
              Maße
            </button>
          </div>
        </div>
        {toast && (
          <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
            <div className="rounded-md bg-stone-900/90 px-3 py-1.5 text-sm text-white shadow">{toast}</div>
          </div>
        )}
      </main>
    </div>
  );
}

// "Stufe 1" + 2 -> "Stufe 3"; "Block" + 1 -> "Block 2"
function numberedName(name: string, offset: number): string {
  if (!name) return "";
  const m = name.match(/^(.*?)(\d+)$/);
  if (m) return `${m[1]}${Number(m[2]) + offset}`;
  return `${name} ${offset + 1}`;
}

function BoxEditor({
  box,
  index,
  onChange,
  onDelete,
  onDuplicateRow,
}: {
  box: Box;
  index: number;
  onChange: (patch: Partial<Box>) => void;
  onDelete: () => void;
  onDuplicateRow: (count: number, dx: number, dy: number, dz: number) => void;
}) {
  const [count, setCount] = useState(1);
  const [dx, setDx] = useState(box.l);
  const [dy, setDy] = useState(box.h);
  const [dz, setDz] = useState(0);

  return (
    <section className="space-y-3 rounded-lg border border-orange-300 bg-white p-3 shadow-sm">
      <input
        value={box.name}
        placeholder={`Quader ${index + 1}`}
        onChange={(e) => onChange({ name: e.target.value })}
        className="w-full rounded-md border border-stone-300 px-2 py-1 text-sm font-medium"
      />

      <Group title="Maße (cm)">
        <NumberField label="Länge" value={box.l} min={1} onCommit={(l) => onChange({ l })} />
        <NumberField label="Breite" value={box.b} min={1} onCommit={(b) => onChange({ b })} />
        <NumberField label="Höhe" value={box.h} min={1} onCommit={(h) => onChange({ h })} />
      </Group>

      <Group title="Position (cm)">
        <NumberField label="X" value={box.x} onCommit={(x) => onChange({ x })} />
        <NumberField label="Y (unten)" value={box.y} onCommit={(y) => onChange({ y })} />
        <NumberField label="Z" value={box.z} onCommit={(z) => onChange({ z })} />
      </Group>

      <div className="grid grid-cols-3 gap-2">
        <NumberField label="Drehung °" value={box.rot} onCommit={(rot) => onChange({ rot })} />
        <div className="col-span-2 flex items-end gap-1">
          {[0, 90].map((r) => (
            <button
              key={r}
              onClick={() => onChange({ rot: r })}
              className="rounded-md border border-stone-300 px-2 py-1 text-xs hover:bg-stone-100"
            >
              {r}°
            </button>
          ))}
          <button
            onClick={() => onChange({ y: 0 })}
            className="rounded-md border border-stone-300 px-2 py-1 text-xs hover:bg-stone-100"
          >
            auf Boden
          </button>
        </div>
      </div>

      <div>
        <div className="mb-1 text-xs text-stone-500">Farbe</div>
        <div className="flex flex-wrap items-center gap-1.5">
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              title={c}
              onClick={() => onChange({ color: c })}
              className={`size-6 rounded border ${
                box.color === c ? "border-orange-600 ring-2 ring-orange-400" : "border-stone-400"
              }`}
              style={{ background: c }}
            />
          ))}
          <input
            type="color"
            value={box.color}
            onChange={(e) => onChange({ color: e.target.value })}
            className="h-6 w-8 cursor-pointer rounded border border-stone-400 bg-transparent p-0"
            title="Eigene Farbe"
          />
        </div>
      </div>

      <details className="rounded-md bg-stone-100 p-2">
        <summary className="cursor-pointer text-sm font-medium">Kopieren / Reihe (z.B. Stufen)</summary>
        <div className="mt-2 space-y-2">
          <p className="text-xs text-stone-500">
            Erzeugt Kopien mit festem Versatz je Kopie. Für Stufen z.B. X = Auftritt, Y = Steigung.
          </p>
          <div className="grid grid-cols-4 gap-2">
            <NumberField label="Anzahl" value={count} min={1} onCommit={(v) => setCount(Math.min(50, Math.round(v)))} />
            <NumberField label="ΔX" value={dx} onCommit={setDx} />
            <NumberField label="ΔY" value={dy} onCommit={setDy} />
            <NumberField label="ΔZ" value={dz} onCommit={setDz} />
          </div>
          <button
            onClick={() => onDuplicateRow(count, dx, dy, dz)}
            className="w-full rounded-md bg-stone-800 px-2 py-1.5 text-sm font-medium text-white hover:bg-stone-700"
          >
            {count === 1 ? "Kopie erzeugen" : `${count} Kopien erzeugen`}
          </button>
        </div>
      </details>

      <button
        onClick={onDelete}
        className="w-full rounded-md border border-red-300 px-2 py-1.5 text-sm text-red-700 hover:bg-red-50"
      >
        Quader löschen
      </button>
    </section>
  );
}

function NumberField({
  label,
  value,
  min,
  onCommit,
}: {
  label: string;
  value: number;
  min?: number;
  onCommit: (v: number) => void;
}) {
  const [text, setText] = useState(String(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(String(value));
  }, [value]);

  const parse = (s: string) => {
    const v = parseFloat(s.replace(",", "."));
    if (!Number.isFinite(v)) return null;
    return min !== undefined ? Math.max(min, v) : v;
  };

  return (
    <label className="block min-w-0">
      <span className="mb-0.5 block truncate text-xs text-stone-500">{label}</span>
      <input
        inputMode="decimal"
        value={text}
        onFocus={(e) => {
          focused.current = true;
          e.target.select();
        }}
        onChange={(e) => {
          setText(e.target.value);
          const v = parse(e.target.value);
          if (v !== null && v !== value) onCommit(v);
        }}
        onBlur={() => {
          focused.current = false;
          setText(String(value));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className="w-full rounded-md border border-stone-300 px-2 py-1 text-sm tabular-nums"
      />
    </label>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-stone-600">{title}</div>
      <div className="grid grid-cols-3 gap-2">{children}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 shrink-0 text-sm text-stone-600">{label}</span>
      {children}
    </div>
  );
}

function Segmented({
  value,
  options,
  onChange,
}: {
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-1 rounded-md bg-stone-200 p-0.5">
      {options.map(([v, label]) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={`flex-1 rounded px-2 py-1 text-xs ${value === v ? "bg-white font-medium shadow-sm" : "text-stone-600"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function IconBtn({
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { children: React.ReactNode }) {
  return (
    <button
      {...rest}
      className="rounded-md px-2 py-1 text-lg leading-none text-stone-700 hover:bg-stone-200 disabled:opacity-30"
    >
      {children}
    </button>
  );
}
