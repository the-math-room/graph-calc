import {
  Env,
  RuntimeFunction,
  RuntimeValue,
  createBaseEnv,
  evaluate,
  freeNames,
  isRuntimeFunction,
  makeUserFunction,
  parseExpression
} from "./language.js";

export type Assignment = { name: string; expr: string };
type TopLevelEquation = { left: string; right: string };
export type NormalizedRow =
  | { kind: "empty" }
  | { kind: "binding"; source: string; name: string; expr: string }
  | { kind: "function-binding"; source: string; name: string; params: string[]; expr: string }
  | { kind: "case-binding"; source: string; name: string; args: string[]; expr: string }
  | { kind: "graph"; source: string; expr: string }
  | { kind: "expression"; source: string; expr: string };
export type RowResult = { ok: boolean; text: string };
export type GraphPoint = [number, number];
export type Plot =
  | { kind: "function" | "expression"; fn: (x: number) => RuntimeValue; label: string; color: string }
  | { kind: "points"; points: GraphPoint[]; label: string; color: string };

export type WorkspaceProgram = {
  rows: RowResult[];
  plots: Plot[];
};

type CompiledRow = {
  index: number;
  row: Exclude<NormalizedRow, { kind: "empty" }>;
  ast: ReturnType<typeof parseExpression>;
  caseArgAsts?: ReturnType<typeof parseExpression>[];
};

type DefinitionRow = CompiledRow & {
  row: Extract<NormalizedRow, { kind: "binding" | "function-binding" | "case-binding" }>;
};
type CaseDefinitionRow = DefinitionRow & {
  row: Extract<NormalizedRow, { kind: "case-binding" }>;
};

type ResolvableDefinition =
  | { kind: "single"; name: string; definition: DefinitionRow }
  | { kind: "cases"; name: string; definitions: CaseDefinitionRow[] };

export const colors = ["#d73a31", "#2374ab", "#1f8a5b", "#8f49b8", "#d18b00", "#0b8793", "#c43c78", "#4f6bed"];

export const examples = [
  "f = fn(x) => sin(x) + 0.35 * sin(4 * x)",
  "f",
  "let a = 0.18 in a * x^3 - 2 * x",
  "pts = map(fn(t) => [t, cos(t) + sin(2*t)/2], range(-8, 8, 0.35))",
  "pts",
  "fold(fn(acc, n) => acc + n^2, 0, range(1, 5, 1))"
];

export function compileWorkspace(expressions: string[]): WorkspaceProgram {
  const env = createBaseEnv();
  const rows: RowResult[] = [];
  const plots: Plot[] = [];
  let explicitGraphAxis: string | null = null;
  const compiledRows: CompiledRow[] = [];
  const definitionRows: DefinitionRow[] = [];
  const rowErrors = new Map<number, string>();

  expressions.forEach((source, index) => {
    const row = normalizeRow(source);
    if (row.kind === "empty") {
      rows[index] = { ok: true, text: "" };
      return;
    }

    try {
      const ast = parseExpression(coreExpressionFor(row));
      const caseArgAsts = row.kind === "case-binding" ? row.args.map((arg) => parseExpression(arg)) : undefined;
      const compiled = { index, row, ast, caseArgAsts };
      compiledRows.push(compiled);
      if (row.kind === "binding" || row.kind === "function-binding" || row.kind === "case-binding") definitionRows.push(compiled as DefinitionRow);
    } catch (error) {
      rowErrors.set(index, error instanceof Error ? error.message : String(error));
    }
  });

  resolveDefinitions(definitionRows, env, rowErrors);

  for (const compiled of compiledRows) {
    const { index, row, ast } = compiled;
    const existingError = rowErrors.get(index);
    if (existingError) {
      rows[index] = { ok: false, text: existingError };
      continue;
    }

    try {
      const isDefinition = row.kind === "binding" || row.kind === "function-binding" || row.kind === "case-binding";
      const label = isDefinition ? row.name : row.source;

      if (row.kind === "graph") {
        const axisResult = inferGraphAxis(ast, env, explicitGraphAxis);
        explicitGraphAxis = axisResult.explicitGraphAxis;
        plots.push({
          kind: "expression",
          label,
          color: colors[index % colors.length],
          fn: makeGraphFunction(ast, env, axisResult.axis)
        });
        rows[index] = { ok: true, text: `y = ${row.expr}` };
        continue;
      }

      if (row.kind === "expression") {
        const unbound = unboundNames(ast, env);
        if (unbound.length === 1 && unbound[0] === "x") {
          plots.push({
            kind: "expression",
            label,
            color: colors[index % colors.length],
            fn: makeUserFunction(["x"], ast, env)
          });
          rows[index] = { ok: true, text: `y = ${row.expr}` };
          continue;
        }
        if (unbound.length > 1) throw new Error(`Unknown names: ${unbound.join(", ")}`);
      }

      const value = isDefinition ? env.get(row.name) : evaluate(ast, env);
      const plot = makePlot(value, label, colors[index % colors.length], row);
      if (plot) plots.push(plot);
      rows[index] = { ok: true, text: summarizeValue(value, isDefinition ? row : null) };
    } catch (error) {
      rows[index] = { ok: false, text: error instanceof Error ? error.message : String(error) };
    }
  }

  for (const [index, text] of rowErrors) {
    if (!rows[index]) rows[index] = { ok: false, text };
  }

  return { rows, plots };
}

function resolveDefinitions(definitions: DefinitionRow[], env: Env, rowErrors: Map<number, string>): void {
  const definitionsByName = new Map<string, DefinitionRow[]>();
  for (const definition of definitions) {
    const existing = definitionsByName.get(definition.row.name) ?? [];
    existing.push(definition);
    definitionsByName.set(definition.row.name, existing);
  }

  for (const [name, candidates] of definitionsByName) {
    const caseDefinitions = candidates.filter(isCaseDefinitionRow);
    const valueDefinitions = candidates.filter((definition) => definition.row.kind !== "case-binding");
    if (caseDefinitions.length > 0 && valueDefinitions.length > 0) {
      for (const definition of candidates) rowErrors.set(definition.index, `Mixed definition forms: ${name}`);
      continue;
    }
    if (valueDefinitions.length > 1) {
      for (const definition of valueDefinitions) rowErrors.set(definition.index, `Duplicate definition: ${name}`);
    }
    reportDuplicateCases(name, caseDefinitions, rowErrors);
  }

  const validDefinitions = new Map<string, ResolvableDefinition>();
  for (const [name, candidates] of definitionsByName) {
    const validCandidates = candidates.filter((candidate) => !rowErrors.has(candidate.index));
    if (validCandidates.length === 0) continue;
    if (validCandidates.every((candidate) => candidate.row.kind === "case-binding")) {
      validDefinitions.set(name, { kind: "cases", name, definitions: validCandidates.filter(isCaseDefinitionRow) });
    } else if (validCandidates.length === 1) {
      validDefinitions.set(name, { kind: "single", name, definition: validCandidates[0] });
    }
  }

  const state = new Map<string, "visiting" | "done">();
  const stack: string[] = [];

  const visit = (name: string): void => {
    const definition = validDefinitions.get(name);
    if (!definition || definitionHasError(definition, rowErrors) || env.has(name)) return;
    const status = state.get(name);
    if (status === "done") return;
    if (status === "visiting") {
      const start = stack.indexOf(name);
      const cycle = [...stack.slice(start), name];
      for (const cycleName of new Set(cycle)) {
        const cycleDefinition = validDefinitions.get(cycleName);
        if (cycleDefinition) setDefinitionError(cycleDefinition, rowErrors, `Cyclic definition: ${cycle.join(" -> ")}`);
      }
      return;
    }

    state.set(name, "visiting");
    stack.push(name);
    for (const dependency of definitionDependencies(definition, env, validDefinitions)) visit(dependency);
    stack.pop();

    if (!definitionHasError(definition, rowErrors)) {
      try {
        env.set(name, evaluateDefinition(definition, env));
      } catch (error) {
        setDefinitionError(definition, rowErrors, error instanceof Error ? error.message : String(error));
      }
    }
    state.set(name, "done");
  };

  for (const name of validDefinitions.keys()) visit(name);
}

function isCaseDefinitionRow(definition: DefinitionRow): definition is CaseDefinitionRow {
  return definition.row.kind === "case-binding";
}

function reportDuplicateCases(name: string, definitions: CaseDefinitionRow[], rowErrors: Map<number, string>): void {
  const casesByKey = new Map<string, CaseDefinitionRow[]>();
  for (const definition of definitions) {
    const key = definition.row.args.map((arg) => arg.trim()).join("\u0000");
    const cases = casesByKey.get(key) ?? [];
    cases.push(definition);
    casesByKey.set(key, cases);
  }
  for (const duplicates of casesByKey.values()) {
    if (duplicates.length <= 1) continue;
    for (const duplicate of duplicates) rowErrors.set(duplicate.index, `Duplicate case: ${name}(${duplicate.row.args.join(", ")})`);
  }
}

function definitionDependencies(definition: ResolvableDefinition, env: Env, definitions: Map<string, ResolvableDefinition>): string[] {
  return [...definitionFreeNames(definition)]
    .filter((name) => (definition.kind === "single" || name !== definition.name) && !env.has(name) && definitions.has(name))
    .sort();
}

function definitionFreeNames(definition: ResolvableDefinition): Set<string> {
  if (definition.kind === "single") return freeNames(definition.definition.ast);
  const names = new Set<string>();
  for (const caseDefinition of definition.definitions) {
    for (const name of freeNames(caseDefinition.ast)) names.add(name);
    for (const argAst of caseDefinition.caseArgAsts ?? []) {
      for (const name of freeNames(argAst)) names.add(name);
    }
  }
  return names;
}

function evaluateDefinition(definition: ResolvableDefinition, env: Env): RuntimeValue {
  if (definition.kind === "single") return evaluate(definition.definition.ast, env);
  return makeCaseFunction(definition.name, definition.definitions, env);
}

function makeCaseFunction(name: string, definitions: CaseDefinitionRow[], env: Env, supplied: RuntimeValue[] = []): RuntimeValue {
  const fn = ((...args: RuntimeValue[]): RuntimeValue => {
    const values = [...supplied, ...args];
    for (const definition of definitions) {
      const caseArgs = (definition.caseArgAsts ?? []).map((argAst) => evaluate(argAst, env));
      if (values.length === caseArgs.length && values.every((value, index) => runtimeValuesEqual(value, caseArgs[index]))) {
        return evaluate(definition.ast, env);
      }
    }

    const hasPrefix = definitions.some((definition) => {
      const caseArgs = (definition.caseArgAsts ?? []).map((argAst) => evaluate(argAst, env));
      return values.length < caseArgs.length && values.every((value, index) => runtimeValuesEqual(value, caseArgs[index]));
    });
    if (hasPrefix) return makeCaseFunction(name, definitions, env, values);
    throw new Error(`No matching case: ${name}(${values.map(formatValue).join(", ")})`);
  }) as RuntimeFunction;
  fn.arity = 1;
  return fn;
}

function runtimeValuesEqual(left: RuntimeValue, right: RuntimeValue): boolean {
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => runtimeValuesEqual(value, right[index]));
  }
  return left === right;
}

function definitionHasError(definition: ResolvableDefinition, rowErrors: Map<number, string>): boolean {
  if (definition.kind === "single") return rowErrors.has(definition.definition.index);
  return definition.definitions.some((caseDefinition) => rowErrors.has(caseDefinition.index));
}

function setDefinitionError(definition: ResolvableDefinition, rowErrors: Map<number, string>, message: string): void {
  if (definition.kind === "single") {
    rowErrors.set(definition.definition.index, message);
    return;
  }
  for (const caseDefinition of definition.definitions) rowErrors.set(caseDefinition.index, message);
}

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (Math.abs(value) >= 10000 || (Math.abs(value) < 0.001 && value !== 0)) return value.toExponential(2);
  return Number(value.toFixed(4)).toString();
}

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

function orientDefinition(equation: TopLevelEquation): Assignment | null {
  const leftIsTarget = isValidAssignmentTarget(equation.left);
  const rightIsTarget = isValidAssignmentTarget(equation.right);
  if (leftIsTarget && !rightIsTarget) return { name: equation.left, expr: equation.right };
  if (rightIsTarget && !leftIsTarget) return { name: equation.right, expr: equation.left };
  if (leftIsTarget && rightIsTarget) return { name: equation.left, expr: equation.right };
  return null;
}

function inferGraphAxis(
  ast: ReturnType<typeof parseExpression>,
  env: Env,
  explicitGraphAxis: string | null
): { axis: string; explicitGraphAxis: string | null } {
  const unbound = unboundNames(ast, env);
  if (unbound.length === 0) return { axis: explicitGraphAxis ?? "x", explicitGraphAxis };
  if (unbound.length === 1) {
    const axis = unbound[0];
    if (explicitGraphAxis && explicitGraphAxis !== axis) {
      throw new Error(`Pick one horizontal axis: ${[explicitGraphAxis, axis].sort().join(", ")}`);
    }
    return { axis, explicitGraphAxis: axis };
  }
  throw new Error(`Pick one horizontal axis: ${unbound.join(", ")}`);
}

function unboundNames(ast: ReturnType<typeof parseExpression>, env: Env): string[] {
  return [...freeNames(ast)].filter((name) => !env.has(name)).sort();
}

function makeGraphFunction(ast: ReturnType<typeof parseExpression>, env: Env, axis: string): (x: number) => RuntimeValue {
  return unboundNames(ast, env).includes(axis) ? makeUserFunction([axis], ast, env) : () => evaluate(ast, env);
}

export function isPoint(value: RuntimeValue): value is GraphPoint {
  return Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);
}

function makePlot(value: RuntimeValue, label: string, color: string, row: Exclude<NormalizedRow, { kind: "empty" }>): Plot | null {
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

function coreExpressionFor(row: Exclude<NormalizedRow, { kind: "empty" }>): string {
  if (row.kind === "function-binding") return `fn(${row.params.join(", ")}) => ${row.expr}`;
  return row.expr;
}

function summarizeValue(value: RuntimeValue, binding: Extract<NormalizedRow, { kind: "binding" | "function-binding" | "case-binding" }> | null): string {
  const prefix = binding ? `${binding.name}: ` : "";
  if (isRuntimeFunction(value)) return `${prefix}fn/${value.arity}`;
  if (Array.isArray(value)) return `${prefix}[${value.slice(0, 4).map(formatValue).join(", ")}${value.length > 4 ? ", ..." : ""}]`;
  return `${prefix}${formatValue(value)}`;
}

function formatValue(value: RuntimeValue): string {
  if (typeof value === "number") return formatNumber(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.map(formatValue).join(", ")}]`;
  if (isRuntimeFunction(value)) return `fn/${value.arity}`;
  return String(value);
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
