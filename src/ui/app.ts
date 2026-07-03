import "mathlive";
import "mathlive/fonts.css";
import type { MathfieldElement } from "mathlive";
import { clamp } from "../core/language.js";
import { createGraphView } from "./graph-view.js";
import { escapeLatexCommandToText, latexToSource, sourceToLatex } from "../syntax/math-syntax.js";
import {
  NormalizedRow,
  Plot,
  WorkspaceFileV1,
  WorkspaceProgram,
  colors,
  compileWorkspace,
  examples,
  normalizeRow,
  parametricPromptFor,
  readWorkspaceFile,
  workspaceFileSchema
} from "../workspace/workspace.js";

type ExpressionMode = "pretty" | "text";
type ExpressionRow = { source: string; latex: string; mode: ExpressionMode };

type AppState = {
  expressions: ExpressionRow[];
  expressionSizeScale: number;
  sidebarWidth: number;
};

const state: AppState = {
  expressions: loadExpressions(),
  expressionSizeScale: loadExpressionSizeScale(),
  sidebarWidth: loadSidebarWidth()
};

const canvas = requireElement<HTMLCanvasElement>("#graph");
const listEl = requireElement<HTMLElement>("#expression-list");
const readoutEl = requireElement<HTMLOutputElement>("#cursor-readout");
const expressionSizeEl = requireElement<HTMLInputElement>("#expression-size");
const sidebarResizerEl = requireElement<HTMLElement>("#sidebar-resizer");
const keyboardToggleEl = requireElement<HTMLButtonElement>("#toggle-keyboard");
const importWorkspaceFileEl = requireElement<HTMLInputElement>("#import-workspace-file");
const graphView = createGraphView(
  canvas,
  readoutEl
);
let currentProgram: WorkspaceProgram | null = null;
let refreshTimer: number | null = null;

requireElement<HTMLButtonElement>("#add-expression").addEventListener("click", () => addExpression(""));
requireElement<HTMLButtonElement>("#insert-parametric").addEventListener("click", insertParametricTemplate);
requireElement<HTMLButtonElement>("#export-workspace").addEventListener("click", exportWorkspace);
requireElement<HTMLButtonElement>("#import-workspace").addEventListener("click", () => importWorkspaceFileEl.click());
importWorkspaceFileEl.addEventListener("change", importWorkspace);
keyboardToggleEl.addEventListener("click", toggleVirtualKeyboard);
applySidebarWidth(state.sidebarWidth);
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

window.addEventListener("resize", () => graphView.redraw());
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

function currentWorkspaceFile(): WorkspaceFileV1 {
  return {
    schema: workspaceFileSchema,
    rows: state.expressions.map((expression) => ({
      source: expression.source,
      latex: expression.latex,
      mode: expression.mode
    })),
    view: {
      expressionSizeScale: state.expressionSizeScale,
      sidebarWidth: state.sidebarWidth
    }
  };
}

function exportWorkspace(): void {
  const text = JSON.stringify(currentWorkspaceFile(), null, 2);
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "lambda-graph-workspace.json";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function importWorkspace(): Promise<void> {
  const file = importWorkspaceFileEl.files?.[0];
  importWorkspaceFileEl.value = "";
  if (!file) return;

  try {
    const value: unknown = JSON.parse(await file.text());
    const workspaceFile = readWorkspaceFile(value);
    if (!workspaceFile) throw new Error("Not a valid Lambda Graph workspace file.");
    applyWorkspaceFile(workspaceFile);
  } catch (error) {
    alert(error instanceof Error ? error.message : "Could not import workspace.");
  }
}

function applyWorkspaceFile(file: WorkspaceFileV1): void {
  state.expressions = file.rows.map((row) => ({
    source: row.source,
    latex: row.latex ?? sourceToLatex(row.source),
    mode: row.mode
  }));

  if (file.view?.expressionSizeScale !== undefined) {
    state.expressionSizeScale = clamp(file.view.expressionSizeScale, 0, 100);
    expressionSizeEl.value = String(state.expressionSizeScale);
    localStorage.setItem("lambda-graph-expression-size-scale", String(state.expressionSizeScale));
    applyExpressionSize();
  }
  if (file.view?.sidebarWidth !== undefined) {
    const width = applySidebarWidth(file.view.sidebarWidth);
    localStorage.setItem("lambda-graph-sidebar-width", String(width));
  }

  saveExpressions();
  renderExpressions();
  refreshWorkspace();
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

function applySidebarWidth(width: number): number {
  const clamped = clamp(width, 320, Math.max(320, window.innerWidth - 360));
  state.sidebarWidth = clamped;
  document.documentElement.style.setProperty("--sidebar-width", `${clamped}px`);
  return clamped;
}

function startSidebarResize(event: PointerEvent): void {
  event.preventDefault();
  sidebarResizerEl.setPointerCapture(event.pointerId);

  const onMove = (moveEvent: PointerEvent): void => {
    const width = moveEvent.clientX;
    const clamped = applySidebarWidth(width);
    localStorage.setItem("lambda-graph-sidebar-width", String(clamped));
    graphView.redraw();
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

function addExpression(source: string, mode: ExpressionMode = "pretty"): void {
  if (!source) {
    listEl.querySelector<MathfieldElement>(".new-expression-row math-field")?.focus();
    return;
  }
  state.expressions.push({ source, latex: sourceToLatex(source), mode });
  saveExpressions();
  renderExpressions();
  refreshWorkspace();
  focusExpression(state.expressions.length - 1);
}

function insertParametricTemplate(): void {
  addExpression("(cos(t), sin(t)) {0 <= t <= 2*pi}", "text");
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
    const prompt = renderParametricPrompt(expression, index);

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

    const diagnostics = document.createElement("button");
    diagnostics.className = "row-tool-button diagnostic-button";
    diagnostics.type = "button";
    diagnostics.textContent = "D";
    diagnostics.title = "Copy diagnostics";
    diagnostics.setAttribute("aria-label", "Copy row diagnostics");
    diagnostics.addEventListener("click", () => {
      copyRowDiagnostics(index, diagnostics);
    });

    const actions = document.createElement("div");
    actions.className = "row-actions";
    actions.append(remove, modeToggle, diagnostics);

    body.append(input, prompt, result);
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

function renderParametricPrompt(expression: ExpressionRow, index: number): HTMLElement {
  const prompt = document.createElement("div");
  prompt.className = "parametric-prompt";
  renderLiveParametricPrompt(prompt, expression.source, (template) => {
    state.expressions[index] = {
      ...state.expressions[index],
      source: template,
      latex: sourceToLatex(template),
      mode: "pretty"
    };
    saveExpressions();
    renderExpressions();
    refreshWorkspace();
    focusExpression(index);
  });
  return prompt;
}

function renderLiveParametricPrompt(prompt: HTMLElement, source: string, accept: (template: string) => void): void {
  prompt.replaceChildren();
  const suggestion = parametricPromptFor(source);
  if (!suggestion) {
    prompt.hidden = true;
    return;
  }

  prompt.hidden = false;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "parametric-prompt-button";
  button.textContent = `Add ${suggestion.variable} range`;
  button.title = "Add parameter bounds";
  button.setAttribute("aria-label", `Add ${suggestion.variable} range to this parametric curve`);
  button.addEventListener("click", () => accept(suggestion.template));

  const preview = document.createElement("code");
  preview.textContent = `{0 <= ${suggestion.variable} <= 2*pi}`;
  prompt.append(button, preview);
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

  const result = document.createElement("div");
  result.className = "result";
  const prompt = document.createElement("div");
  prompt.className = "parametric-prompt";
  prompt.hidden = true;
  let committingPrompt = false;

  const commit = (): void => {
    if (committingPrompt) return;
    const latex = input.getValue("latex-unstyled");
    const source = latexToSource(latex);
    if (!source.trim()) return;
    commitNewExpression(source, latex, "pretty");
  };
  input.addEventListener("input", () => {
    renderLiveParametricPrompt(prompt, latexToSource(input.getValue("latex-unstyled")), (template) => {
      committingPrompt = true;
      commitNewExpression(template, sourceToLatex(template), "pretty");
    });
  });
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    commit();
  });
  input.addEventListener("blur", commit);

  const spacer = document.createElement("div");
  spacer.className = "row-actions-spacer";

  body.append(input, prompt, result);
  card.append(swatch, body, spacer);
  listEl.append(card);
}

function commitNewExpression(source: string, latex: string, mode: ExpressionMode): void {
  const trimmed = source.trim();
  if (!trimmed) return;
  const index = state.expressions.length;
  state.expressions.push({ source: trimmed, latex, mode });
  saveExpressions();
  renderExpressions();
  refreshWorkspace();
  focusExpression(index);
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
  scheduleWorkspaceRefresh();
}

function updateExpressionSource(index: number, source: string): void {
  state.expressions[index] = { ...state.expressions[index], source, latex: sourceToLatex(source) };
  saveExpressions();
  scheduleWorkspaceRefresh();
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
  if (refreshTimer !== null) {
    window.clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  const program = compileWorkspace(state.expressions.map((expression) => expression.source));
  currentProgram = program;
  updateResults(program);
  graphView.draw(program.plots);
}

function scheduleWorkspaceRefresh(): void {
  currentProgram = null;
  if (refreshTimer !== null) window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(refreshWorkspace, 80);
}

async function copyRowDiagnostics(index: number, button: HTMLButtonElement): Promise<void> {
  const program = currentProgram ?? compileWorkspace(state.expressions.map((expression) => expression.source));
  const text = rowDiagnostics(index, program);
  const originalText = button.textContent ?? "D";
  const originalTitle = button.title;

  try {
    await copyText(text);
    button.textContent = "✓";
    button.title = "Copied diagnostics";
  } catch (error) {
    button.textContent = "!";
    button.title = error instanceof Error ? error.message : "Could not copy diagnostics";
  } finally {
    setTimeout(() => {
      button.textContent = originalText;
      button.title = originalTitle;
    }, 1200);
  }
}

function rowDiagnostics(index: number, program: WorkspaceProgram): string {
  const expression = state.expressions[index];
  const row = program.rows[index];
  const normalized = expression ? normalizeRow(expression.source) : { kind: "empty" } satisfies NormalizedRow;
  const plots = program.plots.filter((plot) => plot.rowIndex === index);

  return [
    `row: ${index + 1}`,
    `mode: ${expression?.mode ?? "missing"}`,
    `latex: ${formatDiagnosticValue(expression?.latex ?? "")}`,
    `source: ${formatDiagnosticValue(expression?.source ?? "")}`,
    `normalized: ${formatNormalizedRow(normalized)}`,
    `result: ${row ? `${row.ok ? "ok" : "error"}: ${row.text}` : "missing"}`,
    `plots: ${plots.length === 0 ? "none" : ""}`,
    ...plots.map((plot) => `- ${formatPlotDiagnostic(plot)}`)
  ].filter((line) => line !== "plots: ").join("\n");
}

function formatDiagnosticValue(value: string): string {
  return JSON.stringify(value);
}

function formatNormalizedRow(row: NormalizedRow): string {
  switch (row.kind) {
    case "empty":
      return "empty";
    case "binding":
      return `binding name=${row.name} expr=${formatDiagnosticValue(row.expr)}`;
    case "function-binding":
      return `function-binding name=${row.name} params=(${row.params.join(", ")}) expr=${formatDiagnosticValue(row.expr)}`;
    case "case-binding":
      return `case-binding name=${row.name} args=(${row.args.join(", ")}) expr=${formatDiagnosticValue(row.expr)}`;
    case "graph":
      return `graph expr=${formatDiagnosticValue(row.expr)}`;
    case "expression":
      return `expression expr=${formatDiagnosticValue(row.expr)}`;
  }
}

function formatPlotDiagnostic(plot: Plot): string {
  const base = `${plot.kind} label=${formatDiagnosticValue(plot.label)}`;
  if (plot.kind === "region") {
    const smooth = plot.smoothBoundary ? ` smoothBoundary=${plot.smoothBoundary.axis} ${plot.smoothBoundary.fillSide}` : " smoothBoundary=none";
    return `${base} boundaryStyle=${plot.boundaryStyle}${smooth}`;
  }
  if (plot.kind === "points") return `${base} count=${plot.points.length}`;
  if (plot.kind === "parametric") return `${base} range=[${plot.curve.lo}, ${plot.curve.hi}]`;
  return base;
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to the textarea copy path.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.setAttribute("readonly", "true");
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Could not copy diagnostics");
}
