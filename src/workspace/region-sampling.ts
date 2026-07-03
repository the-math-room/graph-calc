import type { RuntimeValue } from "../core/language.js";
import { interpolatedContourSegments, predicateContourSegments } from "./marching-squares.js";
import { isVisibleBoundaryPoint, sampledBase, screenToWorld, worldToScreen } from "./sampling-geometry.js";
import { samplingCellSize } from "./sampling-quality.js";
import type { GraphViewport, SampledPlot, ScreenPoint, ScreenPolygon, ScreenRect } from "./sampling-types.js";
import type { Plot } from "./workspace-values.js";

export function sampleRegion(plot: Extract<Plot, { kind: "region" }>, viewport: GraphViewport): SampledPlot {
  if (plot.smoothBoundary) {
    const points = sampleSmoothBoundary(plot, viewport);
    return {
      ...sampledBase(plot),
      kind: "smooth-region",
      points,
      fillAll: points.length < 2 && evaluateRegionAtViewportCenter(plot, viewport),
      fillSide: plot.smoothBoundary.fillSide,
      boundaryStyle: plot.boundaryStyle
    };
  }
  return sampleRegionGrid(plot, viewport);
}

function sampleRegionGrid(plot: Extract<Plot, { kind: "region" }>, viewport: GraphViewport): SampledPlot {
  const cellSize = samplingCellSize(viewport, "region");
  const columns = Math.ceil(viewport.width / cellSize);
  const rows = Math.ceil(viewport.height / cellSize);
  const corners: boolean[][] = [];
  const cornerValues: (number | null)[][] = [];
  const fillRuns: ScreenRect[] = [];
  const fillPolygons: ScreenPolygon[] = [];
  let cellCount = 0;

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
  for (let row = 0; row < rows; row++) {
    let runStart: number | null = null;
    const flushRun = (endColumn: number): void => {
      if (runStart === null) return;
      fillRuns.push({ x: runStart * cellSize, y: row * cellSize, width: (endColumn - runStart) * cellSize, height: cellSize });
      runStart = null;
    };

    for (let column = 0; column < columns; column++) {
      const cellCorners = regionCellCorners(corners, cornerValues, column, row, cellSize);
      const insideCount = cellCorners.filter((corner) => corner.inside).length;
      if (insideCount === 4) {
        cellCount++;
        runStart ??= column;
        continue;
      }

      flushRun(column);
      if (insideCount === 0) continue;

      const polygons = regionCellFillPolygons(cellCorners);
      if (polygons.length > 0) {
        cellCount++;
        fillPolygons.push(...polygons);
      }
    }
    flushRun(columns);
  }
  return { ...sampledBase(plot), kind: "region-grid", cellCount, fillRuns, fillPolygons, boundarySegments, boundaryStyle: plot.boundaryStyle };
}

function regionCellCorners(corners: boolean[][], values: (number | null)[][], column: number, row: number, cellSize: number): CellCorner[] {
  const x = column * cellSize;
  const y = row * cellSize;
  return [
    { point: { x, y }, inside: corners[row][column], value: values[row][column] },
    { point: { x: x + cellSize, y }, inside: corners[row][column + 1], value: values[row][column + 1] },
    { point: { x: x + cellSize, y: y + cellSize }, inside: corners[row + 1][column + 1], value: values[row + 1][column + 1] },
    { point: { x, y: y + cellSize }, inside: corners[row + 1][column], value: values[row + 1][column] }
  ];
}

function regionCellFillPolygons(cellCorners: CellCorner[]): ScreenPolygon[] {
  const insideCount = cellCorners.filter((corner) => corner.inside).length;
  if (insideCount === 0 || insideCount === 4) return [];
  if (isAmbiguousCell(cellCorners)) {
    return cellCorners.flatMap((corner, index) => corner.inside
      ? [[edgePoint(cellCorners, previousIndex(index)), corner.point, edgePoint(cellCorners, index)]]
      : []);
  }

  const polygon: ScreenPolygon = [];
  for (let index = 0; index < cellCorners.length; index++) {
    const corner = cellCorners[index];
    const next = cellCorners[nextIndex(index)];
    if (corner.inside) polygon.push(corner.point);
    if (corner.inside !== next.inside) polygon.push(edgePoint(cellCorners, index));
  }
  return polygon.length >= 3 ? [polygon] : [];
}

type CellCorner = { point: ScreenPoint; inside: boolean; value: number | null };

function isAmbiguousCell(corners: CellCorner[]): boolean {
  return corners[0].inside === corners[2].inside && corners[1].inside === corners[3].inside && corners[0].inside !== corners[1].inside;
}

function edgePoint(corners: CellCorner[], index: number): ScreenPoint {
  const a = corners[index];
  const b = corners[nextIndex(index)];
  const t = edgeRatio(a.value, b.value);
  return {
    x: a.point.x + (b.point.x - a.point.x) * t,
    y: a.point.y + (b.point.y - a.point.y) * t
  };
}

function edgeRatio(a: number | null, b: number | null): number {
  if (a === null || b === null) return 0.5;
  if (a === 0 && b === 0) return 0.5;
  if (a === 0) return 0;
  if (b === 0) return 1;
  return Math.max(0, Math.min(1, a / (a - b)));
}

function nextIndex(index: number): number {
  return (index + 1) % 4;
}

function previousIndex(index: number): number {
  return (index + 3) % 4;
}

function sampleSmoothBoundary(plot: Extract<Plot, { kind: "region" }>, viewport: GraphViewport): ScreenPoint[] {
  const boundary = plot.smoothBoundary;
  if (!boundary) return [];

  const points: ScreenPoint[] = [];
  const step = Math.max(2, Math.floor(samplingCellSize(viewport, "contour") * 0.75));
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

function evaluateRegion(plot: Extract<Plot, { kind: "region" }>, x: number, y: number): boolean {
  try {
    return plot.predicate(x, y);
  } catch {
    return false;
  }
}

function evaluateRegionAtViewportCenter(plot: Extract<Plot, { kind: "region" }>, viewport: GraphViewport): boolean {
  const world = screenToWorld(viewport, viewport.width / 2, viewport.height / 2);
  return evaluateRegion(plot, world.x, world.y);
}

function evaluateBoundary(fn: (value: number) => RuntimeValue, value: number): number | null {
  try {
    const result = fn(value);
    return typeof result === "number" && Number.isFinite(result) ? result : null;
  } catch {
    return null;
  }
}
