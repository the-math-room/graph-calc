import "mathlive";
import "mathlive/fonts.css";
import type { MathfieldElement } from "mathlive";
import { clamp, RuntimeValue } from "./language.js";
import { escapeLatexCommandToText, latexToSource, sourceToLatex } from "./math-syntax.js";
import { Plot, WorkspaceProgram, colors, compileWorkspace, examples, formatNumber } from "./workspace.js";

type Point = { x: number; y: number };
type View = { cx: number; cy: number; scale: number };
type ExpressionMode = "pretty" | "text";
type ExpressionRow = { source: string; latex: string; mode: ExpressionMode };

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
const sidebarResizerEl = requireElement<HTMLElement>("#sidebar-resizer");
const keyboardToggleEl = requireElement<HTMLButtonElement>("#toggle-keyboard");

requireElement<HTMLButtonElement>("#add-expression").addEventListener("click", () => addExpression(""));
keyboardToggleEl.addEventListener("click", toggleVirtualKeyboard);
applySidebarWidth(loadSidebarWidth());
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
sidebarResizerEl.addEventListener("pointerdown", startSidebarResize);
window.mathVirtualKeyboard.addEventListener("virtual-keyboard-toggle", updateKeyboardToggleState);

renderExpressions();
draw();
updateKeyboardToggleState();

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
  if (typeof value === "string") return { source: value, latex: sourceToLatex(value), mode: "pretty" };
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<ExpressionRow>;
  if (typeof row.source !== "string") return null;
  return {
    source: row.source,
    latex: typeof row.latex === "string" ? row.latex : sourceToLatex(row.source),
    mode: row.mode === "text" ? "text" : "pretty"
  };
}

function exampleRows(): ExpressionRow[] {
  return examples.map((source) => ({ source, latex: sourceToLatex(source), mode: "pretty" }));
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

function toggleVirtualKeyboard(): void {
  const target = activeMathfield() ?? listEl.querySelector<MathfieldElement>(".new-expression-row math-field") ?? listEl.querySelector<MathfieldElement>("math-field");
  target?.focus();
  if (window.mathVirtualKeyboard.visible) {
    window.mathVirtualKeyboard.hide({ animate: true });
  } else {
    window.mathVirtualKeyboard.show({ animate: true });
  }
  updateKeyboardToggleState();
}

function activeMathfield(): MathfieldElement | null {
  const active = document.activeElement;
  return active instanceof HTMLElement && active.tagName.toLowerCase() === "math-field" ? active as MathfieldElement : null;
}

function updateKeyboardToggleState(): void {
  keyboardToggleEl.classList.toggle("is-active", window.mathVirtualKeyboard.visible);
  keyboardToggleEl.setAttribute("aria-pressed", String(window.mathVirtualKeyboard.visible));
}

function loadSidebarWidth(): number {
  const stored = Number(localStorage.getItem("lambda-graph-sidebar-width") || "");
  return Number.isFinite(stored) ? stored : 400;
}

function applySidebarWidth(width: number): void {
  const clamped = clamp(width, 320, Math.max(320, window.innerWidth - 360));
  document.documentElement.style.setProperty("--sidebar-width", `${clamped}px`);
}

function startSidebarResize(event: PointerEvent): void {
  event.preventDefault();
  sidebarResizerEl.setPointerCapture(event.pointerId);

  const onMove = (moveEvent: PointerEvent): void => {
    const width = moveEvent.clientX;
    applySidebarWidth(width);
    localStorage.setItem("lambda-graph-sidebar-width", String(clamp(width, 320, Math.max(320, window.innerWidth - 360))));
    draw();
  };
  const onUp = (): void => {
    sidebarResizerEl.removeEventListener("pointermove", onMove);
    sidebarResizerEl.removeEventListener("pointerup", onUp);
    sidebarResizerEl.removeEventListener("pointercancel", onUp);
  };

  sidebarResizerEl.addEventListener("pointermove", onMove);
  sidebarResizerEl.addEventListener("pointerup", onUp);
  sidebarResizerEl.addEventListener("pointercancel", onUp);
}

function addExpression(source: string): void {
  if (!source) {
    listEl.querySelector<MathfieldElement>(".new-expression-row math-field")?.focus();
    return;
  }
  state.expressions.push({ source, latex: sourceToLatex(source), mode: "pretty" });
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
    body.className = "expression-body";
    const input = expression.mode === "text" ? renderTextExpressionInput(expression, index) : renderPrettyExpressionInput(expression, index);

    const result = document.createElement("div");
    result.className = "result";
    result.dataset.resultFor = String(index);

    const modeToggle = document.createElement("button");
    modeToggle.className = "row-tool-button";
    modeToggle.type = "button";
    modeToggle.textContent = expression.mode === "text" ? "∑" : "T";
    modeToggle.title = expression.mode === "text" ? "Edit as pretty math" : "Edit as text";
    modeToggle.setAttribute("aria-label", modeToggle.title);
    modeToggle.addEventListener("click", () => {
      state.expressions[index] = {
        ...state.expressions[index],
        mode: state.expressions[index].mode === "text" ? "pretty" : "text"
      };
      saveExpressions();
      renderExpressions();
      focusExpression(index);
    });

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

    const actions = document.createElement("div");
    actions.className = "row-actions";
    actions.append(remove, modeToggle);

    body.append(input, result);
    card.append(swatch, body, actions);
    listEl.append(card);
  });
  renderNewExpressionRow();
}

function renderPrettyExpressionInput(expression: ExpressionRow, index: number): MathfieldElement {
  const input = document.createElement("math-field") as MathfieldElement;
  input.className = "expression-input";
  input.setAttribute("aria-label", "Expression");
  input.dataset.expressionIndex = String(index);
  input.value = expression.latex;
  configureMathfield(input);
  input.addEventListener("input", () => {
    updateExpressionLatex(index, input.getValue("latex-unstyled"));
  });
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (escapeInputCommandToText(input, index)) event.preventDefault();
  });
  return input;
}

function renderTextExpressionInput(expression: ExpressionRow, index: number): HTMLTextAreaElement {
  const input = document.createElement("textarea");
  input.className = "expression-input text-expression-input";
  input.setAttribute("aria-label", "Expression text");
  input.dataset.expressionIndex = String(index);
  input.rows = 1;
  input.value = expression.source;
  input.addEventListener("input", () => {
    updateExpressionSource(index, input.value);
  });
  return input;
}

function renderNewExpressionRow(): void {
  const card = document.createElement("article");
  card.className = "expression-card new-expression-row";

  const swatch = document.createElement("div");
  swatch.className = "swatch";

  const body = document.createElement("div");
  body.className = "expression-body";
  const input = document.createElement("math-field") as MathfieldElement;
  input.className = "expression-input";
  input.setAttribute("aria-label", "New expression");
  configureMathfield(input);
  input.addEventListener("input", () => {
    const latex = input.getValue("latex-unstyled");
    const source = latexToSource(latex);
    if (!source.trim()) return;
    const index = state.expressions.length;
    state.expressions.push({ source, latex, mode: "pretty" });
    saveExpressions();
    renderExpressions();
    draw();
    focusExpression(index);
  }, { once: true });

  const result = document.createElement("div");
  result.className = "result";

  const spacer = document.createElement("div");
  spacer.className = "row-actions-spacer";

  body.append(input, result);
  card.append(swatch, body, spacer);
  listEl.append(card);
}

function focusExpression(index: number): void {
  listEl.querySelector<MathfieldElement | HTMLTextAreaElement>(`[data-expression-index="${index}"]`)?.focus();
}

function configureMathfield(input: MathfieldElement): void {
  input.smartSuperscript = true;
  input.smartFence = true;
  input.mathVirtualKeyboardPolicy = "manual";
}

function updateExpressionLatex(index: number, latex: string): void {
  state.expressions[index] = { ...state.expressions[index], source: latexToSource(latex), latex };
  saveExpressions();
  draw();
}

function updateExpressionSource(index: number, source: string): void {
  state.expressions[index] = { ...state.expressions[index], source, latex: sourceToLatex(source) };
  saveExpressions();
  draw();
}

function escapeInputCommandToText(input: MathfieldElement, index: number): boolean {
  const latex = input.getValue("latex-unstyled");
  const cursorLatex = input.getValue(0, input.position, "latex-unstyled").length;
  const escaped = escapeLatexCommandToText(latex, cursorLatex);
  if (escaped === null) return false;

  input.setValue(escaped.latex, { format: "latex" });
  input.position = Math.min(input.lastOffset, Math.max(0, input.position - (cursorLatex - escaped.cursor)));
  updateExpressionLatex(index, input.getValue("latex-unstyled"));
  return true;
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
