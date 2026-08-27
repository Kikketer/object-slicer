import * as fs from "fs";
import * as path from "path";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { MaxRectsPacker } from "maxrects-packer";
import polygonClipping from "polygon-clipping";

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

export interface LoadedMesh {
  positions: Float32Array;
  indices: Uint32Array;
}

export interface Piece {
  id: string;
  base_id: string;
  axis: "x" | "y" | "z";
  position: number;
  thickness: number;
  rings: Vec2[][];
  transform: number[][];
  bounds: { min: Vec2; max: Vec2 };
  width: number;
  height: number;
}

export interface SliceOptions {
  stlPath: string;
  output: string;
  mode: "stacked" | "interlocking";
  thickness: number;
  count: number;
  sheet: [number, number];
  margin?: number;
  spacing?: number;
  scale?: number;
}

export interface SliceResult {
  ok: boolean;
  error?: string;
  output?: string;
  sheets?: number;
  parts?: number;
  info?: unknown;
  sheetsDir?: string;
  preview?: unknown;
}

export function loadStl(buffer: ArrayBuffer, scale = 1.0): LoadedMesh {
  const geometry = new STLLoader().parse(buffer);
  const positions = (geometry as any).attributes.position.array as Float32Array;
  const indexAttr = (geometry as any).index;

  if (scale !== 1.0) {
    for (let i = 0; i < positions.length; i++) positions[i] *= scale;
  }

  let indices: Uint32Array;
  if (indexAttr?.array) {
    indices = new Uint32Array(indexAttr.array);
  } else {
    const n = positions.length / 3;
    indices = new Uint32Array(n);
    for (let i = 0; i < n; i++) indices[i] = i;
  }

  return { positions, indices };
}

export function computeBounds(positions: Float32Array): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let j = 0; j < 3; j++) {
      const v = positions[i + j];
      if (v < min[j]) min[j] = v;
      if (v > max[j]) max[j] = v;
    }
  }
  return { min, max };
}

function lerp(a: number, b: number, t: number): number {
  return a + t * (b - a);
}

function interpPoint(
  positions: Float32Array,
  i: number,
  j: number,
  di: number,
  dj: number,
  wAxis: number,
): Vec3 {
  const t = di / (di - dj);
  const ix = i * 3;
  const jx = j * 3;
  const p: Vec3 = [0, 0, 0];
  for (let a = 0; a < 3; a++) {
    p[a] = lerp(positions[ix + a], positions[jx + a], t);
  }
  return p;
}

function pointKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

function dist2(p: Vec2, q: Vec2): number {
  const dx = p[0] - q[0];
  const dy = p[1] - q[1];
  return dx * dx + dy * dy;
}

class PointHash {
  private grid = new Map<string, number[]>();
  private points: Vec2[] = [];
  private cellSize: number;

  constructor(cellSize = 1e-5) {
    this.cellSize = cellSize;
  }

  insertOrFind(p: Vec2): number {
    const cx = Math.floor(p[0] / this.cellSize);
    const cy = Math.floor(p[1] / this.cellSize);
    const tol2 = (this.cellSize * 1.5) ** 2;

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const key = pointKey(cx + dx, cy + dy);
        const bucket = this.grid.get(key);
        if (!bucket) continue;
        for (const idx of bucket) {
          if (dist2(this.points[idx], p) < tol2) return idx;
        }
      }
    }

    const idx = this.points.length;
    this.points.push(p);
    const key = pointKey(cx, cy);
    const bucket = this.grid.get(key);
    if (bucket) bucket.push(idx);
    else this.grid.set(key, [idx]);
    return idx;
  }

  getPoint(idx: number): Vec2 {
    return this.points[idx];
  }

  length(): number {
    return this.points.length;
  }
}

function uv(p: Vec3, uAxis: number, vAxis: number): Vec2 {
  return [p[uAxis], p[vAxis]];
}

export function sliceMesh(
  positions: Float32Array,
  indices: Uint32Array,
  wValue: number,
  wAxis: number,
  uAxis: number,
  vAxis: number,
  eps = 1e-9,
): Vec2[][] {
  const segments: [number, number][] = [];
  const hasher = new PointHash();

  for (let t = 0; t < indices.length; t += 3) {
    const i = indices[t];
    const j = indices[t + 1];
    const k = indices[t + 2];

    const di = positions[i * 3 + wAxis] - wValue;
    const dj = positions[j * 3 + wAxis] - wValue;
    const dk = positions[k * 3 + wAxis] - wValue;

    const si = Math.abs(di) < eps ? 0 : Math.sign(di);
    const sj = Math.abs(dj) < eps ? 0 : Math.sign(dj);
    const sk = Math.abs(dk) < eps ? 0 : Math.sign(dk);

    const signs = [si, sj, sk];
    const zeros = signs.filter((s) => s === 0).length;

    let a: Vec3 | null = null;
    let b: Vec3 | null = null;

    if (zeros === 0) {
      if (si === sj && sj === sk) continue;

      let o: number;
      if (si !== sj && si !== sk) o = 0;
      else if (sj !== si && sj !== sk) o = 1;
      else o = 2;

      const others = [0, 1, 2].filter((x) => x !== o) as [number, number];
      const idxs = [i, j, k];
      const ds = [di, dj, dk];
      a = interpPoint(positions, idxs[o], idxs[others[0]], ds[o], ds[others[0]], wAxis);
      b = interpPoint(positions, idxs[o], idxs[others[1]], ds[o], ds[others[1]], wAxis);
    } else if (zeros === 1) {
      const o = signs.findIndex((s) => s === 0);
      const others = [0, 1, 2].filter((x) => x !== o) as [number, number];

      if (signs[others[0]] * signs[others[1]] < 0) {
        const idxs = [i, j, k];
        const ds = [di, dj, dk];
        a = [positions[idxs[o] * 3], positions[idxs[o] * 3 + 1], positions[idxs[o] * 3 + 2]];
        b = interpPoint(positions, idxs[others[0]], idxs[others[1]], ds[others[0]], ds[others[1]], wAxis);
      }
    } else if (zeros === 2) {
      const pair = [0, 1, 2].filter((x) => signs[x] === 0) as [number, number];
      const idxs = [i, j, k];
      a = [positions[idxs[pair[0]] * 3], positions[idxs[pair[0]] * 3 + 1], positions[idxs[pair[0]] * 3 + 2]];
      b = [positions[idxs[pair[1]] * 3], positions[idxs[pair[1]] * 3 + 1], positions[idxs[pair[1]] * 3 + 2]];
    } else {
      continue;
    }

    if (!a || !b) continue;
    const pa = hasher.insertOrFind(uv(a, uAxis, vAxis));
    const pb = hasher.insertOrFind(uv(b, uAxis, vAxis));
    if (pa === pb) continue;
    segments.push([pa, pb]);
  }

  const adj: number[][] = [];
  for (let i = 0; i < hasher.length(); i++) adj.push([]);

  const edgeKeys = new Set<string>();
  for (const [u, v] of segments) {
    const key = u < v ? `${u},${v}` : `${v},${u}`;
    if (edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    adj[u].push(v);
    adj[v].push(u);
  }

  const rings: Vec2[][] = [];
  const visited = new Set<string>();

  for (let start = 0; start < adj.length; start++) {
    for (const firstNeighbor of adj[start]) {
      const edgeKey = start < firstNeighbor ? `${start},${firstNeighbor}` : `${firstNeighbor},${start}`;
      if (visited.has(edgeKey)) continue;

      const path: number[] = [start];
      let prev = start;
      let current = firstNeighbor;

      for (let safety = 0; safety < segments.length * 2 + 10; safety++) {
        path.push(current);
        const key = prev < current ? `${prev},${current}` : `${current},${prev}`;
        visited.add(key);

        if (current === start) {
          rings.push(path.map((idx) => hasher.getPoint(idx)));
          break;
        }

        const next = adj[current].find((n) => {
          const k = current < n ? `${current},${n}` : `${n},${current}`;
          return n !== prev && !visited.has(k);
        });

        if (next === undefined) break;
        prev = current;
        current = next;
      }
    }
  }

  return rings;
}

export function slicePlane(
  positions: Float32Array,
  indices: Uint32Array,
  z: number,
  eps = 1e-9,
): Vec2[][] {
  return sliceMesh(positions, indices, z, 2, 0, 1, eps);
}

function ringArea(ring: Vec2[]): number {
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    area += x1 * y2 - x2 * y1;
  }
  return area / 2;
}

function ringCentroid(ring: Vec2[]): Vec2 {
  let cx = 0;
  let cy = 0;
  for (const [x, y] of ring) {
    cx += x;
    cy += y;
  }
  return [cx / ring.length, cy / ring.length];
}

function pieceBounds(rings: Vec2[][]): { min: Vec2; max: Vec2 } {
  const min: Vec2 = [Infinity, Infinity];
  const max: Vec2 = [-Infinity, -Infinity];
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x < min[0]) min[0] = x;
      if (x > max[0]) max[0] = x;
      if (y < min[1]) min[1] = y;
      if (y > max[1]) max[1] = y;
    }
  }
  return { min, max };
}

function makeTransform(
  axis: "x" | "y" | "z",
  position: number,
  thickness: number,
): number[][] {
  const t = position - thickness / 2;
  if (axis === "x") {
    return [
      [0, 0, 1, t],
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 0, 1],
    ];
  }
  if (axis === "y") {
    return [
      [1, 0, 0, 0],
      [0, 0, 1, t],
      [0, 1, 0, 0],
      [0, 0, 0, 1],
    ];
  }
  return [
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, t],
    [0, 0, 0, 1],
  ];
}

function makePiece(
  id: string,
  axis: "x" | "y" | "z",
  position: number,
  thickness: number,
  rings: Vec2[][],
): Piece {
  rings = rings.slice();
  rings.sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)));

  const bounds = pieceBounds(rings);
  return {
    id,
    base_id: id,
    axis,
    position,
    thickness,
    rings,
    transform: makeTransform(axis, position, thickness),
    bounds,
    width: bounds.max[0] - bounds.min[0],
    height: bounds.max[1] - bounds.min[1],
  };
}

function sliceStacked(
  positions: Float32Array,
  indices: Uint32Array,
  thickness: number,
  count: number,
): { pieces: Piece[]; info: unknown } {
  const { min, max } = computeBounds(positions);
  const height = max[2] - min[2];

  if (count < 2) throw new Error("need at least 2 pieces for stacked mode");
  if (height <= thickness) throw new Error("model is too thin for requested piece thickness");

  const spacing = (height - thickness) / (count - 1);
  const pieces: Piece[] = [];

  for (let i = 0; i < count; i++) {
    const z = min[2] + thickness / 2 + i * spacing;
    const rings = sliceMesh(positions, indices, z, 2, 0, 1);
    if (rings.length === 0) continue;
    pieces.push(makePiece(`P${i + 1}`, "z", z, thickness, rings));
  }

  return {
    pieces,
    info: {
      count: pieces.length,
      spacing,
      gap: spacing - thickness,
    },
  };
}

function lineBounds(rings: Vec2[][], u0: number): { low: number; high: number } | null {
  const vs: number[] = [];
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const p1 = ring[i];
      const p2 = ring[(i + 1) % ring.length];
      const u1 = p1[0];
      const u2 = p2[0];
      if (u1 === u2) continue;
      if (u0 < Math.min(u1, u2) || u0 > Math.max(u1, u2)) continue;
      const t = (u0 - u1) / (u2 - u1);
      const v = p1[1] + t * (p2[1] - p1[1]);
      vs.push(v);
    }
  }
  if (vs.length < 2) return null;
  return { low: Math.min(...vs), high: Math.max(...vs) };
}

type Polygon = number[][][];

function notchRect(u0: number, v0: number, v1: number, thickness: number): Polygon {
  const half = thickness / 2;
  return [
    [
      [u0 - half, v0],
      [u0 + half, v0],
      [u0 + half, v1],
      [u0 - half, v1],
      [u0 - half, v0],
    ],
  ];
}

function applyDifference(subject: Vec2[][], clips: Polygon[]): Vec2[][] {
  if (clips.length === 0) return subject;
  const result = polygonClipping.difference(subject as any, ...(clips as any[])) as any;
  const rings: Vec2[][] = [];
  for (const polygon of result) {
    for (const ring of polygon) {
      rings.push(ring as Vec2[]);
    }
  }
  // largest first, then holes
  rings.sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)));
  return rings;
}

function cutNotches(
  piece: Piece,
  cutLines: { u0: number; axis: "x" | "y" }[],
  take: "bottom" | "top",
): void {
  const clips: Polygon[] = [];
  for (const line of cutLines) {
    const b = lineBounds(piece.rings, line.u0);
    if (!b) continue;
    const mid = (b.low + b.high) / 2;
    if (take === "bottom") {
      clips.push(notchRect(line.u0, b.low - 0.01, mid, piece.thickness));
    } else {
      clips.push(notchRect(line.u0, mid, b.high + 0.01, piece.thickness));
    }
  }
  if (clips.length === 0) return;

  piece.rings = applyDifference(piece.rings, clips);
  piece.bounds = pieceBounds(piece.rings);
  piece.width = piece.bounds.max[0] - piece.bounds.min[0];
  piece.height = piece.bounds.max[1] - piece.bounds.min[1];
}

function sliceInterlocking(
  positions: Float32Array,
  indices: Uint32Array,
  thickness: number,
  count: number,
): { pieces: Piece[]; info: unknown } {
  const { min, max } = computeBounds(positions);

  if (count < 2) throw new Error("need at least 2 pieces for interlocking mode");
  const xSpan = max[0] - min[0];
  const ySpan = max[1] - min[1];
  if (xSpan <= thickness || ySpan <= thickness) {
    throw new Error("model is too narrow for the requested material thickness");
  }

  const spX = (xSpan - thickness) / (count - 1);
  const spY = (ySpan - thickness) / (count - 1);

  const xPieces: Piece[] = [];
  for (let i = 0; i < count; i++) {
    const x = min[0] + thickness / 2 + i * spX;
    const rings = sliceMesh(positions, indices, x, 0, 1, 2);
    if (rings.length === 0) continue;
    xPieces.push(makePiece(`X${i + 1}`, "x", x, thickness, rings));
  }

  const yPieces: Piece[] = [];
  for (let j = 0; j < count; j++) {
    const y = min[1] + thickness / 2 + j * spY;
    const rings = sliceMesh(positions, indices, y, 1, 0, 2);
    if (rings.length === 0) continue;
    yPieces.push(makePiece(`Y${j + 1}`, "y", y, thickness, rings));
  }

  const splitXPieces = splitByIslands(xPieces);
  const splitYPieces = splitByIslands(yPieces);

  // X pieces get bottom notches at each Y plane
  const yLines = splitYPieces.map((p) => ({ u0: p.position, axis: "y" as const }));
  for (const xp of splitXPieces) {
    cutNotches(xp, yLines, "bottom");
  }

  // Y pieces get top notches at each X plane
  const xLines = splitXPieces.map((p) => ({ u0: p.position, axis: "x" as const }));
  for (const yp of splitYPieces) {
    cutNotches(yp, xLines, "top");
  }

  return {
    pieces: [...splitXPieces, ...splitYPieces],
    info: {
      count: xPieces.length + yPieces.length,
      x_count: xPieces.length,
      y_count: yPieces.length,
      spacing_x: spX,
      spacing_y: spY,
    },
  };
}

function indexToAlpha(n: number): string {
  let s = "";
  do {
    s = String.fromCharCode(97 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

function splitPiece(piece: Piece, maxW: number, maxH: number): Piece[] {
  if (piece.width <= maxW && piece.height <= maxH) return [piece];

  const cols = Math.max(1, Math.ceil(piece.width / maxW));
  const rows = Math.max(1, Math.ceil(piece.height / maxH));
  const cellW = piece.width / cols;
  const cellH = piece.height / rows;
  const parts: Piece[] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x0 = piece.bounds.min[0] + c * cellW;
      const x1 = x0 + cellW;
      const y0 = piece.bounds.min[1] + r * cellH;
      const y1 = y0 + cellH;
      const clip = [
        [
          [x0, y0],
          [x1, y0],
          [x1, y1],
          [x0, y1],
          [x0, y0],
        ],
      ] as any;

      const outerSign = Math.sign(ringArea(piece.rings[0]));
      const rings: Vec2[][] = [];
      for (const pr of piece.rings) {
        const clipped = polygonClipping.intersection([pr as any], clip as any) as any;
        for (const polygon of clipped) {
          for (const ring of polygon) {
            const r2 = ring as unknown as Vec2[];
            if (r2.length < 3 || Math.abs(ringArea(r2)) < 1e-9) continue;
            rings.push(r2);
          }
        }
      }
      if (rings.length === 0) continue;
      if (!rings.some((r) => Math.sign(ringArea(r)) === outerSign)) continue;

      const sub = makePiece(
        `${piece.id}${indexToAlpha(parts.length)}`,
        piece.axis,
        piece.position,
        piece.thickness,
        rings,
      );
      sub.base_id = piece.id;
      parts.push(sub);
    }
  }

  return parts.length ? parts : [piece];
}

function splitByIslands(pieces: Piece[]): Piece[] {
  const result: Piece[] = [];
  for (const piece of pieces) {
    if (piece.rings.length < 2) {
      result.push(piece);
      continue;
    }

    const outerSign = Math.sign(ringArea(piece.rings[0]));
    const outers: { ring: Vec2[]; bounds: { min: Vec2; max: Vec2 } }[] = [];
    const holes: { ring: Vec2[]; bounds: { min: Vec2; max: Vec2 } }[] = [];

    for (const ring of piece.rings) {
      const bounds = pieceBounds([ring]);
      if (Math.sign(ringArea(ring)) === outerSign) {
        outers.push({ ring, bounds });
      } else {
        holes.push({ ring, bounds });
      }
    }

    if (outers.length <= 1) {
      result.push(piece);
      continue;
    }

    const parts: Piece[] = [];
    for (const outer of outers) {
      const groupRings: Vec2[][] = [outer.ring];
      for (const hole of holes) {
        if (
          hole.bounds.min[0] >= outer.bounds.min[0] - 1e-9 &&
          hole.bounds.max[0] <= outer.bounds.max[0] + 1e-9 &&
          hole.bounds.min[1] >= outer.bounds.min[1] - 1e-9 &&
          hole.bounds.max[1] <= outer.bounds.max[1] + 1e-9
        ) {
          groupRings.push(hole.ring);
        }
      }

      const sub = makePiece(
        `${piece.id}${indexToAlpha(parts.length)}`,
        piece.axis,
        piece.position,
        piece.thickness,
        groupRings,
      );
      sub.base_id = piece.id;
      parts.push(sub);
    }

    result.push(...(parts.length > 0 ? parts : [piece]));
  }
  return result;
}

function splitOversizedPieces(pieces: Piece[], maxW: number, maxH: number): Piece[] {
  const result: Piece[] = [];
  for (const piece of pieces) {
    result.push(...splitPiece(piece, maxW, maxH));
  }
  return result;
}

function packSheets(
  pieces: Piece[],
  sheetW: number,
  sheetH: number,
  margin: number,
  spacing: number,
) {
  const binW = Math.max(1, sheetW - 2 * margin);
  const binH = Math.max(1, sheetH - 2 * margin);

  const packer = new MaxRectsPacker(binW, binH, spacing, {
    smart: false,
    pot: false,
    square: false,
    allowRotation: false,
  });

  packer.addArray(
    pieces.map((p) => ({
      width: p.width,
      height: p.height,
      data: p,
    } as any)),
  );

  const sheets = [] as {
    binIndex: number;
    width: number;
    height: number;
    placed: {
      piece: Piece;
      x: number;
      y: number;
      rot: boolean;
    }[];
  }[];

  for (let b = 0; b < packer.bins.length; b++) {
    const bin = packer.bins[b];
    const placed = bin.rects.map((r) => ({
      piece: r.data as Piece,
      x: r.x,
      y: r.y,
      rot: Boolean(r.rot),
    }));
    if (placed.length > 0) {
      sheets.push({
        binIndex: b,
        width: binW,
        height: binH,
        placed,
      });
    }
  }

  return sheets;
}

function pt(x: number, y: number, ox: number, oy: number, top: number, sh: number): string {
  return `${(ox + x).toFixed(3)},${(top + sh - (oy + y)).toFixed(3)}`;
}

function ringPath(ring: Vec2[], ox: number, oy: number, top: number, sh: number): string {
  return ring
    .map((p, i) => `${i === 0 ? "M" : "L"} ${pt(p[0], p[1], ox, oy, top, sh)}`)
    .join(" ") + " Z";
}

function svgHeader(w: number, h: number, extra = ""): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w.toFixed(1)} ${h.toFixed(1)}" width="${w.toFixed(1)}mm" height="${h.toFixed(1)}mm"${extra}>`;
}

interface SheetSvg {
  combined: string;
  perSheet: { index: number; content: string }[];
}

function emitSheets(
  sheets: ReturnType<typeof packSheets>,
  sheetW: number,
  sheetH: number,
  margin: number,
  pad = 10,
): SheetSvg {
  const totalW = sheetW + 2 * pad;
  const totalH = sheets.length * (sheetH + pad) + pad;

  const combined: string[] = [svgHeader(totalW, totalH), '  <g id="sheets">'];
  const perSheet: { index: number; content: string }[] = [];

  for (let s = 0; s < sheets.length; s++) {
    const top = pad + s * (sheetH + pad);
    const left = pad;

    combined.push(`    <g id="sheet-${s + 1}">`);
    combined.push(
      `      <rect x="${left.toFixed(3)}" y="${top.toFixed(3)}" width="${sheetW.toFixed(3)}" height="${sheetH.toFixed(3)}" fill="none" stroke="#333333" stroke-width="0.5"/>`,
    );
    combined.push(
      `      <text x="${(left + 2).toFixed(3)}" y="${(top + 5).toFixed(3)}" font-size="5" fill="#0000aa" dominant-baseline="hanging">Sheet ${s + 1}</text>`,
    );

    const per: string[] = [
      svgHeader(sheetW, sheetH),
      '  <g id="sheet">',
      `    <rect x="0" y="0" width="${sheetW.toFixed(1)}" height="${sheetH.toFixed(1)}" fill="none" stroke="#333333" stroke-width="0.5"/>`,
    ];

    for (const placed of sheets[s].placed) {
      const p = placed.piece;
      const oxC = left + margin + placed.x - p.bounds.min[0];
      const oyC = margin + placed.y - p.bounds.min[1];
      const oxP = margin + placed.x - p.bounds.min[0];
      const oyP = margin + placed.y - p.bounds.min[1];

      const label = ringCentroid(p.rings[0]);
      const lxC = oxC + label[0];
      const lyC = top + sheetH - (oyC + label[1]);
      const lxP = oxP + label[0];
      const lyP = sheetH - (oyP + label[1]);

      for (const ring of p.rings) {
        const dC = ringPath(ring, oxC, oyC, top, sheetH);
        const dP = ringPath(ring, oxP, oyP, 0, sheetH);
        combined.push(`      <path d="${dC}" fill="none" stroke="#cc0000" stroke-width="0.2"/>`);
        per.push(`    <path d="${dP}" fill="none" stroke="#cc0000" stroke-width="0.2"/>`);
      }

      combined.push(
        `      <text x="${lxC.toFixed(3)}" y="${lyC.toFixed(3)}" font-size="4" text-anchor="middle" dominant-baseline="central" fill="#0000aa">${p.id}</text>`,
      );
      per.push(
        `    <text x="${lxP.toFixed(3)}" y="${lyP.toFixed(3)}" font-size="4" text-anchor="middle" dominant-baseline="central" fill="#0000aa">${p.id}</text>`,
      );
    }

    combined.push("    </g>");
    per.push("  </g>");
    per.push("</svg>");
    perSheet.push({ index: s + 1, content: per.join("\n") });
  }

  combined.push("  </g>");
  combined.push("</svg>");

  return { combined: combined.join("\n"), perSheet };
}

function buildPreview(pieces: Piece[]): unknown[] {
  return pieces.map((p) => ({
    id: p.id,
    base_id: p.base_id,
    axis: p.axis,
    position: p.position,
    thickness: p.thickness,
    transform: p.transform,
    paths: p.rings.map((r) => r.map((pt) => [pt[0], pt[1]])),
  }));
}

export async function sliceStl(options: SliceOptions): Promise<SliceResult> {
  const { stlPath, output, mode, thickness, count, sheet, margin = 5.0, spacing = 2.0, scale = 1.0 } = options;

  try {
    if (count < 2) throw new Error("need at least 2 pieces");

    const buffer = await Bun.file(stlPath).arrayBuffer();
    const { positions, indices } = loadStl(buffer, scale);

    const { pieces, info } =
      mode === "interlocking"
        ? sliceInterlocking(positions, indices, thickness, count)
        : sliceStacked(positions, indices, thickness, count);

    if (pieces.length === 0) throw new Error("slicing produced no usable pieces");

    const [sheetW, sheetH] = sheet;
    const binW = Math.max(1, sheetW - 2 * margin);
    const binH = Math.max(1, sheetH - 2 * margin);
    const splitPieces = mode === "stacked" ? splitByIslands(pieces) : pieces;
    const fittedPieces = splitOversizedPieces(splitPieces, binW, binH);
    const sheets = packSheets(fittedPieces, sheetW, sheetH, margin, spacing);
    if (sheets.length === 0) throw new Error("slicing produced no pieces that fit the sheet");

    const { combined, perSheet } = emitSheets(sheets, sheetW, sheetH, margin, spacing);

    const sheetsDir = output.replace(/\.svg$/, "") + "_sheets";
    fs.mkdirSync(sheetsDir, { recursive: true });
    for (const s of perSheet) {
      fs.writeFileSync(path.join(sheetsDir, `sheet-${s.index}.svg`), s.content, "utf8");
    }
    fs.writeFileSync(output, combined, "utf8");

    return {
      ok: true,
      output,
      sheets: sheets.length,
      parts: fittedPieces.length,
      info,
      sheetsDir,
      preview: buildPreview(fittedPieces),
    };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
