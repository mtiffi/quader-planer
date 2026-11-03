// All dimensions and positions in cm, rotation in degrees around the vertical axis.
// Position (x, y, z) is the reference corner: bottom, left, front.
export type Box = {
  id: string;
  name: string;
  l: number; // Laenge, along x
  b: number; // Breite, along z
  h: number; // Hoehe, along y
  x: number;
  y: number;
  z: number;
  rot: number;
  color: string; // hex with leading #
};

export const DEFAULT_COLOR = "#9ca3af";

export const PRESET_COLORS = [
  "#9ca3af", // grau
  "#57534e", // anthrazit
  "#d6d3d1", // hellgrau
  "#c2a37a", // sandstein
  "#a16207", // ocker
  "#9a3412", // klinker
  "#7c4a2d", // holz
  "#4d7c0f", // gruen
  "#1d4ed8", // blau
];

let counter = 0;
export const newId = () => `${Date.now().toString(36)}-${(counter++).toString(36)}`;

export function createBox(partial: Partial<Box> = {}): Box {
  return {
    id: newId(),
    name: "",
    l: 60,
    b: 100,
    h: 40,
    x: 0,
    y: 0,
    z: 0,
    rot: 0,
    color: DEFAULT_COLOR,
    ...partial,
  };
}

// --- URL codec -------------------------------------------------------------
// ?q=l,b,h,x,y,z,rot,color,name~l,b,h,...   (compact and human-readable)

const BOX_SEP = "~";
const FIELD_SEP = ",";

const num = (n: number) => String(Math.round(n * 10) / 10);

export function encodeBoxes(boxes: Box[]): string {
  return boxes
    .map((bx) =>
      [
        num(bx.l),
        num(bx.b),
        num(bx.h),
        num(bx.x),
        num(bx.y),
        num(bx.z),
        num(bx.rot),
        bx.color.replace("#", ""),
        encodeURIComponent(bx.name).replace(/~/g, "%7E"),
      ]
        .join(FIELD_SEP)
        .replace(/,$/, ""),
    )
    .join(BOX_SEP);
}

export function decodeBoxes(q: string): Box[] {
  const boxes: Box[] = [];
  for (const part of q.split(BOX_SEP)) {
    const f = part.split(FIELD_SEP);
    if (f.length < 6) continue;
    const n = (i: number, fallback: number) => {
      const v = parseFloat(f[i]);
      return Number.isFinite(v) ? v : fallback;
    };
    const color = /^[0-9a-fA-F]{6}$/.test(f[7] ?? "") ? `#${f[7].toLowerCase()}` : DEFAULT_COLOR;
    let name = "";
    try {
      name = decodeURIComponent(f.slice(8).join(FIELD_SEP));
    } catch {
      name = "";
    }
    boxes.push(
      createBox({
        l: Math.max(1, n(0, 60)),
        b: Math.max(1, n(1, 100)),
        h: Math.max(1, n(2, 40)),
        x: n(3, 0),
        y: n(4, 0),
        z: n(5, 0),
        rot: n(6, 0),
        color,
        name,
      }),
    );
  }
  return boxes;
}

export function readBoxesFromUrl(): Box[] | null {
  const q = new URLSearchParams(window.location.search).get("q");
  if (q === null) return null;
  return decodeBoxes(q);
}

export function buildShareUrl(boxes: Box[]): string {
  const url = new URL(window.location.href);
  url.hash = "";
  if (boxes.length) url.searchParams.set("q", encodeBoxes(boxes));
  else url.searchParams.delete("q");
  // URLSearchParams encodes "," and "~" — keep them readable
  return url.toString().replace(/%2C/gi, ",").replace(/%7E/gi, "~");
}

export const volumeM3 = (bx: Box) => (bx.l * bx.b * bx.h) / 1_000_000;
