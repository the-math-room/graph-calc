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
  const restrictionStart = findTrailingRestrictionStart(source);
  if (restrictionStart === -1) return null;

  const point = parseCoordinatePair(source.slice(0, restrictionStart).trim());
  const range = parseParametricRestriction(source.slice(restrictionStart).trim());
  if (!point || !range) return null;

  return {
    kind: "expression",
    source,
    expr: `parametric(fn(${range.variable})=>[${point.x},${point.y}],${range.lo},${range.hi})`
  };
}

function findTrailingRestrictionStart(source: string): number {
  let depth = 0;
  for (let index = source.length - 1; index >= 0; index--) {
    const ch = source[index];
    if (ch === "}" || ch === ")" || ch === "]") depth++;
    if (ch === "{" || ch === "(" || ch === "[") depth--;
    if (ch === "{" && depth === 0) return index;
  }
  return -1;
}

function parseCoordinatePair(source: string): { x: string; y: string } | null {
  if (!source.startsWith("(") || !source.endsWith(")")) return null;
  const inner = source.slice(1, -1).trim();
  const parts = splitTopLevelComma(inner);
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { x: parts[0], y: parts[1] };
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

function parseParametricRestriction(source: string): { variable: string; lo: string; hi: string } | null {
  if (!source.startsWith("{") || !source.endsWith("}")) return null;
  const inner = source.slice(1, -1).trim();
  const match = splitChainedInequality(inner);
  if (!match) return null;

  if (isLessThanComparison(match.leftOp) && isLessThanComparison(match.rightOp)) {
    return { variable: match.variable, lo: match.leftExpr, hi: match.rightExpr };
  }
  if (isGreaterThanComparison(match.leftOp) && isGreaterThanComparison(match.rightOp)) {
    return { variable: match.variable, lo: match.rightExpr, hi: match.leftExpr };
  }
  return null;
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

function splitTopLevelComma(source: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < source.length; index++) {
    const ch = source[index];
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) {
      parts.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(source.slice(start).trim());
  return parts;
}

function findMatchingParen(source: string, start: number): number {
  let depth = 0;
  for (let index = start; index < source.length; index++) {
    if (source[index] === "(") depth++;
    if (source[index] === ")") depth--;
    if (depth === 0) return index;
  }
  return -1;
}

function isIdentifier(source: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(source);
}
