export function splitTopLevelComma(source: string): string[] {
  return splitTopLevel(source, ",").map((part) => part.trim());
}

export function splitTopLevel(source: string, delimiter: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < source.length; index++) {
    const ch = source[index];
    if (isOpenDelimiter(ch)) depth++;
    if (isCloseDelimiter(ch)) depth--;
    if (ch === delimiter && depth === 0) {
      parts.push(source.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(source.slice(start));
  return parts;
}

export function findMatchingParen(source: string, start: number): number {
  return findMatchingDelimiter(source, start, "(", ")");
}

export function findMatchingOpenParen(source: string, end: number): number {
  let depth = 0;
  for (let index = end; index >= 0; index--) {
    if (source[index] === ")") depth++;
    if (source[index] === "(") depth--;
    if (depth === 0) return index;
  }
  return -1;
}

export function findMatchingBrace(source: string, start: number): number {
  return findMatchingDelimiter(source, start, "{", "}");
}

export function skipWhitespace(source: string, start: number): number {
  let index = start;
  while (/\s/.test(source[index] ?? "")) index++;
  return index;
}

export function isIdentifier(source: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(source);
}

export function isIdentifierChar(char: string | undefined): boolean {
  return Boolean(char && /[A-Za-z0-9_]/.test(char));
}

function findMatchingDelimiter(source: string, start: number, open: string, close: string): number {
  let depth = 0;
  for (let index = start; index < source.length; index++) {
    if (source[index] === open) depth++;
    if (source[index] === close) depth--;
    if (depth === 0) return index;
  }
  return -1;
}

function isOpenDelimiter(char: string): boolean {
  return char === "{" || char === "(" || char === "[";
}

function isCloseDelimiter(char: string): boolean {
  return char === "}" || char === ")" || char === "]";
}
