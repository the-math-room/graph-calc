import type { RuntimeValue } from "../core/language.js";
import { interpolatedContourSegments, predicateContourSegments } from "./contour-sampling.js";
import { isVisibleBoundaryPoint, sampledBase, screenToWorld, worldToScreen } from "./sampling-geometry.js";
import type { GraphViewport, SampledPlot, ScreenCell, ScreenPoint } from "./sampling-types.js";
import type { Plot } from "./workspace-values.js";

export function sampleRegion(plot: Extract<Plot, { kind: "region" }>, viewport: GraphViewport): SampledPlot {
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
