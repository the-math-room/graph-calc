export const mathFunctionNames = ["sin", "cos", "tan", "asin", "acos", "atan", "sqrt", "abs", "log", "exp", "floor", "ceil", "round", "min", "max", "pow"] as const;

export function sourceToLatex(source: string): string {
  let latex = source.trim();
  latex = latex.replace(/\*/g, "\\cdot ");
  latex = latex.replace(/\bpi\b/g, "\\pi ");
  for (const name of mathFunctionNames) {
    latex = latex.replace(new RegExp(`\\b${name}\\s*\\(`, "g"), `\\${name}(`);
  }
  return latex;
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
    const firstStart = source.indexOf("{", index);
    if (firstStart === -1) return source;
    const firstEnd = findMatchingBrace(source, firstStart);
    if (firstEnd === -1) return source;
    const first = source.slice(firstStart + 1, firstEnd);

    if (groupCount === 1) {
      source = source.slice(0, index) + replacer("", first) + source.slice(firstEnd + 1);
      index = source.indexOf(`\\${command}`, index + 1);
      continue;
    }

    const secondStart = source.indexOf("{", firstEnd + 1);
    if (secondStart === -1) return source;
    const secondEnd = findMatchingBrace(source, secondStart);
    if (secondEnd === -1) return source;
    const second = source.slice(secondStart + 1, secondEnd);
    source = source.slice(0, index) + replacer(first, second) + source.slice(secondEnd + 1);
    index = source.indexOf(`\\${command}`, index + 1);
  }
  return source;
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
