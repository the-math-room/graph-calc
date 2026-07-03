export const mathFunctionNames = ["sin", "cos", "tan", "asin", "acos", "atan", "sqrt", "abs", "log", "exp", "floor", "ceil", "round", "min", "max", "pow"] as const;

export function sourceToLatex(source: string): string {
  let latex = source.trim();
  latex = restoreLatexFractions(latex);
  latex = latex.replace(/\*/g, "\\cdot ");
  latex = latex.replace(/\bpi\b/g, "\\pi ");
  for (const name of mathFunctionNames) {
    latex = latex.replace(new RegExp(`\\b${name}\\s*\\(`, "g"), `\\${name}(`);
  }
  return latex;
}

function restoreLatexFractions(source: string): string {
  let previous: string;
  do {
    previous = source;
    source = source.replace(/\(\(([^()]+)\)\/\(([^()]+)\)\)/g, "\\frac{$1}{$2}");
  } while (source !== previous);
  return source;
}

export function latexToSource(latex: string): string {
  let source = latex.trim();
  source = stripDisplayMathDelimiters(source);
  source = stripLatexCommand(source, "left");
  source = stripLatexCommand(source, "right");
  source = normalizeLatexTextIdentifiers(source);
  source = stripEmptyScripts(source);
  source = source.replace(/\\(?:,|;|:|!| )/g, "");
  source = source.replace(/\\(?:cdot|times)\s*/g, "*");
  source = source.replace(/\\pi\b/g, "pi");
  source = replaceLatexDerivatives(source);
  source = replaceLatexIntegrals(source);
  source = replaceLatexAggregates(source);
  source = replaceLatexFractions(source);
  source = replaceLatexSqrt(source);
  source = normalizeLatexFunctions(source);
  source = normalizeLatexSuperscripts(source);
  source = lowerLatexSubscripts(source);
  source = source.replace(/[{}]/g, "");
  source = source.replace(/\s+/g, " ").trim();
  return source;
}

export function escapeLatexCommandToText(latex: string, cursor: number): { latex: string; cursor: number } | null {
  const commands = [...latex.matchAll(/\\[A-Za-z]+/g)];
  const candidates = commands.filter((command) => {
    const start = command.index ?? 0;
    const end = start + command[0].length;
    return cursor >= start && cursor <= end;
  });
  const command = candidates.at(-1);
  if (!command) return null;

  const start = command.index ?? 0;
  const end = start + command[0].length;
  if (latex[end] === "_" || latex[end] === "^") return null;

  const text = command[0].slice(1);
  return {
    latex: latex.slice(0, start) + text + latex.slice(end),
    cursor: Math.min(start + text.length, cursor - 1)
  };
}

function stripDisplayMathDelimiters(source: string): string {
  if (source.startsWith("$$") && source.endsWith("$$")) return source.slice(2, -2).trim();
  if (source.startsWith("\\[") && source.endsWith("\\]")) return source.slice(2, -2).trim();
  if (source.startsWith("\\(") && source.endsWith("\\)")) return source.slice(2, -2).trim();
  return source;
}

function stripEmptyScripts(source: string): string {
  return source.replace(/[_^]\{\s*\}/g, "");
}

function stripLatexCommand(source: string, command: string): string {
  return source.replace(new RegExp(`\\\\${command}\\s*`, "g"), "");
}

function normalizeLatexTextIdentifiers(source: string): string {
  return source.replace(/\\(?:mathrm|operatorname|text)\{([A-Za-z_][A-Za-z0-9_]*)\}/g, "$1");
}

function normalizeLatexFunctions(source: string): string {
  for (const name of mathFunctionNames) {
    source = normalizeLatexFunction(source, name);
  }
  return source;
}

function normalizeLatexFunction(source: string, name: string): string {
  let index = source.indexOf(`\\${name}`);
  while (index !== -1) {
    const commandEnd = index + name.length + 1;
    if (/[A-Za-z]/.test(source[commandEnd] ?? "")) {
      index = source.indexOf(`\\${name}`, commandEnd);
      continue;
    }

    const argStart = skipWhitespace(source, commandEnd);
    if (source[argStart] === "(") {
      source = source.slice(0, index) + name + source.slice(commandEnd);
      index = source.indexOf(`\\${name}`, index + name.length);
      continue;
    }

    const arg = readLatexArgument(source, commandEnd);
    if (!arg) {
      source = source.slice(0, index) + name + source.slice(commandEnd);
      index = source.indexOf(`\\${name}`, index + name.length);
      continue;
    }

    source = source.slice(0, index) + `${name}(${arg.value})` + source.slice(arg.end);
    index = source.indexOf(`\\${name}`, index + name.length + arg.value.length + 2);
  }
  return source;
}

function normalizeLatexSuperscripts(source: string): string {
  let previous: string;
  do {
    previous = source;
    source = source.replace(/\^\{([^{}]+)\}/g, "^$1");
  } while (source !== previous);
  return source;
}

function replaceLatexIntegrals(source: string): string {
  let index = source.indexOf("\\int");
  while (index !== -1) {
    const integral = readLatexIntegral(source, index);
    if (!integral) {
      index = source.indexOf("\\int", index + 1);
      continue;
    }

    source =
      source.slice(0, index) +
      `integral(fn(${integral.variable})=>${integral.integrand},${integral.lower},${integral.upper})` +
      source.slice(integral.end);
    index = source.indexOf("\\int", index + 1);
  }
  return source;
}

function replaceLatexDerivatives(source: string): string {
  let index = source.indexOf("\\frac");
  while (index !== -1) {
    const derivative = readLatexDerivative(source, index);
    if (!derivative) {
      index = source.indexOf("\\frac", index + 1);
      continue;
    }

    source =
      source.slice(0, index) +
      `derivative(${derivative.dependent}${derivative.point ? `,${derivative.point}` : ""})` +
      source.slice(derivative.end);
    index = source.indexOf("\\frac", index + 1);
  }
  return source;
}

function readLatexDerivative(source: string, start: number): { dependent: string; variable: string; point: string | null; end: number } | null {
  const commandEnd = start + "\\frac".length;
  const numerator = readLatexArgument(source, commandEnd);
  if (!numerator) return null;
  const denominator = readLatexArgument(source, numerator.end);
  if (!denominator) return null;

  const dependent = readDifferentialOperand(numerator.value);
  const variable = readDifferentialOperand(denominator.value);
  if (!dependent || !variable || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(variable)) return null;

  const point = readDerivativePoint(source, denominator.end);
  return { dependent, variable, point: point?.value ?? null, end: point?.end ?? denominator.end };
}

function readDifferentialOperand(source: string): string | null {
  const trimmed = source.trim();
  const command = readDifferentialCommand(trimmed, 0);
  const operand = command ? trimmed.slice(command.end).trim() : trimmed.startsWith("d") ? trimmed.slice(1).trim() : "";
  return operand || null;
}

function readDerivativePoint(source: string, start: number): { value: string; end: number } | null {
  const pointStart = skipWhitespace(source, start);
  if (source[pointStart] !== "(") return null;
  const pointEnd = findMatchingParen(source, pointStart);
  if (pointEnd === -1) return null;
  return { value: source.slice(pointStart + 1, pointEnd), end: pointEnd + 1 };
}

function readLatexIntegral(
  source: string,
  start: number
): { lower: string; upper: string; integrand: string; variable: string; end: number } | null {
  let cursor = start + "\\int".length;
  let lower: string | null = null;
  let upper: string | null = null;

  for (let count = 0; count < 2; count++) {
    cursor = skipWhitespace(source, cursor);
    const script = source[cursor];
    if (script !== "_" && script !== "^") break;
    const arg = readLatexArgument(source, cursor + 1);
    if (!arg) return null;
    if (script === "_") lower = arg.value;
    if (script === "^") upper = arg.value;
    cursor = arg.end;
  }
  if (lower === null || upper === null) return null;

  const differential = findIntegralDifferential(source, cursor);
  if (!differential) return null;

  const integrand = trimIntegralMultiplication(source.slice(cursor, differential.start).trim());
  if (!integrand) return null;
  return { lower, upper, integrand, variable: differential.variable, end: differential.end };
}

function findIntegralDifferential(source: string, start: number): { start: number; end: number; variable: string } | null {
  let depth = 0;
  for (let index = start; index < source.length - 1; index++) {
    const ch = source[index];
    if (ch === "{" || ch === "(" || ch === "[") depth++;
    if (ch === "}" || ch === ")" || ch === "]") depth--;
    if (depth !== 0) continue;

    const differential = readDifferential(source, index);
    if (differential) return differential;
  }
  return null;
}

function readDifferential(source: string, start: number): { start: number; end: number; variable: string } | null {
  const command = readDifferentialCommand(source, start);
  const variableStart = skipWhitespace(source, command?.end ?? start + 1);
  const variable = source.slice(variableStart).match(/^[A-Za-z_][A-Za-z0-9_]*/);
  if (!variable) return null;

  if (command) return { start, end: variableStart + variable[0].length, variable: variable[0] };
  if (source[start] === "d") return { start, end: variableStart + variable[0].length, variable: variable[0] };
  return null;
}

function readDifferentialCommand(source: string, start: number): { end: number } | null {
  for (const command of ["\\differentialD", "\\mathrm{d}", "\\operatorname{d}", "\\text{d}"]) {
    if (source.startsWith(command, start)) return { end: start + command.length };
  }
  return null;
}

function trimIntegralMultiplication(source: string): string {
  return source.replace(/\*$/, "").trim();
}

function replaceLatexAggregates(source: string): string {
  source = replaceLatexAggregate(source, "sum", "sum");
  source = replaceLatexAggregate(source, "prod", "product");
  return source;
}

function replaceLatexAggregate(source: string, latexCommand: string, sourceName: string): string {
  let index = source.indexOf(`\\${latexCommand}`);
  while (index !== -1) {
    const aggregate = readLatexAggregate(source, index, latexCommand);
    if (!aggregate) {
      const commandEnd = readMalformedAggregateEnd(source, index, latexCommand);
      source =
        source.slice(0, index) +
        `error("${sourceName} notation needs an index binding")` +
        source.slice(commandEnd);
      index = source.indexOf(`\\${latexCommand}`, index + 1);
      continue;
    }

    source =
      source.slice(0, index) +
      `${sourceName}(fn(${aggregate.variable})=>${aggregate.body},${aggregate.lower},${aggregate.upper})` +
      source.slice(aggregate.end);
    index = source.indexOf(`\\${latexCommand}`, index + 1);
  }
  return source;
}

function readMalformedAggregateEnd(source: string, start: number, command: string): number {
  let cursor = start + command.length + 1;
  for (let count = 0; count < 2; count++) {
    cursor = skipWhitespace(source, cursor);
    const script = source[cursor];
    if (script !== "_" && script !== "^") break;
    const arg = readLatexArgument(source, cursor + 1);
    if (!arg) return cursor;
    cursor = arg.end;
  }
  return findAggregateBodyEnd(source, cursor);
}

function readLatexAggregate(
  source: string,
  start: number,
  command: string
): { variable: string; lower: string; upper: string; body: string; end: number } | null {
  let cursor = start + command.length + 1;
  let lowerClause: string | null = null;
  let upper: string | null = null;

  for (let count = 0; count < 2; count++) {
    cursor = skipWhitespace(source, cursor);
    const script = source[cursor];
    if (script !== "_" && script !== "^") break;
    const arg = readLatexArgument(source, cursor + 1);
    if (!arg) return null;
    if (script === "_") lowerClause = arg.value;
    if (script === "^") upper = arg.value;
    cursor = arg.end;
  }
  if (lowerClause === null || upper === null) return null;

  const bodyEnd = findAggregateBodyEnd(source, cursor);
  const body = source.slice(cursor, bodyEnd).trim();
  if (!body) return null;
  const lower = parseAggregateLowerClause(lowerClause);
  if (!lower) return null;
  return { variable: lower.variable, lower: lower.value, upper, body, end: bodyEnd };
}

function parseAggregateLowerClause(source: string): { variable: string; value: string } | null {
  const equals = source.indexOf("=");
  if (equals === -1) return null;
  const variable = source.slice(0, equals).trim();
  const value = source.slice(equals + 1).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(variable) || !value) return null;
  return { variable, value };
}

function findAggregateBodyEnd(source: string, start: number): number {
  let depth = 0;
  for (let index = start; index < source.length; index++) {
    const ch = source[index];
    if (ch === "{" || ch === "(" || ch === "[") depth++;
    if (ch === "}" || ch === ")" || ch === "]") depth--;
    if (depth === 0 && (ch === "+" || ch === "=")) return index;
  }
  return source.length;
}

function lowerLatexSubscripts(source: string): string {
  let index = source.indexOf("_");
  while (index !== -1) {
    const baseStart = findSubscriptBaseStart(source, index);
    const arg = readLatexArgument(source, index + 1);
    if (baseStart === -1 || !arg) {
      index = source.indexOf("_", index + 1);
      continue;
    }

    const base = source.slice(baseStart, index);
    source = `${source.slice(0, baseStart)}${base}(${arg.value})${source.slice(arg.end)}`;
    index = source.indexOf("_", baseStart + base.length + arg.value.length + 2);
  }
  return source;
}

function findSubscriptBaseStart(source: string, underscoreIndex: number): number {
  const end = underscoreIndex - 1;
  if (end < 0) return -1;
  if (source[end] === ")") return findCallExpressionStart(source, end);
  if (isIdentifierChar(source[end])) {
    let start = end;
    while (start > 0 && isIdentifierChar(source[start - 1])) start--;
    return start;
  }
  return -1;
}

function findCallExpressionStart(source: string, closeParen: number): number {
  const openParen = findMatchingOpenParen(source, closeParen);
  if (openParen === -1) return -1;
  let start = openParen - 1;
  if (start < 0) return -1;
  if (source[start] === ")") return findCallExpressionStart(source, start);
  if (!isIdentifierChar(source[start])) return openParen;
  while (start > 0 && isIdentifierChar(source[start - 1])) start--;
  return start;
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

function findMatchingOpenParen(source: string, end: number): number {
  let depth = 0;
  for (let index = end; index >= 0; index--) {
    if (source[index] === ")") depth++;
    if (source[index] === "(") depth--;
    if (depth === 0) return index;
  }
  return -1;
}

function isIdentifierChar(char: string | undefined): boolean {
  return Boolean(char && /[A-Za-z0-9_]/.test(char));
}

function replaceLatexSqrt(source: string): string {
  return replaceCommandWithTwoGroups(source, "sqrt", (_first, second) => `sqrt(${second})`, 1);
}

function replaceLatexFractions(source: string): string {
  return replaceCommandWithTwoGroups(source, "frac", (numerator, denominator) => `((${numerator})/(${denominator}))`, 2);
}

function replaceCommandWithTwoGroups(
  source: string,
  command: string,
  replacer: (first: string, second: string) => string,
  groupCount: 1 | 2
): string {
  let index = source.indexOf(`\\${command}`);
  while (index !== -1) {
    const commandEnd = index + command.length + 1;
    const firstArg = readLatexArgument(source, commandEnd);
    if (!firstArg) return source;

    if (groupCount === 1) {
      source = source.slice(0, index) + replacer("", firstArg.value) + source.slice(firstArg.end);
      index = source.indexOf(`\\${command}`, index + 1);
      continue;
    }

    const secondArg = readLatexArgument(source, firstArg.end);
    if (!secondArg) return source;
    source = source.slice(0, index) + replacer(firstArg.value, secondArg.value) + source.slice(secondArg.end);
    index = source.indexOf(`\\${command}`, index + 1);
  }
  return source;
}

function readLatexArgument(source: string, start: number): { value: string; end: number } | null {
  const argStart = skipWhitespace(source, start);
  if (argStart >= source.length) return null;
  if (source[argStart] === "{") {
    const argEnd = findMatchingBrace(source, argStart);
    if (argEnd === -1) return null;
    return { value: source.slice(argStart + 1, argEnd), end: argEnd + 1 };
  }
  if (source[argStart] === "\\") {
    const command = source.slice(argStart).match(/^\\[A-Za-z]+/);
    if (command) return { value: command[0], end: argStart + command[0].length };
  }
  return { value: source[argStart], end: argStart + 1 };
}

function skipWhitespace(source: string, start: number): number {
  let index = start;
  while (/\s/.test(source[index] ?? "")) index++;
  return index;
}

function findMatchingBrace(source: string, start: number): number {
  let depth = 0;
  for (let index = start; index < source.length; index++) {
    if (source[index] === "{") depth++;
    if (source[index] === "}") depth--;
    if (depth === 0) return index;
  }
  return -1;
}
