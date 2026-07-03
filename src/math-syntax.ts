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
  source = stripLatexCommand(source, "left");
  source = stripLatexCommand(source, "right");
  source = source.replace(/\\(?:,|;|:|!| )/g, "");
  source = source.replace(/\\(?:cdot|times)\s*/g, "*");
  source = source.replace(/\\pi\b/g, "pi");
  source = replaceLatexFractions(source);
  source = replaceLatexSqrt(source);
  source = normalizeLatexFunctions(source);
  source = normalizeLatexSuperscripts(source);
  source = source.replace(/[{}]/g, "");
  source = source.replace(/\s+/g, " ").trim();
  return source;
}

function stripLatexCommand(source: string, command: string): string {
  return source.replace(new RegExp(`\\\\${command}\\s*`, "g"), "");
}

function normalizeLatexFunctions(source: string): string {
  for (const name of mathFunctionNames) {
    source = source.replace(new RegExp(`\\\\${name}\\b\\s*`, "g"), `${name}`);
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
