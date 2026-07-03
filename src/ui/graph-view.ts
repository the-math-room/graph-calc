import { clamp } from "../core/language.js";
import { GraphViewport, SampledPlot, ScreenPoint } from "../workspace/workspace-sampling.js";
import { drawGraphFrame, GraphViewState, screenToWorldPoint, viewportFor } from "./graph-drawing.js";

type Point = ScreenPoint;

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
  const state: GraphViewState & {
    dragging: boolean;
    lastDrag: Point | null;
    drawFrame: number;
  } = {
    view: { cx: 0, cy: 0, scale: 64 },
    pointer: null,
    dragging: false,
    lastDrag: null,
    plots: [],
    sampledViewport: null,
    drawFrame: 0
  };

  const viewport = (): GraphViewport => viewportFor(canvas, state, state.dragging);

  const requestDraw = (): void => {
    if (state.drawFrame) return;
    state.drawFrame = window.requestAnimationFrame(() => {
      state.drawFrame = 0;
      drawGraphFrame(ctx, canvas, readoutEl, state);
    });
  };

  const notifyViewportChanged = (): void => {
    requestDraw();
    onViewportChange(viewport());
  };

  const zoomAt = (factor: number, point: Point | null = null): void => {
    const before = point ? screenToWorldPoint(canvas, state, point.x, point.y) : null;
    state.view.scale = clamp(state.view.scale * factor, 14, 420);
    if (before && point) {
      const after = screenToWorldPoint(canvas, state, point.x, point.y);
      state.view.cx += before.x - after.x;
      state.view.cy += before.y - after.y;
    }
    notifyViewportChanged();
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
      notifyViewportChanged();
      return;
    }
    requestDraw();
  });

  canvas.addEventListener("pointerup", () => {
    state.dragging = false;
    state.lastDrag = null;
    notifyViewportChanged();
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
      notifyViewportChanged();
    },
    viewport,
    reset() {
      state.view = { cx: 0, cy: 0, scale: 64 };
      notifyViewportChanged();
    },
    zoomAt(factor: number) {
      zoomAt(factor);
    }
  };
}
