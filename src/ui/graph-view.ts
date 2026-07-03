import { clamp } from "../core/language.js";
import { GraphViewport, SampledPlot, ScreenPoint } from "../workspace/workspace-sampling.js";
import { drawGraphFrame, GraphViewState, screenToWorldPoint, viewportFor } from "./graph-drawing.js";
import { graphInteraction } from "./graph-interaction-config.js";

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
    keyboardNavigating: boolean;
    lastDrag: Point | null;
    drawFrame: number;
    keyboardFrame: number;
    lastKeyboardFrameTime: number | null;
  } = {
    view: { cx: 0, cy: 0, scale: 64 },
    pointer: null,
    dragging: false,
    keyboardNavigating: false,
    lastDrag: null,
    plots: [],
    sampledViewport: null,
    drawFrame: 0,
    keyboardFrame: 0,
    lastKeyboardFrameTime: null
  };
  const activeKeys = new Set<GraphKey>();

  const viewport = (): GraphViewport => viewportFor(canvas, state, state.dragging || state.keyboardNavigating);

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
    state.view.scale = clamp(state.view.scale * factor, graphInteraction.minScale, graphInteraction.maxScale);
    if (before && point) {
      const after = screenToWorldPoint(canvas, state, point.x, point.y);
      state.view.cx += before.x - after.x;
      state.view.cy += before.y - after.y;
    }
    notifyViewportChanged();
  };

  const startKeyboardNavigation = (): void => {
    if (state.keyboardFrame) return;
    state.keyboardNavigating = true;
    state.lastKeyboardFrameTime = null;
    state.keyboardFrame = window.requestAnimationFrame(stepKeyboardNavigation);
  };

  const stopKeyboardNavigation = (): void => {
    activeKeys.clear();
    if (state.keyboardFrame) {
      window.cancelAnimationFrame(state.keyboardFrame);
      state.keyboardFrame = 0;
    }
    if (state.keyboardNavigating) {
      state.keyboardNavigating = false;
      state.lastKeyboardFrameTime = null;
      notifyViewportChanged();
    }
  };

  const stepKeyboardNavigation = (time: number): void => {
    if (activeKeys.size === 0) {
      state.keyboardFrame = 0;
      if (state.keyboardNavigating) {
        state.keyboardNavigating = false;
        state.lastKeyboardFrameTime = null;
        notifyViewportChanged();
      }
      return;
    }

    const previousTime = state.lastKeyboardFrameTime ?? time;
    const dt = Math.min(0.05, Math.max(0, (time - previousTime) / 1000));
    state.lastKeyboardFrameTime = time;
    applyKeyboardNavigation(dt);
    notifyViewportChanged();
    state.keyboardFrame = window.requestAnimationFrame(stepKeyboardNavigation);
  };

  const applyKeyboardNavigation = (dt: number): void => {
    const panPixelsPerSecond = graphInteraction.keyboardPanPixelsPerSecond;
    const pan = panPixelsPerSecond * dt / state.view.scale;
    if (activeKeys.has("left")) state.view.cx -= pan;
    if (activeKeys.has("right")) state.view.cx += pan;
    if (activeKeys.has("up")) state.view.cy += pan;
    if (activeKeys.has("down")) state.view.cy -= pan;

    const zoomPerSecond = graphInteraction.keyboardZoomPerSecond;
    if (activeKeys.has("zoomIn")) state.view.scale = clamp(state.view.scale * Math.pow(zoomPerSecond, dt), graphInteraction.minScale, graphInteraction.maxScale);
    if (activeKeys.has("zoomOut")) state.view.scale = clamp(state.view.scale / Math.pow(zoomPerSecond, dt), graphInteraction.minScale, graphInteraction.maxScale);
  };

  if (!canvas.hasAttribute("tabindex")) canvas.tabIndex = 0;

  canvas.addEventListener("pointerdown", (event) => {
    canvas.focus();
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
    zoomAt(event.deltaY < 0 ? graphInteraction.wheelZoomInFactor : graphInteraction.wheelZoomOutFactor, state.pointer);
  }, { passive: false });

  window.addEventListener("keydown", (event) => {
    if (isEditableTarget(event.target)) return;
    const key = graphKeyFor(event);
    if (!key) return;

    event.preventDefault();
    activeKeys.add(key);
    startKeyboardNavigation();
  });

  window.addEventListener("keyup", (event) => {
    const key = graphKeyFor(event);
    if (!key) return;

    event.preventDefault();
    activeKeys.delete(key);
    if (activeKeys.size === 0) stopKeyboardNavigation();
  });

  window.addEventListener("blur", stopKeyboardNavigation);

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

type GraphKey = "left" | "right" | "up" | "down" | "zoomIn" | "zoomOut";

function graphKeyFor(event: KeyboardEvent): GraphKey | null {
  if (event.key === "ArrowLeft") return "left";
  if (event.key === "ArrowRight") return "right";
  if (event.key === "ArrowUp") return "up";
  if (event.key === "ArrowDown") return "down";
  if (event.key === "=" || event.key === "+" || event.code === "Equal" || event.code === "NumpadAdd") return "zoomIn";
  if (event.key === "-" || event.code === "Minus" || event.code === "NumpadSubtract") return "zoomOut";
  return null;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tagName = target.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select" || tagName === "math-field";
}
