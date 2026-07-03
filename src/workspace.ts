import {
  Env,
  RuntimeValue,
  createBaseEnv,
  evaluate,
  isRuntimeFunction,
  makeUserFunction,
  parseExpression,
  usesName
} from "./language.js";

export type Assignment = { name: string; expr: string };
export type NormalizedRow =
  | { kind: "empty" }
  | { kind: "binding"; source: string; name: string; expr: string }
  | { kind: "graph"; source: string; expr: string }
  | { kind: "expression"; source: string; expr: string };
export type RowResult = { ok: boolean; text: string };
export type GraphPoint = [number, number];
export type Plot =
  | { kind: "function" | "expression"; fn: (x: number) => RuntimeValue; label: string; color: string }
  | { kind: "points"; points: GraphPoint[]; label: string; color: string };

export type WorkspaceProgram = {
  rows: RowResult[];
  plots: Plot[];
};

export const colors = ["#d73a31", "#2374ab", "#1f8a5b", "#8f49b8", "#d18b00", "#0b8793", "#c43c78", "#4f6bed"];

export const examples = [
  "f = fn(x) => sin(x) + 0.35 * sin(4 * x)",
  "f",
  "let a = 0.18 in a * x^3 - 2 * x",
  "pts = map(fn(t) => [t, cos(t) + sin(2*t)/2], range(-8, 8, 0.35))",
  "pts",
  "fold(fn(acc, n) => acc + n^2, 0, range(1, 5, 1))"
];

export function compileWorkspace(expressions: string[]): WorkspaceProgram {
  const env = createBaseEnv();
  const rows: RowResult[] = [];
  const plots: Plot[] = [];

  expressions.forEach((source, index) => {
    const row = normalizeRow(source);
    if (row.kind === "empty") {
      rows[index] = { ok: true, text: "" };
      return;
    }

    try {
      const ast = parseExpression(row.expr);
      const label = row.kind === "binding" ? row.name : row.source;

      if ((row.kind === "graph" || row.kind === "expression") && usesName(ast, "x")) {
        const plot: Plot = {
          kind: "expression",
          label,
          color: colors[index % colors.length],
          fn: makeUserFunction(["x"], ast, env)
        };
        plots.push(plot);
        rows[index] = { ok: true, text: `y = ${row.expr}` };
        return;
      }

      const value = evaluate(ast, env);
      if (row.kind === "binding") env.set(row.name, value);

      const plot = makePlot(value, label, colors[index % colors.length]);
      if (plot) plots.push(plot);
      rows[index] = { ok: true, text: summarizeValue(value, row.kind === "binding" ? row : null) };
    } catch (error) {
      rows[index] = { ok: false, text: error instanceof Error ? error.message : String(error) };
    }
  });

  return { rows, plots };
}

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (Math.abs(value) >= 10000 || (Math.abs(value) < 0.001 && value !== 0)) return value.toExponential(2);
  return Number(value.toFixed(4)).toString();
}

export function normalizeRow(source: string): NormalizedRow {
  const text = source.trim();
  if (!text) return { kind: "empty" };

  const assignment = splitTopLevelAssignment(text);
  if (!assignment) return { kind: "expression", source: text, expr: text };
  if (assignment.name === "y") return { kind: "graph", source: text, expr: assignment.expr };
  return { kind: "binding", source: text, name: assignment.name, expr: assignment.expr };
}

export function isPoint(value: RuntimeValue): value is GraphPoint {
  return Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);
}

function makePlot(value: RuntimeValue, label: string, color: string): Plot | null {
  if (isRuntimeFunction(value) && value.arity >= 1) {
    return { kind: "function", fn: value, label, color };
  }
  if (Array.isArray(value) && value.every(isPoint)) {
    return { kind: "points", points: value, label, color };
  }
  return null;
}

function splitTopLevelAssignment(source: string): Assignment | null {
  let depth = 0;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth--;
    if (ch === "=" && source[i + 1] !== ">" && source[i - 1] !== "=" && depth === 0) {
      const name = source.slice(0, i).trim();
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
        return { name, expr: source.slice(i + 1).trim() };
      }
    }
  }
  return null;
}

function summarizeValue(value: RuntimeValue, binding: Extract<NormalizedRow, { kind: "binding" }> | null): string {
  const prefix = binding ? `${binding.name}: ` : "";
  if (isRuntimeFunction(value)) return `${prefix}fn/${value.arity}`;
  if (Array.isArray(value)) return `${prefix}[${value.slice(0, 4).map(formatValue).join(", ")}${value.length > 4 ? ", ..." : ""}]`;
  return `${prefix}${formatValue(value)}`;
}

function formatValue(value: RuntimeValue): string {
  if (typeof value === "number") return formatNumber(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.map(formatValue).join(", ")}]`;
  if (isRuntimeFunction(value)) return `fn/${value.arity}`;
  return String(value);
}
