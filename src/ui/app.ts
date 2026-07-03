import "mathlive";
import "mathlive/fonts.css";
import type { MathfieldElement } from "mathlive";
import { clamp } from "../core/language.js";
import { createGraphView } from "./graph-view.js";
import { latexToSource, sourceToLatex } from "../syntax/math-syntax.js";
import {
  RowResult,
  WorkspaceFileV1,
  colorForKey,
  compileWorkspace,
  examples,
  readWorkspaceFile,
  workspaceFileSchema
} from "../workspace/workspace.js";
import { GraphViewport, SampledPlot, sampleWorkspacePlots } from "../workspace/workspace-sampling.js";
import { ExpressionMode, ExpressionRow, focusExpression as focusExpressionInput, focusNewExpression, renderExpressionList } from "./expression-list.js";
import { graphInteraction } from "./graph-interaction-config.js";
import { copyText, rowDiagnostics } from "./row-diagnostics.js";

type CurrentProgram = { rows: RowResult[]; plots: SampledPlot[]; viewport: GraphViewport };

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
  readoutEl,
  (viewport) => {
    if (viewport.interactive) {
      scheduleWorkspaceRefresh(graphInteraction.interactiveRefreshMs, "throttle");
    } else {
      scheduleWorkspaceRefresh(0);
    }
  }
);
let currentProgram: CurrentProgram | null = null;
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
  if (typeof value === "string") return createExpressionRow(value, sourceToLatex(value), "pretty");
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<ExpressionRow>;
  if (typeof row.source !== "string") return null;
  return {
    id: typeof row.id === "string" ? row.id : newExpressionId(),
    source: row.source,
    latex: typeof row.latex === "string" ? row.latex : sourceToLatex(row.source),
    mode: row.mode === "text" ? "text" : "pretty"
  };
}

function exampleRows(): ExpressionRow[] {
  return examples.map((source) => createExpressionRow(source, sourceToLatex(source), "pretty"));
}

function createExpressionRow(source: string, latex: string, mode: ExpressionMode): ExpressionRow {
  return { id: newExpressionId(), source, latex, mode };
}

function newExpressionId(): string {
  return `row-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
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
      id: expression.id,
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
    id: row.id ?? newExpressionId(),
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
    focusNewExpression(listEl);
    return;
  }
  state.expressions.push(createExpressionRow(source, sourceToLatex(source), mode));
  saveExpressions();
  renderExpressions();
  refreshWorkspace();
  focusExpression(state.expressions.length - 1);
}

function insertParametricTemplate(): void {
  addExpression("(cos(t), sin(t)) {0 <= t <= 2*pi}", "text");
}

function renderExpressions(): void {
  renderExpressionList(listEl, state.expressions, {
    onLatexChange: updateExpressionLatex,
    onSourceChange: updateExpressionSource,
    onModeToggle(index) {
      state.expressions[index] = {
        ...state.expressions[index],
        mode: state.expressions[index].mode === "text" ? "pretty" : "text"
      };
      saveExpressions();
      renderExpressions();
      focusExpression(index);
    },
    onRemove(index) {
      state.expressions.splice(index, 1);
      saveExpressions();
      renderExpressions();
      refreshWorkspace();
    },
    onMove(fromIndex, toIndex) {
      moveExpression(fromIndex, toIndex);
    },
    onParametricTemplate(index, template) {
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
    },
    onCommitNew: commitNewExpression,
    onDiagnostics: copyRowDiagnostics
  });
}

function moveExpression(fromIndex: number, toIndex: number): void {
  if (fromIndex < 0 || fromIndex >= state.expressions.length) return;
  const target = Math.max(0, Math.min(state.expressions.length, toIndex));
  if (target === fromIndex || target === fromIndex + 1) return;

  const [expression] = state.expressions.splice(fromIndex, 1);
  const adjustedTarget = target > fromIndex ? target - 1 : target;
  state.expressions.splice(adjustedTarget, 0, expression);
  saveExpressions();
  renderExpressions();
  refreshWorkspace();
  focusExpression(adjustedTarget);
}

function commitNewExpression(source: string, latex: string, mode: ExpressionMode): void {
  const trimmed = source.trim();
  if (!trimmed) return;
  const index = state.expressions.length;
  state.expressions.push(createExpressionRow(trimmed, latex, mode));
  saveExpressions();
  renderExpressions();
  refreshWorkspace();
  focusExpression(index);
}

function focusExpression(index: number): void {
  focusExpressionInput(listEl, index);
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

function updateResults(program: CurrentProgram): void {
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
  const program = compileAndSampleWorkspace();
  currentProgram = program;
  updateResults(program);
  graphView.draw(program.plots, program.viewport);
}

function scheduleWorkspaceRefresh(delay = 80, mode: "debounce" | "throttle" = "debounce"): void {
  currentProgram = null;
  if (mode === "throttle" && refreshTimer !== null) return;
  if (refreshTimer !== null) window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(refreshWorkspace, delay);
}

async function copyRowDiagnostics(index: number, button: HTMLButtonElement): Promise<void> {
  const program = currentProgram ?? compileAndSampleWorkspace();
  const text = rowDiagnostics(index, state.expressions, program);
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

function compileAndSampleWorkspace(): CurrentProgram {
  const program = compileWorkspace(
    state.expressions.map((expression) => expression.source),
    state.expressions.map((expression) => colorForKey(expression.id))
  );
  const viewport = graphView.viewport();
  return {
    rows: program.rows,
    plots: sampleWorkspacePlots(program.plots, viewport),
    viewport
  };
}
