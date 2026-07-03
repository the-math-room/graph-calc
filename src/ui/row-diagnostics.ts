import type { NormalizedRow, RowResult } from "../workspace/workspace.js";
import { normalizeRow } from "../workspace/workspace.js";
import type { SampledPlot } from "../workspace/workspace-sampling.js";
import type { ExpressionRow } from "./expression-list.js";

export type DiagnosticProgram = { rows: RowResult[]; plots: SampledPlot[] };

export function rowDiagnostics(index: number, expressions: ExpressionRow[], program: DiagnosticProgram): string {
  const expression = expressions[index];
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

export async function copyText(text: string): Promise<void> {
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

function formatPlotDiagnostic(plot: SampledPlot): string {
  const base = `${plot.kind} label=${formatDiagnosticValue(plot.label)}`;
  if (plot.kind === "region-grid") {
    return `${base} boundaryStyle=${plot.boundaryStyle} cells=${plot.cells.length}`;
  }
  if (plot.kind === "smooth-region") {
    return `${base} boundaryStyle=${plot.boundaryStyle} points=${plot.points.length}`;
  }
  if (plot.kind === "points") return `${base} count=${plot.points.length}`;
  if (plot.kind === "polyline") return `${base} segments=${plot.segments.length}`;
  return base;
}
