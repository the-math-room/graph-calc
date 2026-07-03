import {
  Env,
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
};

type DefinitionRow = CompiledRow & {
  row: Extract<NormalizedRow, { kind: "binding" | "function-binding" }>;
};

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
      const compiled = { index, row, ast };
      compiledRows.push(compiled);
      if (row.kind === "binding" || row.kind === "function-binding") definitionRows.push(compiled as DefinitionRow);
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
      const label = row.kind === "binding" || row.kind === "function-binding" ? row.name : row.source;

      if (row.kind === "graph") {
        const axisResult = inferGraphAxis(ast, env, explicitGraphAxis);
        explicitGraphAxis = axisResult.explicitGraphAxis;
        plots.push({
          kind: "expression",
          label,
          color: colors[index % colors.length],
          fn: makeUserFunction([axisResult.axis], ast, env)
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

      const value = row.kind === "binding" || row.kind === "function-binding" ? env.get(row.name) : evaluate(ast, env);
      const plot = makePlot(value, label, colors[index % colors.length], row);
      if (plot) plots.push(plot);
      rows[index] = { ok: true, text: summarizeValue(value, row.kind === "binding" || row.kind === "function-binding" ? row : null) };
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

  for (const [name, duplicates] of definitionsByName) {
    if (duplicates.length <= 1) continue;
    for (const duplicate of duplicates) rowErrors.set(duplicate.index, `Duplicate definition: ${name}`);
  }

  const validDefinitions = new Map<string, DefinitionRow>();
  for (const [name, candidates] of definitionsByName) {
    if (candidates.length === 1 && !rowErrors.has(candidates[0].index)) validDefinitions.set(name, candidates[0]);
  }

  const state = new Map<string, "visiting" | "done">();
  const stack: string[] = [];

  const visit = (name: string): void => {
    const definition = validDefinitions.get(name);
    if (!definition || rowErrors.has(definition.index) || env.has(name)) return;
    const status = state.get(name);
    if (status === "done") return;
    if (status === "visiting") {
      const start = stack.indexOf(name);
      const cycle = [...stack.slice(start), name];
      for (const cycleName of new Set(cycle)) {
        const cycleDefinition = validDefinitions.get(cycleName);
        if (cycleDefinition) rowErrors.set(cycleDefinition.index, `Cyclic definition: ${cycle.join(" -> ")}`);
      }
      return;
    }

    state.set(name, "visiting");
    stack.push(name);
    for (const dependency of definitionDependencies(definition, env, validDefinitions)) visit(dependency);
    stack.pop();

    if (!rowErrors.has(definition.index)) {
      try {
        env.set(name, evaluate(definition.ast, env));
      } catch (error) {
        rowErrors.set(definition.index, error instanceof Error ? error.message : String(error));
      }
    }
    state.set(name, "done");
  };

  for (const name of validDefinitions.keys()) visit(name);
}

function definitionDependencies(definition: DefinitionRow, env: Env, definitions: Map<string, DefinitionRow>): string[] {
  return [...freeNames(definition.ast)]
    .filter((name) => !env.has(name) && definitions.has(name))
    .sort();
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

  const signature = parseFunctionSignature(assignment.name);
  if (signature) {
    return {
      kind: "function-binding",
      source: text,
      name: signature.name,
      params: signature.params,
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
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(source) || parseFunctionSignature(source) !== null;
}

function parseFunctionSignature(source: string): { name: string; params: string[] } | null {
  const match = source.match(/^([A-Za-z_][A-Za-z0-9_]*)\((.*)\)$/);
  if (!match) return null;
  const params = match[2].trim() ? match[2].split(",").map((param) => param.trim()) : [];
  if (!params.every((param) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(param))) return null;
  return { name: match[1], params };
}

function coreExpressionFor(row: Exclude<NormalizedRow, { kind: "empty" }>): string {
  if (row.kind === "function-binding") return `fn(${row.params.join(", ")}) => ${row.expr}`;
  return row.expr;
}

function summarizeValue(value: RuntimeValue, binding: Extract<NormalizedRow, { kind: "binding" | "function-binding" }> | null): string {
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
