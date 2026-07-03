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
