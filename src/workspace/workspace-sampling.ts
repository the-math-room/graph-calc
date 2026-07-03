import { RuntimeValue } from "../core/language.js";
import { Plot } from "./workspace-values.js";

export type GraphViewport = {
  cx: number;
  cy: number;
  scale: number;
  width: number;
  height: number;
  interactive: boolean;
};

export type ScreenPoint = { x: number; y: number };

export type SampledPlotBase = {
  rowIndex: number;
  label: string;
  color: string;
};

export type SampledPlot =
  | (SampledPlotBase & { kind: "points"; points: ScreenPoint[] })
  | (SampledPlotBase & { kind: "polyline"; segments: ScreenPoint[][] })
  | (SampledPlotBase & { kind: "region-grid"; cells: ScreenCell[]; boundarySegments: ScreenSegment[]; boundaryStyle: "inclusive" | "strict" | "mixed" })
  | (SampledPlotBase & { kind: "smooth-region"; points: ScreenPoint[]; fillSide: "below" | "above" | "left" | "right"; boundaryStyle: "inclusive" | "strict" | "mixed" });

export type ScreenCell = { x: number; y: number; size: number };
export type ScreenSegment = { from: ScreenPoint; to: ScreenPoint };

export function sampleWorkspacePlots(plots: Plot[], viewport: GraphViewport): SampledPlot[] {
  return plots.map((plot) => samplePlot(plot, viewport)).filter((plot) => plot !== null);
}

function samplePlot(plot: Plot, viewport: GraphViewport): SampledPlot | null {
  if (plot.kind === "points") {
    return {
      ...sampledBase(plot),
      kind: "points",
      points: plot.points.map(([x, y]) => worldToScreen(viewport, x, y))
    };
  }
  if (plot.kind === "region") {
    if (plot.smoothBoundary) {
      return {
        ...sampledBase(plot),
        kind: "smooth-region",
        points: sampleSmoothBoundary(plot, viewport),
        fillSide: plot.smoothBoundary.fillSide,
        boundaryStyle: plot.boundaryStyle
      };
    }
    return sampleRegionGrid(plot, viewport);
  }
  if (plot.kind === "contour") return sampleContour(plot, viewport);
  if (plot.kind === "parametric") return sampleParametric(plot, viewport);
  return sampleFunction(plot, viewport);
}

function sampledBase(plot: Plot): SampledPlotBase {
  return { rowIndex: plot.rowIndex, label: plot.label, color: plot.color };
}

function sampleFunction(plot: Extract<Plot, { kind: "function" | "expression" }>, viewport: GraphViewport): SampledPlot {
  const segments: ScreenPoint[][] = [];
  let segment: ScreenPoint[] = [];
  let previous: ScreenPoint | null = null;
  const step = viewport.interactive ? 4 : 2;

  for (let sx = 0; sx <= viewport.width; sx += step) {
    const x = screenToWorld(viewport, sx, 0).x;
    const y = evaluatePlotY(plot, x);
    if (y === null) {
      segment = pushSegment(segments, segment);
      previous = null;
      continue;
    }

    const point = worldToScreen(viewport, x, y);
    if (previous && screenDistance(point, previous) > viewport.height * 0.72) segment = pushSegment(segments, segment);
    segment.push(point);
    previous = point;
  }
  pushSegment(segments, segment);
  return { ...sampledBase(plot), kind: "polyline", segments };
}

function sampleParametric(plot: Extract<Plot, { kind: "parametric" }>, viewport: GraphViewport): SampledPlot {
  const segments: ScreenPoint[][] = [];
  let segment: ScreenPoint[] = [];
  let previous: ScreenPoint | null = null;
  const maxSamples = viewport.interactive ? 420 : 1600;
  const samples = Math.max(64, Math.min(maxSamples, Math.floor(viewport.width * 1.5)));

  for (let index = 0; index <= samples; index++) {
    const ratio = index / samples;
    const t = plot.curve.lo + (plot.curve.hi - plot.curve.lo) * ratio;
    const world = evaluateParametricPoint(plot, t);
    if (!world) {
      segment = pushSegment(segments, segment);
      previous = null;
      continue;
    }

    const point = worldToScreen(viewport, world.x, world.y);
    if (previous && screenDistance(point, previous) > Math.max(viewport.width, viewport.height) * 0.72) segment = pushSegment(segments, segment);
    segment.push(point);
    previous = point;
  }
  pushSegment(segments, segment);
  return { ...sampledBase(plot), kind: "polyline", segments };
}

function sampleRegionGrid(plot: Extract<Plot, { kind: "region" }>, viewport: GraphViewport): SampledPlot {
  const cellSize = viewport.interactive ? 12 : 6;
  const columns = Math.ceil(viewport.width / cellSize);
  const rows = Math.ceil(viewport.height / cellSize);
  const inside: boolean[][] = [];
  const corners: boolean[][] = [];
  const cornerValues: (number | null)[][] = [];
  const cells: ScreenCell[] = [];

  for (let row = 0; row < rows; row++) {
    inside[row] = [];
    for (let column = 0; column < columns; column++) {
      const world = screenToWorld(viewport, column * cellSize + cellSize / 2, row * cellSize + cellSize / 2);
      const isInside = evaluateRegion(plot, world.x, world.y);
      inside[row][column] = isInside;
      if (isInside) cells.push({ x: column * cellSize, y: row * cellSize, size: cellSize });
    }
  }

  for (let row = 0; row <= rows; row++) {
    corners[row] = [];
    cornerValues[row] = [];
    for (let column = 0; column <= columns; column++) {
      const world = screenToWorld(viewport, column * cellSize, row * cellSize);
      cornerValues[row][column] = plot.boundaryValue ? plot.boundaryValue(world.x, world.y) : null;
      corners[row][column] = evaluateRegion(plot, world.x, world.y);
    }
  }

  const boundarySegments = plot.boundaryValue
    ? interpolatedContourSegments(cornerValues, cellSize, columns, rows)
    : predicateContourSegments(corners, cellSize, columns, rows);
  return { ...sampledBase(plot), kind: "region-grid", cells, boundarySegments, boundaryStyle: plot.boundaryStyle };
}

function sampleContour(plot: Extract<Plot, { kind: "contour" }>, viewport: GraphViewport): SampledPlot {
  const cellSize = viewport.interactive ? 10 : 4;
  const columns = Math.ceil(viewport.width / cellSize);
  const rows = Math.ceil(viewport.height / cellSize);
  const values: (number | null)[][] = [];

  for (let row = 0; row <= rows; row++) {
    values[row] = [];
    for (let column = 0; column <= columns; column++) {
      const world = screenToWorld(viewport, column * cellSize, row * cellSize);
      values[row][column] = plot.boundaryValue(world.x, world.y);
    }
  }

  return { ...sampledBase(plot), kind: "polyline", segments: interpolatedContourSegments(values, cellSize, columns, rows).map((segment) => [segment.from, segment.to]) };
}

function predicateContourSegments(corners: boolean[][], cellSize: number, columns: number, rows: number): ScreenSegment[] {
  const segments: ScreenSegment[] = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const topLeft = corners[row][column];
      const topRight = corners[row][column + 1];
      const bottomRight = corners[row + 1][column + 1];
      const bottomLeft = corners[row + 1][column];
      const points: ScreenPoint[] = [];
      const x = column * cellSize;
      const y = row * cellSize;

      if (topLeft !== topRight) points.push({ x: x + cellSize / 2, y });
      if (topRight !== bottomRight) points.push({ x: x + cellSize, y: y + cellSize / 2 });
      if (bottomLeft !== bottomRight) points.push({ x: x + cellSize / 2, y: y + cellSize });
      if (topLeft !== bottomLeft) points.push({ x, y: y + cellSize / 2 });

      if (points.length === 2) {
        segments.push({ from: points[0], to: points[1] });
      } else if (points.length === 4) {
        segments.push({ from: points[0], to: points[1] }, { from: points[2], to: points[3] });
      }
    }
  }
  return segments;
}

function interpolatedContourSegments(values: (number | null)[][], cellSize: number, columns: number, rows: number): ScreenSegment[] {
  const segments: ScreenSegment[] = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const topLeft = values[row][column];
      const topRight = values[row][column + 1];
      const bottomRight = values[row + 1][column + 1];
      const bottomLeft = values[row + 1][column];
      if (topLeft === null || topRight === null || bottomRight === null || bottomLeft === null) continue;

      const x = column * cellSize;
      const y = row * cellSize;
      const points: ScreenPoint[] = [];
      const top = zeroCrossing(topLeft, topRight);
      const right = zeroCrossing(topRight, bottomRight);
      const bottom = zeroCrossing(bottomLeft, bottomRight);
      const left = zeroCrossing(topLeft, bottomLeft);

      if (top !== null) points.push({ x: x + top * cellSize, y });
      if (right !== null) points.push({ x: x + cellSize, y: y + right * cellSize });
      if (bottom !== null) points.push({ x: x + bottom * cellSize, y: y + cellSize });
      if (left !== null) points.push({ x, y: y + left * cellSize });

      if (points.length === 2) {
        segments.push({ from: points[0], to: points[1] });
      } else if (points.length === 4) {
        segments.push({ from: points[0], to: points[1] }, { from: points[2], to: points[3] });
      }
    }
  }
  return segments;
}

function zeroCrossing(a: number, b: number): number | null {
  if (a === 0 && b === 0) return null;
  if (a === 0) return 0;
  if (b === 0) return 1;
  if ((a < 0) === (b < 0)) return null;
  return Math.max(0, Math.min(1, a / (a - b)));
}

function sampleSmoothBoundary(plot: Extract<Plot, { kind: "region" }>, viewport: GraphViewport): ScreenPoint[] {
  const boundary = plot.smoothBoundary;
  if (!boundary) return [];

  const points: ScreenPoint[] = [];
  const step = viewport.interactive ? 4 : 2;
  if (boundary.axis === "y") {
    for (let sx = 0; sx <= viewport.width; sx += step) {
      const x = screenToWorld(viewport, sx, 0).x;
      const y = evaluateBoundary(boundary.fn, x);
      if (y === null) continue;
      const point = worldToScreen(viewport, x, y);
      if (isVisibleBoundaryPoint(point, viewport)) points.push(point);
    }
    return points;
  }

  for (let sy = 0; sy <= viewport.height; sy += step) {
    const y = screenToWorld(viewport, 0, sy).y;
    const x = evaluateBoundary(boundary.fn, y);
    if (x === null) continue;
    const point = worldToScreen(viewport, x, y);
    if (isVisibleBoundaryPoint(point, viewport)) points.push(point);
  }
  return points;
}

function pushSegment(segments: ScreenPoint[][], segment: ScreenPoint[]): ScreenPoint[] {
  if (segment.length >= 2) segments.push(segment);
  return [];
}

function segment(x1: number, y1: number, x2: number, y2: number): ScreenSegment {
  return { from: { x: x1, y: y1 }, to: { x: x2, y: y2 } };
}

function screenToWorld(viewport: GraphViewport, x: number, y: number): ScreenPoint {
  return {
    x: viewport.cx + (x - viewport.width / 2) / viewport.scale,
    y: viewport.cy - (y - viewport.height / 2) / viewport.scale
  };
}

function worldToScreen(viewport: GraphViewport, x: number, y: number): ScreenPoint {
  return {
    x: viewport.width / 2 + (x - viewport.cx) * viewport.scale,
    y: viewport.height / 2 - (y - viewport.cy) * viewport.scale
  };
}

function evaluatePlotY(plot: Extract<Plot, { kind: "function" | "expression" }>, x: number): number | null {
  try {
    const y: RuntimeValue = plot.fn(x);
    return typeof y === "number" && Number.isFinite(y) ? y : null;
  } catch {
    return null;
  }
}

function evaluateParametricPoint(plot: Extract<Plot, { kind: "parametric" }>, t: number): ScreenPoint | null {
  try {
    const value = plot.curve.fn(t);
    if (!Array.isArray(value) || value.length !== 2) return null;
    const [x, y] = value;
    return typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y) ? { x, y } : null;
  } catch {
    return null;
  }
}

function evaluateRegion(plot: Extract<Plot, { kind: "region" }>, x: number, y: number): boolean {
  try {
    return plot.predicate(x, y);
  } catch {
    return false;
  }
}

function evaluateBoundary(fn: (value: number) => RuntimeValue, value: number): number | null {
  try {
    const result = fn(value);
    return typeof result === "number" && Number.isFinite(result) ? result : null;
  } catch {
    return null;
  }
}

function isVisibleBoundaryPoint(point: ScreenPoint, viewport: GraphViewport): boolean {
  return point.x >= -viewport.width && point.x <= viewport.width * 2 && point.y >= -viewport.height && point.y <= viewport.height * 2;
}

function screenDistance(a: ScreenPoint, b: ScreenPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
