import { isIdentifier, splitTopLevelComma } from "./source-structure.js";

export type CoordinatePair = { x: string; y: string };
export type ParametricRange = { variable: string; lo: string; hi: string };
export type ParametricSource = CoordinatePair & ParametricRange;

export function parseParametricSource(source: string): ParametricSource | null {
  const restrictionStart = findTrailingRestrictionStart(source.trim());
  if (restrictionStart === -1) return null;

  const point = parseCoordinatePair(source.slice(0, restrictionStart).trim());
  const range = parseParametricRestriction(source.slice(restrictionStart).trim());
  if (!point || !range) return null;
  return { ...point, ...range };
}

export function parseCoordinatePair(source: string): CoordinatePair | null {
  if (!source.startsWith("(") || !source.endsWith(")")) return null;
  const inner = source.slice(1, -1).trim();
  const parts = splitTopLevelComma(inner);
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { x: parts[0], y: parts[1] };
}

export function parseParametricRestriction(source: string): ParametricRange | null {
  if (!source.startsWith("{") || !source.endsWith("}")) return null;
  return parseParametricRangeExpression(source.slice(1, -1).trim());
}

export function parseParametricRangeExpression(source: string): ParametricRange | null {
  const match = splitChainedInequality(source);
  if (!match) return null;
  if (isLessThanComparison(match.leftOp) && isLessThanComparison(match.rightOp)) {
    return { variable: match.variable, lo: match.leftExpr, hi: match.rightExpr };
  }
  if (isGreaterThanComparison(match.leftOp) && isGreaterThanComparison(match.rightOp)) {
    return { variable: match.variable, lo: match.rightExpr, hi: match.leftExpr };
  }
  return null;
}

export function findTrailingRestrictionStart(source: string): number {
  let depth = 0;
  for (let index = source.length - 1; index >= 0; index--) {
    const ch = source[index];
    if (ch === "}" || ch === ")" || ch === "]") depth++;
    if (ch === "{" || ch === "(" || ch === "[") depth--;
    if (ch === "{" && depth === 0) return index;
  }
  return -1;
}

function splitChainedInequality(source: string): { leftExpr: string; leftOp: string; variable: string; rightOp: string; rightExpr: string } | null {
  const first = findTopLevelComparison(source, 0);
  if (!first) return null;
  const second = findTopLevelComparison(source, first.end);
  if (!second) return null;

  const leftExpr = source.slice(0, first.start).trim();
  const variable = source.slice(first.end, second.start).trim();
  const rightExpr = source.slice(second.end).trim();
  if (!leftExpr || !rightExpr || !isIdentifier(variable)) return null;
  return { leftExpr, leftOp: first.op, variable, rightOp: second.op, rightExpr };
}

function findTopLevelComparison(source: string, start: number): { start: number; end: number; op: string } | null {
  let depth = 0;
  for (let index = start; index < source.length; index++) {
    const ch = source[index];
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth--;
    if (depth !== 0) continue;

    const two = source.slice(index, index + 2);
    if (two === "<=" || two === ">=") return { start: index, end: index + 2, op: two };
    if (ch === "<" || ch === ">") return { start: index, end: index + 1, op: ch };
  }
  return null;
}

function isLessThanComparison(op: string): boolean {
  return op === "<" || op === "<=";
}

function isGreaterThanComparison(op: string): boolean {
  return op === ">" || op === ">=";
}
