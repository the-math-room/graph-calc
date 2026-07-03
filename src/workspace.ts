import { Env, RuntimeValue, createBaseEnv, evaluate, freeNames, makeUserFunction, parseExpression } from "./language.js";
import { CompiledRow, DefinitionRow, resolveDefinitions } from "./workspace-definitions.js";
import { NormalizedRow, coreExpressionFor, isDefinitionRow, normalizeRow } from "./workspace-normalize.js";
import { Plot, RowResult, WorkspaceProgram, colors, examples, formatNumber, isPoint, makePlot, summarizeValue } from "./workspace-values.js";

export type { Assignment, NormalizedRow } from "./workspace-normalize.js";
export type { GraphPoint, Plot, RowResult, WorkspaceProgram } from "./workspace-values.js";
export { colors, examples, formatNumber, isPoint, normalizeRow };

export function compileWorkspace(expressions: string[]): WorkspaceProgram {
  const env = createBaseEnv();
  const rows: RowResult[] = [];
  const plots: Plot[] = [];
  const compiledRows: CompiledRow[] = [];
  const definitionRows: DefinitionRow[] = [];
  const rowErrors = new Map<number, string>();

  compileRows(expressions, rows, compiledRows, definitionRows, rowErrors);
  resolveDefinitions(definitionRows, env, rowErrors);
  renderRows(compiledRows, env, rows, plots, rowErrors);
  fillParseErrors(rows, rowErrors);

  return { rows, plots };
}

function compileRows(
  expressions: string[],
  rows: RowResult[],
  compiledRows: CompiledRow[],
  definitionRows: DefinitionRow[],
  rowErrors: Map<number, string>
): void {
  expressions.forEach((source, index) => {
    const row = normalizeRow(source);
    if (row.kind === "empty") {
      rows[index] = { ok: true, text: "" };
      return;
    }

    try {
      const ast = parseExpression(coreExpressionFor(row));
      const caseArgAsts = row.kind === "case-binding" ? row.args.map((arg) => parseExpression(arg)) : undefined;
      const compiled: CompiledRow = { index, row, ast, caseArgAsts };
      compiledRows.push(compiled);
      if (isDefinitionRow(row)) definitionRows.push({ ...compiled, row });
    } catch (error) {
      rowErrors.set(index, error instanceof Error ? error.message : String(error));
    }
  });
}

function renderRows(
  compiledRows: CompiledRow[],
  env: Env,
  rows: RowResult[],
  plots: Plot[],
  rowErrors: Map<number, string>
): void {
  let explicitGraphAxis: string | null = null;

  for (const compiled of compiledRows) {
    const { index, row, ast } = compiled;
    const existingError = rowErrors.get(index);
    if (existingError) {
      rows[index] = { ok: false, text: existingError };
      continue;
    }

    try {
      if (row.kind === "graph") {
        const axisResult = inferGraphAxis(ast, env, explicitGraphAxis);
        explicitGraphAxis = axisResult.explicitGraphAxis;
        plots.push({
          kind: "expression",
          label: row.source,
          color: colors[index % colors.length],
          fn: makeGraphFunction(ast, env, axisResult.axis)
        });
        rows[index] = { ok: true, text: `y = ${row.expr}` };
        continue;
      }

      if (row.kind === "expression" && maybeRenderBareGraph(row, ast, env, rows, plots, index)) continue;

      renderValueRow(row, ast, env, rows, plots, index);
    } catch (error) {
      rows[index] = { ok: false, text: error instanceof Error ? error.message : String(error) };
    }
  }
}

function maybeRenderBareGraph(
  row: Extract<NormalizedRow, { kind: "expression" }>,
  ast: ReturnType<typeof parseExpression>,
  env: Env,
  rows: RowResult[],
  plots: Plot[],
  index: number
): boolean {
  const unbound = unboundNames(ast, env);
  if (unbound.length === 1 && unbound[0] === "x") {
    plots.push({
      kind: "expression",
      label: row.source,
      color: colors[index % colors.length],
      fn: makeUserFunction(["x"], ast, env)
    });
    rows[index] = { ok: true, text: `y = ${row.expr}` };
    return true;
  }
  if (unbound.length > 1) throw new Error(`Unknown names: ${unbound.join(", ")}`);
  return false;
}

function renderValueRow(
  row: Exclude<NormalizedRow, { kind: "empty" }>,
  ast: ReturnType<typeof parseExpression>,
  env: Env,
  rows: RowResult[],
  plots: Plot[],
  index: number
): void {
  const isDefinition = isDefinitionRow(row);
  const label = isDefinition ? row.name : row.source;
  const value = isDefinition ? env.get(row.name) : evaluate(ast, env);
  const plot = makePlot(value, label, colors[index % colors.length], row);
  if (plot) plots.push(plot);
  rows[index] = { ok: true, text: summarizeValue(value, isDefinition ? row : null) };
}

function fillParseErrors(rows: RowResult[], rowErrors: Map<number, string>): void {
  for (const [index, text] of rowErrors) {
    if (!rows[index]) rows[index] = { ok: false, text };
  }
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
