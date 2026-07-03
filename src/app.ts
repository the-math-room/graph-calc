import "mathlive";
import "mathlive/fonts.css";
import type { MathfieldElement } from "mathlive";
import { clamp } from "./language.js";
import { createGraphView } from "./graph-view.js";
import { escapeLatexCommandToText, latexToSource, sourceToLatex } from "./math-syntax.js";
import { WorkspaceProgram, colors, compileWorkspace, examples } from "./workspace.js";

type ExpressionMode = "pretty" | "text";
type ExpressionRow = { source: string; latex: string; mode: ExpressionMode };

type AppState = {
  expressions: ExpressionRow[];
  expressionSizeScale: number;
};

const state: AppState = {
  expressions: loadExpressions(),
  expressionSizeScale: loadExpressionSizeScale()
};

const canvas = requireElement<HTMLCanvasElement>("#graph");
const listEl = requireElement<HTMLElement>("#expression-list");
const readoutEl = requireElement<HTMLOutputElement>("#cursor-readout");
const expressionSizeEl = requireElement<HTMLInputElement>("#expression-size");
const sidebarResizerEl = requireElement<HTMLElement>("#sidebar-resizer");
const keyboardToggleEl = requireElement<HTMLButtonElement>("#toggle-keyboard");
const graphView = createGraphView(
  canvas,
  readoutEl
);

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
requireElement<HTMLButtonElement>("#zoom-in").addEventListener("click", () => graphView.zoomAt(1.25));
requireElement<HTMLButtonElement>("#zoom-out").addEventListener("click", () => graphView.zoomAt(0.8));
requireElement<HTMLButtonElement>("#reset-view").addEventListener("click", graphView.reset);

window.addEventListener("resize", refreshWorkspace);
sidebarResizerEl.addEventListener("pointerdown", startSidebarResize);
window.mathVirtualKeyboard.addEventListener("virtual-keyboard-toggle", updateKeyboardToggleState);

renderExpressions();
refreshWorkspace();
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
    refreshWorkspace();
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
  refreshWorkspace();
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
      refreshWorkspace();
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
    refreshWorkspace();
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
  refreshWorkspace();
}

function updateExpressionSource(index: number, source: string): void {
  state.expressions[index] = { ...state.expressions[index], source, latex: sourceToLatex(source) };
  saveExpressions();
  refreshWorkspace();
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

function updateResults(program: WorkspaceProgram): void {
  program.rows.forEach((row, index) => {
    const el = listEl.querySelector(`[data-result-for="${index}"]`);
    if (!el) return;
    el.textContent = row.text;
    el.classList.toggle("error", !row.ok);
  });
}

function refreshWorkspace(): void {
  const program = compileWorkspace(state.expressions.map((expression) => expression.source));
  updateResults(program);
  graphView.draw(program.plots);
}
