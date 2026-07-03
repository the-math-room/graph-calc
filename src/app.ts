import "mathlive";
import "mathlive/fonts.css";
import type { MathfieldElement } from "mathlive";
import { clamp, RuntimeValue } from "./language.js";
import { latexToSource, sourceToLatex } from "./math-syntax.js";
import { Plot, WorkspaceProgram, colors, compileWorkspace, examples, formatNumber } from "./workspace.js";

type Point = { x: number; y: number };
type View = { cx: number; cy: number; scale: number };
type ExpressionRow = { source: string; latex: string };

type AppState = {
  expressions: ExpressionRow[];
  expressionSizeScale: number;
  view: View;
  pointer: Point | null;
  dragging: boolean;
  lastDrag: Point | null;
};

const state: AppState = {
  expressions: loadExpressions(),
  expressionSizeScale: loadExpressionSizeScale(),
  view: { cx: 0, cy: 0, scale: 64 },
  pointer: null,
  dragging: false,
  lastDrag: null
};

const canvas = requireElement<HTMLCanvasElement>("#graph");
const context = canvas.getContext("2d");
if (!context) throw new Error("Canvas 2D context is unavailable");
const ctx: CanvasRenderingContext2D = context;
const listEl = requireElement<HTMLElement>("#expression-list");
const readoutEl = requireElement<HTMLOutputElement>("#cursor-readout");
const expressionSizeEl = requireElement<HTMLInputElement>("#expression-size");

requireElement<HTMLButtonElement>("#add-expression").addEventListener("click", () => addExpression(""));
expressionSizeEl.value = String(state.expressionSizeScale);
applyExpressionSize();
expressionSizeEl.addEventListener("input", () => {
  state.expressionSizeScale = Number(expressionSizeEl.value);
  localStorage.setItem("lambda-graph-expression-size-scale", String(state.expressionSizeScale));
  applyExpressionSize();
});
requireElement<HTMLButtonElement>("#zoom-in").addEventListener("click", () => zoomAt(1.25));
requireElement<HTMLButtonElement>("#zoom-out").addEventListener("click", () => zoomAt(0.8));
requireElement<HTMLButtonElement>("#reset-view").addEventListener("click", () => {
  state.view = { cx: 0, cy: 0, scale: 64 };
  draw();
});

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
  draw();
});

canvas.addEventListener("pointerup", () => {
  state.dragging = false;
  state.lastDrag = null;
});

canvas.addEventListener("pointerleave", () => {
  state.pointer = null;
  state.dragging = false;
  state.lastDrag = null;
  readoutEl.value = "";
  draw();
});

canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  zoomAt(event.deltaY < 0 ? 1.12 : 0.89, state.pointer);
}, { passive: false });

window.addEventListener("resize", draw);

renderExpressions();
draw();

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element as T;
}

function loadExpressions(): ExpressionRow[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem("lambda-graph-expressions") || "null");
    if (Array.isArray(stored)) {
      const rows = stored.map(readStoredExpression).filter((row) => row !== null);
      if (rows.length === stored.length) return rows;
    }
  } catch {
    return exampleRows();
  }
  return exampleRows();
}

function readStoredExpression(value: unknown): ExpressionRow | null {
  if (typeof value === "string") return { source: value, latex: sourceToLatex(value) };
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<ExpressionRow>;
  if (typeof row.source !== "string") return null;
  return {
    source: row.source,
    latex: typeof row.latex === "string" ? row.latex : sourceToLatex(row.source)
  };
}

function exampleRows(): ExpressionRow[] {
  return examples.map((source) => ({ source, latex: sourceToLatex(source) }));
}

function loadExpressionSizeScale(): number {
  const storedScale = Number(localStorage.getItem("lambda-graph-expression-size-scale") || "");
  if (Number.isFinite(storedScale) && storedScale >= 0 && storedScale <= 100) return storedScale;

  const legacySize = Number(localStorage.getItem("lambda-graph-expression-size") || "");
  if (Number.isFinite(legacySize) && legacySize >= 18 && legacySize <= 30) return sizeToScale(legacySize);

  return 42;
}

function applyExpressionSize(): void {
  document.documentElement.style.setProperty("--expression-font-size", `${scaleToSize(state.expressionSizeScale).toFixed(2)}px`);
}

function scaleToSize(scale: number): number {
  const min = 18;
  const max = 34;
  const t = clamp(scale, 0, 100) / 100;
  return min * Math.pow(max / min, t);
}

function sizeToScale(size: number): number {
  const min = 18;
  const max = 34;
  return clamp((Math.log(size / min) / Math.log(max / min)) * 100, 0, 100);
}

function saveExpressions(): void {
  localStorage.setItem("lambda-graph-expressions", JSON.stringify(state.expressions));
}

function addExpression(source: string): void {
  if (!source) {
    listEl.querySelector<MathfieldElement>(".new-expression-row math-field")?.focus();
    return;
  }
  state.expressions.push({ source, latex: sourceToLatex(source) });
  saveExpressions();
  renderExpressions();
  draw();
  focusExpression(state.expressions.length - 1);
}

function renderExpressions(): void {
  listEl.replaceChildren();
  state.expressions.forEach((expression, index) => {
    const card = document.createElement("article");
    card.className = "expression-card";

    const swatch = document.createElement("div");
    swatch.className = "swatch";
    swatch.style.background = colors[index % colors.length];

    const body = document.createElement("div");
    const input = document.createElement("math-field") as MathfieldElement;
    input.className = "expression-input";
    input.setAttribute("aria-label", "Expression");
    input.dataset.expressionIndex = String(index);
    input.value = expression.latex;
    input.smartSuperscript = true;
    input.smartFence = true;
    input.mathVirtualKeyboardPolicy = "manual";
    input.addEventListener("input", () => {
      const latex = input.getValue("latex-unstyled");
      state.expressions[index] = { source: latexToSource(latex), latex };
      saveExpressions();
      draw();
    });

    const result = document.createElement("div");
    result.className = "result";
    result.dataset.resultFor = String(index);

    const remove = document.createElement("button");
    remove.className = "remove-button";
    remove.type = "button";
    remove.textContent = "x";
    remove.title = "Remove";
    remove.setAttribute("aria-label", "Remove expression");
    remove.addEventListener("click", () => {
      state.expressions.splice(index, 1);
      saveExpressions();
      renderExpressions();
      draw();
    });

    body.append(input, result);
    card.append(swatch, body, remove);
    listEl.append(card);
  });
  renderNewExpressionRow();
}

function renderNewExpressionRow(): void {
  const card = document.createElement("article");
  card.className = "expression-card new-expression-row";

  const swatch = document.createElement("div");
  swatch.className = "swatch";

  const body = document.createElement("div");
  const input = document.createElement("math-field") as MathfieldElement;
  input.className = "expression-input";
  input.setAttribute("aria-label", "New expression");
  input.smartSuperscript = true;
  input.smartFence = true;
  input.mathVirtualKeyboardPolicy = "manual";
  input.addEventListener("input", () => {
    const latex = input.getValue("latex-unstyled");
    const source = latexToSource(latex);
    if (!source.trim()) return;
    const index = state.expressions.length;
    state.expressions.push({ source, latex });
    saveExpressions();
    renderExpressions();
    draw();
    focusExpression(index);
  }, { once: true });

  const result = document.createElement("div");
  result.className = "result";

  const spacer = document.createElement("div");
  spacer.className = "remove-spacer";

  body.append(input, result);
  card.append(swatch, body, spacer);
  listEl.append(card);
}

function focusExpression(index: number): void {
  listEl.querySelector<MathfieldElement>(`math-field[data-expression-index="${index}"]`)?.focus();
}

function zoomAt(factor: number, point: Point | null = null): void {
  const before = point ? screenToWorld(point.x, point.y) : null;
  state.view.scale = clamp(state.view.scale * factor, 14, 420);
  if (before && point) {
    const after = screenToWorld(point.x, point.y);
    state.view.cx += before.x - after.x;
    state.view.cy += before.y - after.y;
  }
  draw();
}

function draw(): void {
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

  const program = compileWorkspace(state.expressions.map((expression) => expression.source));
  updateResults(program);
  program.plots.forEach((plot) => drawPlot(plot, rect.width, rect.height));
  if (state.pointer) {
    const world = screenToWorld(state.pointer.x, state.pointer.y);
    readoutEl.value = `(${formatNumber(world.x)}, ${formatNumber(world.y)})`;
  }
}

function updateResults(program: WorkspaceProgram): void {
  program.rows.forEach((row, index) => {
    const el = listEl.querySelector(`[data-result-for="${index}"]`);
    if (!el) return;
    el.textContent = row.text;
    el.classList.toggle("error", !row.ok);
  });
}

function drawGrid(width: number, height: number): void {
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
}

function drawPlot(plot: Plot, width: number, height: number): void {
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

  ctx.beginPath();
  let drawing = false;
  let previousY: number | null = null;
  for (let sx = 0; sx <= width; sx += 2) {
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
}

function evaluatePlotY(plot: Extract<Plot, { kind: "function" | "expression" }>, x: number): number | null {
  try {
    const y: RuntimeValue = plot.fn(x);
    return typeof y === "number" && Number.isFinite(y) ? y : null;
  } catch {
    return null;
  }
}

function line(x1: number, y1: number, x2: number, y2: number): void {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function worldToScreen(x: number, y: number): Point {
  const rect = canvas.getBoundingClientRect();
  return {
    x: rect.width / 2 + (x - state.view.cx) * state.view.scale,
    y: rect.height / 2 - (y - state.view.cy) * state.view.scale
  };
}

function screenToWorld(x: number, y: number): Point {
  const rect = canvas.getBoundingClientRect();
  return {
    x: state.view.cx + (x - rect.width / 2) / state.view.scale,
    y: state.view.cy - (y - rect.height / 2) / state.view.scale
  };
}

function niceStep(target: number): number {
  const power = Math.pow(10, Math.floor(Math.log10(target)));
  const scaled = target / power;
  const mult = scaled < 1.5 ? 1 : scaled < 3.5 ? 2 : scaled < 7.5 ? 5 : 10;
  return mult * power;
}
