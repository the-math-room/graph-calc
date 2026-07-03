import { findMatchingParen, isIdentifier, splitTopLevelComma } from "../core/source-structure.js";
import { findTrailingRestrictionStart, parseCoordinatePair, parseParametricSource } from "../syntax/parametric-syntax.js";

export type Assignment = { name: string; expr: string };
type TopLevelEquation = { left: string; right: string };

export type NormalizedRow =
  | { kind: "empty" }
  | { kind: "binding"; source: string; name: string; expr: string }
  | { kind: "function-binding"; source: string; name: string; params: string[]; expr: string }
  | { kind: "case-binding"; source: string; name: string; args: string[]; expr: string }
  | { kind: "graph"; source: string; expr: string }
  | { kind: "expression"; source: string; expr: string };

export function normalizeRow(source: string): NormalizedRow {
  const text = source.trim();
  if (!text) return { kind: "empty" };

  const parametric = normalizeParametricRow(text);
  if (parametric) return parametric;

  const equation = splitTopLevelEquation(text);
  if (!equation) return { kind: "expression", source: text, expr: text };

  if (equation.left === "y" && equation.right === "y") return { kind: "expression", source: text, expr: text };
  if (equation.left === "y") return { kind: "graph", source: text, expr: equation.right };
  if (equation.right === "y") return { kind: "graph", source: text, expr: equation.left };

  const assignment = orientDefinition(equation);
  if (!assignment) return { kind: "expression", source: text, expr: text };

  const signature = parseCallSignature(assignment.name);
  if (signature && signature.args.every(isIdentifier)) {
    return {
      kind: "function-binding",
      source: text,
      name: signature.name,
      params: signature.args,
      expr: assignment.expr
    };
  }
  if (signature) {
    return {
      kind: "case-binding",
      source: text,
      name: signature.name,
      args: signature.args,
      expr: assignment.expr
    };
  }

  return { kind: "binding", source: text, name: assignment.name, expr: assignment.expr };
}

export function parametricPromptFor(source: string): { variable: string; template: string } | null {
  const text = source.trim();
  if (findTrailingRestrictionStart(text) !== -1 || !parseCoordinatePair(text)) return null;
  const variable = inferParametricVariable(text) ?? "t";
  return { variable, template: `${text} {0 <= ${variable} <= 2*pi}` };
}

function normalizeParametricRow(source: string): Extract<NormalizedRow, { kind: "expression" }> | null {
  const parametric = parseParametricSource(source);
  if (!parametric) return null;

  return {
    kind: "expression",
    source,
    expr: `parametric(fn(${parametric.variable})=>[${parametric.x},${parametric.y}],${parametric.lo},${parametric.hi})`
  };
}

function inferParametricVariable(source: string): string | null {
  const names = [...source.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)]
    .map((match) => match[0])
    .filter((name) => !knownNonParameterNames.has(name));
  return [...new Set(names)].sort()[0] ?? null;
}

const knownNonParameterNames = new Set([
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "sqrt",
  "abs",
  "log",
  "exp",
  "floor",
  "ceil",
  "round",
  "min",
  "max",
  "pow",
  "pi",
  "e"
]);

export function isDefinitionRow(row: Exclude<NormalizedRow, { kind: "empty" }>): row is Extract<NormalizedRow, { kind: "binding" | "function-binding" | "case-binding" }> {
  return row.kind === "binding" || row.kind === "function-binding" || row.kind === "case-binding";
}

export function coreExpressionFor(row: Exclude<NormalizedRow, { kind: "empty" }>): string {
  if (row.kind === "function-binding") return `fn(${row.params.join(", ")}) => ${row.expr}`;
  return row.expr;
}

function orientDefinition(equation: TopLevelEquation): Assignment | null {
  const leftIsTarget = isValidAssignmentTarget(equation.left);
  const rightIsTarget = isValidAssignmentTarget(equation.right);
  if (leftIsTarget && !rightIsTarget) return { name: equation.left, expr: equation.right };
  if (rightIsTarget && !leftIsTarget) return { name: equation.right, expr: equation.left };
  if (leftIsTarget && rightIsTarget) return { name: equation.left, expr: equation.right };
  return null;
}

function splitTopLevelEquation(source: string): TopLevelEquation | null {
  let depth = 0;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth--;
    if (ch === "=" && source[i + 1] !== ">" && source[i - 1] !== "=" && depth === 0) {
      const left = source.slice(0, i).trim();
      const right = source.slice(i + 1).trim();
      if (left && right) return { left, right };
    }
  }
  return null;
}

function isValidAssignmentTarget(source: string): boolean {
  return isIdentifier(source) || parseCallSignature(source) !== null;
}

function parseCallSignature(source: string): { name: string; args: string[] } | null {
  const match = source.match(/^([A-Za-z_][A-Za-z0-9_]*)(.*)$/);
  if (!match) return null;
  const rest = match[2].trim();
  if (!rest) return null;
  const args: string[] = [];
  let cursor = 0;
  while (cursor < rest.length) {
    if (rest[cursor] !== "(") return null;
    const end = findMatchingParen(rest, cursor);
    if (end === -1) return null;
    const group = rest.slice(cursor + 1, end).trim();
    args.push(...(group ? splitTopLevelComma(group) : []));
    cursor = end + 1;
  }
  return { name: match[1], args };
}
