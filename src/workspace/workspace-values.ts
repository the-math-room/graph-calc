import { ParametricCurve, RuntimeValue, isComplex, isParametricCurve, isRuntimeFunction } from "../core/language.js";
import { NormalizedRow } from "./workspace-normalize.js";

export type RowResult = { ok: boolean; text: string };
export type GraphPoint = [number, number];
export type Plot =
  | { kind: "function" | "expression"; fn: (x: number) => RuntimeValue; label: string; color: string }
  | { kind: "region"; predicate: (x: number, y: number) => boolean; boundaryStyle: "inclusive" | "strict" | "mixed"; label: string; color: string }
  | { kind: "parametric"; curve: ParametricCurve; label: string; color: string }
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
  "parametric(fn(t) => [cos(t), sin(t)], 0, 2*pi)",
  "pts = map(fn(t) => [t, cos(t) + sin(2*t)/2], range(-8, 8, 0.35))",
  "pts",
  "fold(fn(acc, n) => acc + n^2, 0, range(1, 5, 1))"
];

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (Math.abs(value) >= 10000 || (Math.abs(value) < 0.001 && value !== 0)) return value.toExponential(2);
  return Number(value.toFixed(4)).toString();
}

export function summarizeValue(
  value: RuntimeValue,
  binding: Extract<NormalizedRow, { kind: "binding" | "function-binding" | "case-binding" }> | null
): string {
  const prefix = binding ? `${binding.name}: ` : "";
  if (isRuntimeFunction(value)) return `${prefix}fn/${value.arity}`;
  if (isParametricCurve(value)) return `${prefix}parametric`;
  if (Array.isArray(value)) return `${prefix}[${value.slice(0, 4).map(formatValue).join(", ")}${value.length > 4 ? ", ..." : ""}]`;
  return `${prefix}${formatValue(value)}`;
}

export function formatValue(value: RuntimeValue): string {
  if (typeof value === "number") return formatNumber(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.map(formatValue).join(", ")}]`;
  if (isRuntimeFunction(value)) return `fn/${value.arity}`;
  if (isParametricCurve(value)) return "parametric";
  if (isComplex(value)) return `${formatNumber(value.re)} ${value.im < 0 ? "-" : "+"} ${formatNumber(Math.abs(value.im))}i`;
  return String(value);
}

export function isPoint(value: RuntimeValue): value is GraphPoint {
  return Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);
}

export function makePlot(value: RuntimeValue, label: string, color: string, row: Exclude<NormalizedRow, { kind: "empty" }>): Plot | null {
  if (isParametricCurve(value)) {
    return { kind: "parametric", curve: value, label, color };
  }
  if (isRuntimeFunction(value) && value.arity >= 1) {
    return { kind: "function", fn: value, label, color };
  }
  if (Array.isArray(value) && value.every(isPoint)) {
    return { kind: "points", points: value, label, color };
  }
  if ((row.kind === "graph" || row.kind === "expression") && typeof value === "number") {
    return { kind: "expression", fn: () => value, label, color };
  }
  return null;
}
