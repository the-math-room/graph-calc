import { formatNumber } from "../workspace/workspace.js";
import { GraphViewport, SampledPlot, ScreenPoint } from "../workspace/workspace-sampling.js";
import { graphInteraction } from "./graph-interaction-config.js";

export type GraphViewState = {
  view: { cx: number; cy: number; scale: number };
  pointer: ScreenPoint | null;
  plots: SampledPlot[];
  sampledViewport: GraphViewport | null;
};

export function drawGraphFrame(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  readoutEl: HTMLOutputElement,
  state: GraphViewState
): void {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width * dpr));
  const height = Math.max(1, Math.floor(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
  drawGrid(ctx, rect.width, rect.height, state);

  state.plots.filter(isRegionPlot).forEach((plot) => drawPlot(ctx, plot, rect.width, rect.height, state));
  state.plots.filter((plot) => !isRegionPlot(plot)).forEach((plot) => drawPlot(ctx, plot, rect.width, rect.height, state));
  if (state.pointer) {
    const world = screenToWorld(state, rect.width, rect.height, state.pointer.x, state.pointer.y);
    readoutEl.value = `(${formatNumber(world.x)}, ${formatNumber(world.y)})`;
  }
}

export function viewportFor(canvas: HTMLCanvasElement, state: Pick<GraphViewState, "view">, interactive: boolean): GraphViewport {
  const rect = canvas.getBoundingClientRect();
  const overscan = interactive ? graphInteraction.interactiveOverscan : graphInteraction.idleOverscan;
  return {
    cx: state.view.cx,
    cy: state.view.cy,
    scale: state.view.scale,
    width: rect.width * (1 + overscan * 2),
    height: rect.height * (1 + overscan * 2),
    interactive
  };
}

export function screenToWorldPoint(canvas: HTMLCanvasElement, state: Pick<GraphViewState, "view">, x: number, y: number): ScreenPoint {
  const rect = canvas.getBoundingClientRect();
  return screenToWorld(state, rect.width, rect.height, x, y);
}

function drawGrid(ctx: CanvasRenderingContext2D, width: number, height: number, state: GraphViewState): void {
  ctx.fillStyle = "#fbfcfd";
  ctx.fillRect(0, 0, width, height);
  const step = niceStep(72 / state.view.scale);
  const startX = Math.floor((state.view.cx - width / 2 / state.view.scale) / step) * step;
  const endX = state.view.cx + width / 2 / state.view.scale;
  const startY = Math.floor((state.view.cy - height / 2 / state.view.scale) / step) * step;
  const endY = state.view.cy + height / 2 / state.view.scale;

  ctx.lineWidth = 1;
  ctx.strokeStyle = "#e6e9ef";
  ctx.fillStyle = "#7d8593";
  ctx.font = "12px SFMono-Regular, Consolas, monospace";

  for (let x = startX; x <= endX + step / 2; x += step) {
    const sx = worldToScreen(state, width, height, x, 0).x;
    line(ctx, sx, 0, sx, height);
    if (Math.abs(x) > step / 100) ctx.fillText(formatNumber(x), sx + 4, worldToScreen(state, width, height, 0, 0).y + 14);
  }
  for (let y = startY; y <= endY + step / 2; y += step) {
    const sy = worldToScreen(state, width, height, 0, y).y;
    line(ctx, 0, sy, width, sy);
    if (Math.abs(y) > step / 100) ctx.fillText(formatNumber(y), worldToScreen(state, width, height, 0, 0).x + 5, sy - 5);
  }

  ctx.strokeStyle = "#8d96a5";
  ctx.lineWidth = 1.25;
  const origin = worldToScreen(state, width, height, 0, 0);
  line(ctx, origin.x, 0, origin.x, height);
  line(ctx, 0, origin.y, width, origin.y);
}

function drawPlot(ctx: CanvasRenderingContext2D, plot: SampledPlot, width: number, height: number, state: GraphViewState): void {
  ctx.strokeStyle = plot.color;
  ctx.fillStyle = plot.color;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  if (plot.kind === "points") {
    plot.points.forEach((point) => {
      ctx.beginPath();
      const projected = projectPoint(state, width, height, point);
      ctx.arc(projected.x, projected.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    });
    return;
  }
  if (plot.kind === "region-grid") {
    drawRegionGridPlot(ctx, plot, width, height, state);
    return;
  }
  if (plot.kind === "smooth-region") {
    drawSmoothRegionPlot(ctx, plot, width, height, state);
    return;
  }

  strokeSegments(ctx, plot.segments, width, height, state);
}

function drawRegionGridPlot(ctx: CanvasRenderingContext2D, plot: Extract<SampledPlot, { kind: "region-grid" }>, width: number, height: number, state: GraphViewState): void {
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = plot.color;
  drawRegionCellRuns(ctx, plot.cells, width, height, state);
  ctx.restore();

  drawRegionGridBoundary(ctx, plot, width, height, state);
}

function drawRegionCellRuns(ctx: CanvasRenderingContext2D, cells: Extract<SampledPlot, { kind: "region-grid" }>["cells"], width: number, height: number, state: GraphViewState): void {
  if (cells.length === 0) return;
  let run = { x: cells[0].x, y: cells[0].y, width: cells[0].size, size: cells[0].size };

  const flush = (): void => {
    const topLeft = projectPoint(state, width, height, { x: run.x, y: run.y });
    const bottomRight = projectPoint(state, width, height, { x: run.x + run.width, y: run.y + run.size });
    ctx.fillRect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x + 0.75, bottomRight.y - topLeft.y + 0.75);
  };

  for (const cell of cells.slice(1)) {
    const continuesRun = cell.y === run.y && cell.size === run.size && Math.abs(cell.x - (run.x + run.width)) < 0.001;
    if (continuesRun) {
      run.width += cell.size;
      continue;
    }
    flush();
    run = { x: cell.x, y: cell.y, width: cell.size, size: cell.size };
  }
  flush();
}

function drawRegionGridBoundary(ctx: CanvasRenderingContext2D, plot: Extract<SampledPlot, { kind: "region-grid" }>, width: number, height: number, state: GraphViewState): void {
  if (plot.boundaryStyle === "inclusive") {
    ctx.save();
    ctx.strokeStyle = plot.color;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    strokeScreenSegments(ctx, plot.boundarySegments.map((segment) => [
      projectPoint(state, width, height, segment.from),
      projectPoint(state, width, height, segment.to)
    ]));
    ctx.restore();
    return;
  }

  if (plot.boundaryStyle === "mixed") {
    ctx.save();
    ctx.globalAlpha = 0.45;
    ctx.strokeStyle = plot.color;
    ctx.lineWidth = 1.25;
    ctx.lineCap = "round";
    strokeScreenSegments(ctx, plot.boundarySegments.map((segment) => [
      projectPoint(state, width, height, segment.from),
      projectPoint(state, width, height, segment.to)
    ]));
    ctx.restore();
  }

  ctx.save();
  ctx.fillStyle = plot.color;
  drawBoundaryDots(ctx, plot.boundarySegments.map((segment) => ({
    from: projectPoint(state, width, height, segment.from),
    to: projectPoint(state, width, height, segment.to)
  })));
  ctx.restore();
}

function drawSmoothRegionPlot(ctx: CanvasRenderingContext2D, plot: Extract<SampledPlot, { kind: "smooth-region" }>, width: number, height: number, state: GraphViewState): void {
  const points = plot.points.map((point) => projectPoint(state, width, height, point));
  if (points.length < 2) return;

  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = plot.color;
  fillSmoothRegion(ctx, points, plot.fillSide, width, height);
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = plot.color;
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.setLineDash(regionBoundaryDash(plot.boundaryStyle));
  strokeSegments(ctx, [plot.points], width, height, state);
  ctx.restore();
}

function fillSmoothRegion(ctx: CanvasRenderingContext2D, points: ScreenPoint[], fillSide: Extract<SampledPlot, { kind: "smooth-region" }>["fillSide"], width: number, height: number): void {
  ctx.beginPath();
  if (fillSide === "below") {
    ctx.moveTo(points[0].x, height);
    points.forEach((point) => ctx.lineTo(point.x, point.y));
    ctx.lineTo(points[points.length - 1].x, height);
  } else if (fillSide === "above") {
    ctx.moveTo(points[0].x, 0);
    points.forEach((point) => ctx.lineTo(point.x, point.y));
    ctx.lineTo(points[points.length - 1].x, 0);
  } else if (fillSide === "left") {
    ctx.moveTo(0, points[0].y);
    points.forEach((point) => ctx.lineTo(point.x, point.y));
    ctx.lineTo(0, points[points.length - 1].y);
  } else {
    ctx.moveTo(width, points[0].y);
    points.forEach((point) => ctx.lineTo(point.x, point.y));
    ctx.lineTo(width, points[points.length - 1].y);
  }
  ctx.closePath();
  ctx.fill();
}

function strokeSegments(ctx: CanvasRenderingContext2D, segments: ScreenPoint[][], width: number, height: number, state: GraphViewState): void {
  strokeScreenSegments(ctx, segments.map((points) => points.map((point) => projectPoint(state, width, height, point))));
}

function strokeScreenSegments(ctx: CanvasRenderingContext2D, segments: ScreenPoint[][]): void {
  ctx.beginPath();
  for (const points of segments) {
    let first = true;
    for (const point of points) {
      if (first) {
        ctx.moveTo(point.x, point.y);
        first = false;
      } else {
        ctx.lineTo(point.x, point.y);
      }
    }
  }
  ctx.stroke();
}

function drawBoundaryDots(ctx: CanvasRenderingContext2D, segments: { from: ScreenPoint; to: ScreenPoint }[]): void {
  const spacing = 7;
  const radius = 1.35;
  for (const segment of segments) {
    const length = screenDistance(segment.from, segment.to);
    const count = Math.max(1, Math.floor(length / spacing));
    for (let index = 0; index <= count; index++) {
      const t = count === 0 ? 0.5 : (index + 0.5) / (count + 1);
      const x = segment.from.x + (segment.to.x - segment.from.x) * t;
      const y = segment.from.y + (segment.to.y - segment.from.y) * t;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function projectPoint(state: GraphViewState, width: number, height: number, point: ScreenPoint): ScreenPoint {
  if (!state.sampledViewport) return point;
  return viewportWorldToScreen({ ...state.view, width, height }, viewportScreenToWorld(state.sampledViewport, point));
}

function projectSize(state: GraphViewState, size: number): number {
  return state.sampledViewport ? size * (state.view.scale / state.sampledViewport.scale) : size;
}

function screenToWorld(state: Pick<GraphViewState, "view">, width: number, height: number, x: number, y: number): ScreenPoint {
  return {
    x: state.view.cx + (x - width / 2) / state.view.scale,
    y: state.view.cy - (y - height / 2) / state.view.scale
  };
}

function viewportScreenToWorld(source: GraphViewport, point: ScreenPoint): ScreenPoint {
  return {
    x: source.cx + (point.x - source.width / 2) / source.scale,
    y: source.cy - (point.y - source.height / 2) / source.scale
  };
}

function worldToScreen(state: Pick<GraphViewState, "view">, width: number, height: number, x: number, y: number): ScreenPoint {
  return {
    x: width / 2 + (x - state.view.cx) * state.view.scale,
    y: height / 2 - (y - state.view.cy) * state.view.scale
  };
}

function viewportWorldToScreen(target: Pick<GraphViewport, "cx" | "cy" | "scale" | "width" | "height">, point: ScreenPoint): ScreenPoint {
  return {
    x: target.width / 2 + (point.x - target.cx) * target.scale,
    y: target.height / 2 - (point.y - target.cy) * target.scale
  };
}

function screenDistance(a: ScreenPoint, b: ScreenPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number): void {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function isRegionPlot(plot: SampledPlot): boolean {
  return plot.kind === "region-grid" || plot.kind === "smooth-region";
}

function regionBoundaryDash(style: Extract<SampledPlot, { kind: "region-grid" | "smooth-region" }>["boundaryStyle"]): number[] {
  if (style === "inclusive") return [];
  if (style === "strict") return [2, 4];
  return [3, 2, 1, 2];
}

function niceStep(target: number): number {
  const power = Math.pow(10, Math.floor(Math.log10(target)));
  const scaled = target / power;
  const mult = scaled < 1.5 ? 1 : scaled < 3.5 ? 2 : scaled < 7.5 ? 5 : 10;
  return mult * power;
}
