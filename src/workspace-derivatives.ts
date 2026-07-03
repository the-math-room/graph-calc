import { freeNames, parseExpression } from "./language.js";

export function desugarDerivativeExpressions(source: string, params: string[]): string {
  let cursor = 0;
  let output = "";
  while (cursor < source.length) {
    const index = findDerivativeCall(source, cursor);
    if (index === -1) return output + source.slice(cursor);

    const openParen = skipWhitespace(source, index + "derivative".length);
    const closeParen = findMatchingParen(source, openParen);
    if (closeParen === -1) return output + source.slice(cursor);

    const args = splitTopLevelComma(source.slice(openParen + 1, closeParen));
    output += source.slice(cursor, index) + desugarDerivativeCall(args, params);
    cursor = closeParen + 1;
  }
  return output;
}

function desugarDerivativeCall(args: string[], params: string[]): string {
  if (args.length !== 1) return `derivative(${args.join(",")})`;

  const expr = desugarDerivativeExpressions(args[0], params);
  const variable = inferDerivativeVariable(expr, params);
  if (!variable) return `derivative(${expr})`;
  return `derivative(fn(${variable})=>${expr},${variable})`;
}

function inferDerivativeVariable(source: string, params: string[]): string | null {
  const names = freeNames(parseExpression(source));
  const candidates = params.filter((param) => names.has(param));
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  throw new Error(`derivative(expression) needs one variable, found ${candidates.join(", ")}`);
}

function findDerivativeCall(source: string, start: number): number {
  let index = source.indexOf("derivative", start);
  while (index !== -1) {
    const before = source[index - 1];
    const after = source[index + "derivative".length];
    const openParen = skipWhitespace(source, index + "derivative".length);
    if (!isIdentifierChar(before) && !isIdentifierChar(after) && source[openParen] === "(") return index;
    index = source.indexOf("derivative", index + 1);
  }
  return -1;
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

function skipWhitespace(source: string, start: number): number {
  let index = start;
  while (/\s/.test(source[index] ?? "")) index++;
  return index;
}

function isIdentifierChar(char: string | undefined): boolean {
  return Boolean(char && /[A-Za-z0-9_]/.test(char));
}
