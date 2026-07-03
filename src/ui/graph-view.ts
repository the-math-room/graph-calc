import { RuntimeValue, clamp } from "../core/language.js";
import { Plot, formatNumber } from "../workspace/workspace.js";

type Point = { x: number; y: number };
type View = { cx: number; cy: number; scale: number };

export type GraphView = {
  draw(plots: Plot[]): void;
  redraw(): void;
  reset(): void;
  zoomAt(factor: number): void;
};

export function createGraphView(
  canvas: HTMLCanvasElement,
  readoutEl: HTMLOutputElement
): GraphView {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D context is unavailable");
  const ctx: CanvasRenderingContext2D = context;
  const state = {
    view: { cx: 0, cy: 0, scale: 64 } as View,
    pointer: null as Point | null,
    dragging: false,
    lastDrag: null as Point | null,
    plots: [] as Plot[],
    drawFrame: 0
  };

  const screenToWorld = (x: number, y: number): Point => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: state.view.cx + (x - rect.width / 2) / state.view.scale,
      y: state.view.cy - (y - rect.height / 2) / state.view.scale
    };
  };

  const worldToScreen = (x: number, y: number): Point => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.width / 2 + (x - state.view.cx) * state.view.scale,
      y: rect.height / 2 - (y - state.view.cy) * state.view.scale
    };
  };

  const line = (x1: number, y1: number, x2: number, y2: number): void => {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  };

  const drawGrid = (width: number, height: number): void => {
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
      const sx = worldToScreen(x, 0).x;
      line(sx, 0, sx, height);
      if (Math.abs(x) > step / 100) ctx.fillText(formatNumber(x), sx + 4, worldToScreen(0, 0).y + 14);
    }
    for (let y = startY; y <= endY + step / 2; y += step) {
      const sy = worldToScreen(0, y).y;
      line(0, sy, width, sy);
      if (Math.abs(y) > step / 100) ctx.fillText(formatNumber(y), worldToScreen(0, 0).x + 5, sy - 5);
    }

    ctx.strokeStyle = "#8d96a5";
    ctx.lineWidth = 1.25;
    const origin = worldToScreen(0, 0);
    line(origin.x, 0, origin.x, height);
    line(0, origin.y, width, origin.y);
  };

  const drawPlot = (plot: Plot, width: number, height: number): void => {
    ctx.strokeStyle = plot.color;
    ctx.fillStyle = plot.color;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    if (plot.kind === "points") {
      plot.points.forEach(([x, y]) => {
        const p = worldToScreen(x, y);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
        ctx.fill();
      });
      return;
    }
    if (plot.kind === "region") {
      drawRegionPlot(plot, width, height);
      return;
    }
    if (plot.kind === "parametric") {
      drawParametricPlot(plot, width, height);
      return;
    }

    ctx.beginPath();
    let drawing = false;
    let previousY: number | null = null;
    const step = state.dragging ? 4 : 2;
    for (let sx = 0; sx <= width; sx += step) {
      const x = screenToWorld(sx, 0).x;
      const y = evaluatePlotY(plot, x);
      if (y === null) {
        drawing = false;
        previousY = null;
        continue;
      }
      const sy = worldToScreen(x, y).y;
      if (!drawing || previousY === null || Math.abs(sy - previousY) > height * 0.72) {
        ctx.moveTo(sx, sy);
        drawing = true;
      } else {
        ctx.lineTo(sx, sy);
      }
      previousY = sy;
    }
    ctx.stroke();
  };

  const drawRegionPlot = (plot: Extract<Plot, { kind: "region" }>, width: number, height: number): void => {
    if (plot.smoothBoundary) {
      drawSmoothRegionPlot(plot, width, height);
      return;
    }

    const cellSize = state.dragging ? 12 : 6;
    const columns = Math.ceil(width / cellSize);
    const rows = Math.ceil(height / cellSize);
    const inside: boolean[][] = [];

    for (let row = 0; row < rows; row++) {
      inside[row] = [];
      for (let column = 0; column < columns; column++) {
        const world = screenToWorld(column * cellSize + cellSize / 2, row * cellSize + cellSize / 2);
        inside[row][column] = evaluateRegion(plot, world.x, world.y);
      }
    }

    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = plot.color;
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        if (inside[row][column]) ctx.fillRect(column * cellSize, row * cellSize, cellSize, cellSize);
      }
    }
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = plot.color;
    ctx.lineWidth = 2;
    ctx.lineCap = "butt";
    ctx.setLineDash(regionBoundaryDash(plot.boundaryStyle));
    ctx.beginPath();
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        if (!inside[row][column]) continue;
        const x = column * cellSize;
        const y = row * cellSize;
        if (!inside[row - 1]?.[column]) {
          ctx.moveTo(x, y);
          ctx.lineTo(x + cellSize, y);
        }
        if (!inside[row + 1]?.[column]) {
          ctx.moveTo(x, y + cellSize);
          ctx.lineTo(x + cellSize, y + cellSize);
        }
        if (!inside[row]?.[column - 1]) {
          ctx.moveTo(x, y);
          ctx.lineTo(x, y + cellSize);
        }
        if (!inside[row]?.[column + 1]) {
          ctx.moveTo(x + cellSize, y);
          ctx.lineTo(x + cellSize, y + cellSize);
        }
      }
    }
    ctx.stroke();
    ctx.restore();
  };

  const drawSmoothRegionPlot = (plot: Extract<Plot, { kind: "region" }>, width: number, height: number): void => {
    if (!plot.smoothBoundary) return;
    const points = sampleSmoothBoundary(plot, width, height);
    if (points.length < 2) return;

    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = plot.color;
    fillSmoothRegion(points, plot.smoothBoundary.fillSide, width, height);
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = plot.color;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.setLineDash(regionBoundaryDash(plot.boundaryStyle));
    strokePolyline(points);
    ctx.restore();
  };

  const sampleSmoothBoundary = (plot: Extract<Plot, { kind: "region" }>, width: number, height: number): Point[] => {
    const boundary = plot.smoothBoundary;
    if (!boundary) return [];

    const points: Point[] = [];
    if (boundary.axis === "y") {
      const step = state.dragging ? 4 : 2;
      for (let sx = 0; sx <= width; sx += step) {
        const x = screenToWorld(sx, 0).x;
        const y = evaluateBoundary(boundary.fn, x);
        if (y === null) continue;
        const screen = worldToScreen(x, y);
        if (isVisibleBoundaryPoint(screen, width, height)) points.push(screen);
      }
      return points;
    }

    const step = state.dragging ? 4 : 2;
    for (let sy = 0; sy <= height; sy += step) {
      const y = screenToWorld(0, sy).y;
      const x = evaluateBoundary(boundary.fn, y);
      if (x === null) continue;
      const screen = worldToScreen(x, y);
      if (isVisibleBoundaryPoint(screen, width, height)) points.push(screen);
    }
    return points;
  };

  const fillSmoothRegion = (points: Point[], fillSide: NonNullable<Extract<Plot, { kind: "region" }>["smoothBoundary"]>["fillSide"], width: number, height: number): void => {
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
  };

  const strokePolyline = (points: Point[]): void => {
    ctx.beginPath();
    let drawing = false;
    let previous: Point | null = null;
    for (const point of points) {
      if (!drawing || !previous || screenDistance(point, previous) > 96) {
        ctx.moveTo(point.x, point.y);
        drawing = true;
      } else {
        ctx.lineTo(point.x, point.y);
      }
      previous = point;
    }
    ctx.stroke();
  };

  const drawParametricPlot = (plot: Extract<Plot, { kind: "parametric" }>, width: number, height: number): void => {
    ctx.beginPath();
    let drawing = false;
    let previous: Point | null = null;
    const maxSamples = state.dragging ? 420 : 1600;
    const samples = Math.max(64, Math.min(maxSamples, Math.floor(width * 1.5)));
    for (let index = 0; index <= samples; index++) {
      const ratio = index / samples;
      const t = plot.curve.lo + (plot.curve.hi - plot.curve.lo) * ratio;
      const point = evaluateParametricPoint(plot, t);
      if (!point) {
        drawing = false;
        previous = null;
        continue;
      }

      const screen = worldToScreen(point.x, point.y);
      if (!drawing || !previous || screenDistance(screen, previous) > Math.max(width, height) * 0.72) {
        ctx.moveTo(screen.x, screen.y);
        drawing = true;
      } else {
        ctx.lineTo(screen.x, screen.y);
      }
      previous = screen;
    }
    ctx.stroke();
  };

  const draw = (): void => {
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
    drawGrid(rect.width, rect.height);

    state.plots.filter((plot) => plot.kind === "region").forEach((plot) => drawPlot(plot, rect.width, rect.height));
    state.plots.filter((plot) => plot.kind !== "region").forEach((plot) => drawPlot(plot, rect.width, rect.height));
    if (state.pointer) {
      const world = screenToWorld(state.pointer.x, state.pointer.y);
      readoutEl.value = `(${formatNumber(world.x)}, ${formatNumber(world.y)})`;
    }
  };

  const requestDraw = (): void => {
    if (state.drawFrame) return;
    state.drawFrame = window.requestAnimationFrame(() => {
      state.drawFrame = 0;
      draw();
    });
  };

  const zoomAt = (factor: number, point: Point | null = null): void => {
    const before = point ? screenToWorld(point.x, point.y) : null;
    state.view.scale = clamp(state.view.scale * factor, 14, 420);
    if (before && point) {
      const after = screenToWorld(point.x, point.y);
      state.view.cx += before.x - after.x;
      state.view.cy += before.y - after.y;
    }
    requestDraw();
  };

  canvas.addEventListener("pointerdown", (event) => {
    state.dragging = true;
    state.lastDrag = { x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener("pointermove", (event) => {
    const rect = canvas.getBoundingClientRect();
    state.pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    if (state.dragging && state.lastDrag) {
      const dx = event.clientX - state.lastDrag.x;
      const dy = event.clientY - state.lastDrag.y;
      state.view.cx -= dx / state.view.scale;
      state.view.cy += dy / state.view.scale;
      state.lastDrag = { x: event.clientX, y: event.clientY };
    }
    requestDraw();
  });

  canvas.addEventListener("pointerup", () => {
    state.dragging = false;
    state.lastDrag = null;
    requestDraw();
  });

  canvas.addEventListener("pointerleave", () => {
    state.pointer = null;
    state.dragging = false;
    state.lastDrag = null;
    readoutEl.value = "";
    requestDraw();
  });

  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    zoomAt(event.deltaY < 0 ? 1.12 : 0.89, state.pointer);
  }, { passive: false });

  return {
    draw(plots: Plot[]) {
      state.plots = plots;
      requestDraw();
    },
    redraw() {
      requestDraw();
    },
    reset() {
      state.view = { cx: 0, cy: 0, scale: 64 };
      requestDraw();
    },
    zoomAt(factor: number) {
      zoomAt(factor);
    }
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

function evaluateParametricPoint(plot: Extract<Plot, { kind: "parametric" }>, t: number): Point | null {
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

function isVisibleBoundaryPoint(point: Point, width: number, height: number): boolean {
  return point.x >= -width && point.x <= width * 2 && point.y >= -height && point.y <= height * 2;
}

function regionBoundaryDash(style: Extract<Plot, { kind: "region" }>["boundaryStyle"]): number[] {
  if (style === "inclusive") return [];
  if (style === "strict") return [2, 4];
  return [3, 2, 1, 2];
}

function screenDistance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function niceStep(target: number): number {
  const power = Math.pow(10, Math.floor(Math.log10(target)));
  const scaled = target / power;
  const mult = scaled < 1.5 ? 1 : scaled < 3.5 ? 2 : scaled < 7.5 ? 5 : 10;
  return mult * power;
}
