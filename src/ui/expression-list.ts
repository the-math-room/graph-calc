import type { MathfieldElement } from "mathlive";
import { escapeLatexCommandToText, latexToSource, sourceToLatex } from "../syntax/math-syntax.js";
import { colorForKey, parametricPromptFor } from "../workspace/workspace.js";

export type ExpressionMode = "pretty" | "text";
export type ExpressionRow = { id: string; source: string; latex: string; mode: ExpressionMode };

export type ExpressionListCallbacks = {
  onLatexChange(index: number, latex: string): void;
  onSourceChange(index: number, source: string): void;
  onModeToggle(index: number): void;
  onMove(fromIndex: number, toIndex: number): void;
  onRemove(index: number): void;
  onParametricTemplate(index: number, template: string): void;
  onCommitNew(source: string, latex: string, mode: ExpressionMode): void;
  onDiagnostics(index: number, button: HTMLButtonElement): void;
};

export function renderExpressionList(listEl: HTMLElement, expressions: ExpressionRow[], callbacks: ExpressionListCallbacks): void {
  listEl.replaceChildren();
  expressions.forEach((expression, index) => {
    const card = document.createElement("article");
    card.className = "expression-card";
    card.dataset.expressionCardIndex = String(index);
    card.addEventListener("dragover", (event) => {
      event.preventDefault();
      const position = dragPosition(event, card);
      card.classList.toggle("drop-before", position === "before");
      card.classList.toggle("drop-after", position === "after");
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    });
    card.addEventListener("dragleave", () => clearDropClasses(card));
    card.addEventListener("drop", (event) => {
      event.preventDefault();
      clearDropClasses(card);
      const from = Number(event.dataTransfer?.getData("text/plain") ?? NaN);
      if (!Number.isInteger(from)) return;
      const position = dragPosition(event, card);
      const to = position === "before" ? index : index + 1;
      callbacks.onMove(from, to);
    });

    const swatchRail = document.createElement("div");
    swatchRail.className = "swatch-rail";
    swatchRail.draggable = true;
    swatchRail.tabIndex = 0;
    swatchRail.title = "Drag to reorder";
    swatchRail.setAttribute("role", "button");
    swatchRail.setAttribute("aria-label", "Drag expression to reorder");
    swatchRail.addEventListener("dragstart", (event) => {
      card.classList.add("is-dragging");
      if (!event.dataTransfer) return;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", String(index));
    });
    swatchRail.addEventListener("dragend", () => {
      card.classList.remove("is-dragging");
      listEl.querySelectorAll(".drop-before, .drop-after").forEach((element) => clearDropClasses(element));
    });

    const swatch = document.createElement("div");
    swatch.className = "swatch";
    swatch.style.background = colorForKey(expression.id);
    swatchRail.append(swatch);

    const body = document.createElement("div");
    body.className = "expression-body";
    const input = expression.mode === "text"
      ? renderTextExpressionInput(expression, index, callbacks)
      : renderPrettyExpressionInput(expression, index, callbacks);

    const result = document.createElement("div");
    result.className = "result";
    result.dataset.resultFor = String(index);
    const prompt = renderParametricPrompt(expression, index, callbacks);

    const modeToggle = document.createElement("button");
    modeToggle.className = "row-tool-button";
    modeToggle.type = "button";
    modeToggle.textContent = expression.mode === "text" ? "∑" : "T";
    modeToggle.title = expression.mode === "text" ? "Edit as pretty math" : "Edit as text";
    modeToggle.setAttribute("aria-label", modeToggle.title);
    modeToggle.addEventListener("click", () => callbacks.onModeToggle(index));

    const remove = document.createElement("button");
    remove.className = "remove-button";
    remove.type = "button";
    remove.textContent = "x";
    remove.title = "Remove";
    remove.setAttribute("aria-label", "Remove expression");
    remove.addEventListener("click", () => callbacks.onRemove(index));

    const diagnostics = document.createElement("button");
    diagnostics.className = "row-tool-button diagnostic-button";
    diagnostics.type = "button";
    diagnostics.textContent = "D";
    diagnostics.title = "Copy diagnostics";
    diagnostics.setAttribute("aria-label", "Copy row diagnostics");
    diagnostics.addEventListener("click", () => callbacks.onDiagnostics(index, diagnostics));

    const actions = document.createElement("div");
    actions.className = "row-actions";
    actions.append(remove, modeToggle, diagnostics);

    body.append(input, prompt, result);
    card.append(swatchRail, body, actions);
    listEl.append(card);
  });
  renderNewExpressionRow(listEl, callbacks);
}

function dragPosition(event: DragEvent, card: HTMLElement): "before" | "after" {
  const rect = card.getBoundingClientRect();
  return event.clientY < rect.top + rect.height / 2 ? "before" : "after";
}

function clearDropClasses(element: Element): void {
  element.classList.remove("drop-before", "drop-after");
}

export function focusExpression(listEl: HTMLElement, index: number): void {
  listEl.querySelector<MathfieldElement | HTMLTextAreaElement>(`[data-expression-index="${index}"]`)?.focus();
}

export function focusNewExpression(listEl: HTMLElement): void {
  listEl.querySelector<MathfieldElement>(".new-expression-row math-field")?.focus();
}

function renderPrettyExpressionInput(expression: ExpressionRow, index: number, callbacks: ExpressionListCallbacks): MathfieldElement {
  const input = document.createElement("math-field") as MathfieldElement;
  input.className = "expression-input";
  input.setAttribute("aria-label", "Expression");
  input.dataset.expressionIndex = String(index);
  input.value = expression.latex;
  configureMathfield(input);
  input.addEventListener("input", () => callbacks.onLatexChange(index, input.getValue("latex-unstyled")));
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (escapeInputCommandToText(input, index, callbacks)) event.preventDefault();
  });
  return input;
}

function renderTextExpressionInput(expression: ExpressionRow, index: number, callbacks: ExpressionListCallbacks): HTMLTextAreaElement {
  const input = document.createElement("textarea");
  input.className = "expression-input text-expression-input";
  input.setAttribute("aria-label", "Expression text");
  input.dataset.expressionIndex = String(index);
  input.rows = 1;
  input.value = expression.source;
  input.addEventListener("input", () => callbacks.onSourceChange(index, input.value));
  return input;
}

function renderParametricPrompt(expression: ExpressionRow, index: number, callbacks: ExpressionListCallbacks): HTMLElement {
  const prompt = document.createElement("div");
  prompt.className = "parametric-prompt";
  renderLiveParametricPrompt(prompt, expression.source, (template) => callbacks.onParametricTemplate(index, template));
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

function renderNewExpressionRow(listEl: HTMLElement, callbacks: ExpressionListCallbacks): void {
  const card = document.createElement("article");
  card.className = "expression-card new-expression-row";

  const swatch = document.createElement("div");
  swatch.className = "swatch";
  const swatchRail = document.createElement("div");
  swatchRail.className = "swatch-rail";
  swatchRail.append(swatch);

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
    callbacks.onCommitNew(source, latex, "pretty");
  };
  input.addEventListener("input", () => {
    renderLiveParametricPrompt(prompt, latexToSource(input.getValue("latex-unstyled")), (template) => {
      committingPrompt = true;
      callbacks.onCommitNew(template, sourceToLatex(template), "pretty");
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
  card.append(swatchRail, body, spacer);
  listEl.append(card);
}

function configureMathfield(input: MathfieldElement): void {
  input.smartSuperscript = true;
  input.smartFence = true;
  input.mathVirtualKeyboardPolicy = "manual";
}

function escapeInputCommandToText(input: MathfieldElement, index: number, callbacks: ExpressionListCallbacks): boolean {
  const latex = input.getValue("latex-unstyled");
  const cursorLatex = input.getValue(0, input.position, "latex-unstyled").length;
  const escaped = escapeLatexCommandToText(latex, cursorLatex);
  if (escaped === null) return false;

  input.setValue(escaped.latex, { format: "latex" });
  input.position = Math.min(input.lastOffset, Math.max(0, input.position - (cursorLatex - escaped.cursor)));
  callbacks.onLatexChange(index, input.getValue("latex-unstyled"));
  return true;
}
