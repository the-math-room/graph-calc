import { clamp } from "../core/language.js";
import { formatNumber } from "../workspace/workspace.js";
import { GraphViewport, SampledPlot, ScreenPoint } from "../workspace/workspace-sampling.js";

type Point = ScreenPoint;
type View = { cx: number; cy: number; scale: number };

export type GraphView = {
  draw(plots: SampledPlot[], sampledViewport: GraphViewport): void;
  redraw(): void;
  viewport(): GraphViewport;
  reset(): void;
  zoomAt(factor: number): void;
};

export function createGraphView(
  canvas: HTMLCanvasElement,
  readoutEl: HTMLOutputElement,
  onViewportChange: (viewport: GraphViewport) => void = () => {}
): GraphView {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D context is unavailable");
  const ctx: CanvasRenderingContext2D = context;
  const state = {
    view: { cx: 0, cy: 0, scale: 64 } as View,
    pointer: null as Point | null,
    dragging: false,
    lastDrag: null as Point | null,
    plots: [] as SampledPlot[],
    sampledViewport: null as GraphViewport | null,
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

  const viewport = (): GraphViewport => {
    const rect = canvas.getBoundingClientRect();
    return {
      cx: state.view.cx,
      cy: state.view.cy,
      scale: state.view.scale,
      width: rect.width,
      height: rect.height,
      interactive: state.dragging
    };
  };

  const viewportScreenToWorld = (source: GraphViewport, point: Point): Point => {
    return {
      x: source.cx + (point.x - source.width / 2) / source.scale,
      y: source.cy - (point.y - source.height / 2) / source.scale
    };
  };

  const viewportWorldToScreen = (target: GraphViewport, point: Point): Point => {
    return {
      x: target.width / 2 + (point.x - target.cx) * target.scale,
      y: target.height / 2 - (point.y - target.cy) * target.scale
    };
  };

  const projectPoint = (point: Point): Point => {
    if (!state.sampledViewport) return point;
    return viewportWorldToScreen(viewport(), viewportScreenToWorld(state.sampledViewport, point));
  };

  const projectSize = (size: number): number => {
    return state.sampledViewport ? size * (state.view.scale / state.sampledViewport.scale) : size;
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

  const drawPlot = (plot: SampledPlot, width: number, height: number): void => {
    ctx.strokeStyle = plot.color;
    ctx.fillStyle = plot.color;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    if (plot.kind === "points") {
      plot.points.forEach((point) => {
        ctx.beginPath();
        const projected = projectPoint(point);
        ctx.arc(projected.x, projected.y, 3.5, 0, Math.PI * 2);
        ctx.fill();
      });
      return;
    }
    if (plot.kind === "region-grid") {
      drawRegionGridPlot(plot);
      return;
    }
    if (plot.kind === "smooth-region") {
      drawSmoothRegionPlot(plot, width, height);
      return;
    }

    strokeSegments(plot.segments);
  };

  const drawRegionGridPlot = (plot: Extract<SampledPlot, { kind: "region-grid" }>): void => {
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = plot.color;
    for (const cell of plot.cells) {
      const projected = projectPoint(cell);
      const size = projectSize(cell.size);
      ctx.fillRect(projected.x, projected.y, size, size);
    }
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = plot.color;
    ctx.lineWidth = 2;
    ctx.lineCap = "butt";
    ctx.setLineDash(regionBoundaryDash(plot.boundaryStyle));
    ctx.beginPath();
    for (const segment of plot.boundarySegments) {
      const from = projectPoint(segment.from);
      const to = projectPoint(segment.to);
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
    }
    ctx.stroke();
    ctx.restore();
  };

  const drawSmoothRegionPlot = (plot: Extract<SampledPlot, { kind: "smooth-region" }>, width: number, height: number): void => {
    const points = plot.points.map(projectPoint);
    if (points.length < 2) return;

    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = plot.color;
    fillSmoothRegion(points, plot.fillSide, width, height);
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = plot.color;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.setLineDash(regionBoundaryDash(plot.boundaryStyle));
    strokeSegments([plot.points]);
    ctx.restore();
  };

  const fillSmoothRegion = (points: Point[], fillSide: Extract<SampledPlot, { kind: "smooth-region" }>["fillSide"], width: number, height: number): void => {
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

  const strokeSegments = (segments: Point[][]): void => {
    ctx.beginPath();
    for (const points of segments) {
      let first = true;
      for (const point of points) {
        const projected = projectPoint(point);
        if (first) {
          ctx.moveTo(projected.x, projected.y);
          first = false;
        } else {
          ctx.lineTo(projected.x, projected.y);
        }
      }
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

    state.plots.filter((plot) => plot.kind === "region-grid" || plot.kind === "smooth-region").forEach((plot) => drawPlot(plot, rect.width, rect.height));
    state.plots.filter((plot) => plot.kind !== "region-grid" && plot.kind !== "smooth-region").forEach((plot) => drawPlot(plot, rect.width, rect.height));
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
    onViewportChange(viewport());
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
    onViewportChange(viewport());
  });

  canvas.addEventListener("pointerup", () => {
    state.dragging = false;
    state.lastDrag = null;
    requestDraw();
    onViewportChange(viewport());
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
    draw(plots: SampledPlot[], sampledViewport: GraphViewport) {
      state.plots = plots;
      state.sampledViewport = sampledViewport;
      requestDraw();
    },
    redraw() {
      requestDraw();
      onViewportChange(viewport());
    },
    viewport() {
      return viewport();
    },
    reset() {
      state.view = { cx: 0, cy: 0, scale: 64 };
      requestDraw();
      onViewportChange(viewport());
    },
    zoomAt(factor: number) {
      zoomAt(factor);
    }
  };
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
