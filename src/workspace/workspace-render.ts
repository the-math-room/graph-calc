import { Env, RuntimeValue, evaluate, explicitInequalityBoundary, freeNames, inequalityBoundaryStyle, isInequalityExpression, isRuntimeFunction, makeUserFunction, parseExpression } from "../core/language.js";
import { CompiledRow } from "./workspace-compiled.js";
import { NormalizedRow, isDefinitionRow } from "./workspace-normalize.js";
import { Plot, RowResult, SmoothRegionBoundary, colors, formatValue, makePlot, summarizeValue } from "./workspace-values.js";

export function renderRows(
  compiledRows: CompiledRow[],
  env: Env,
  rows: RowResult[],
  plots: Plot[],
  rowErrors: Map<number, string>,
  caseDefinitionRows: Set<number> = new Set()
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
          rowIndex: index,
          label: row.source,
          color: colors[index % colors.length],
          fn: makeGraphFunction(ast, env, axisResult.axis)
        });
        rows[index] = { ok: true, text: `y = ${row.expr}` };
        continue;
      }

      if (row.kind === "expression" && maybeRenderRegion(row, ast, env, rows, plots, index)) continue;
      if (row.kind === "expression" && maybeRenderBareGraph(row, ast, env, rows, plots, index)) continue;

      renderValueRow(compiled, env, rows, plots, caseDefinitionRows);
    } catch (error) {
      rows[index] = { ok: false, text: error instanceof Error ? error.message : String(error) };
    }
  }
}

function maybeRenderRegion(
  row: Extract<NormalizedRow, { kind: "expression" }>,
  ast: ReturnType<typeof parseExpression>,
  env: Env,
  rows: RowResult[],
  plots: Plot[],
  index: number
): boolean {
  if (!isInequalityExpression(ast)) return false;

  const unbound = unboundNames(ast, env);
  if (unbound.length === 0) return false;
  const unknown = unbound.filter((name) => name !== "x" && name !== "y");
  if (unknown.length > 0) throw new Error(`Unknown names: ${unknown.join(", ")}`);

  plots.push({
    kind: "region",
    rowIndex: index,
    label: row.source,
    color: colors[index % colors.length],
    predicate: makeRegionPredicate(ast, env),
    boundaryStyle: inequalityBoundaryStyle(ast),
    smoothBoundary: makeSmoothRegionBoundary(ast, env)
  });
  rows[index] = { ok: true, text: row.expr };
  return true;
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
      rowIndex: index,
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

function makeRegionPredicate(ast: ReturnType<typeof parseExpression>, env: Env): (x: number, y: number) => boolean {
  const predicate = makeUserFunction(["x", "y"], ast, env);
  return (x, y) => predicate(x, y) === true;
}

function makeSmoothRegionBoundary(ast: ReturnType<typeof parseExpression>, env: Env): SmoothRegionBoundary | undefined {
  const boundary = explicitInequalityBoundary(ast);
  if (!boundary) return undefined;
  if (boundary.axis === "y") {
    return { axis: "y", fn: makeUserFunction(["x"], boundary.expr, env), fillSide: boundary.fillSide };
  }
  return { axis: "x", fn: makeUserFunction(["y"], boundary.expr, env), fillSide: boundary.fillSide };
}

function renderValueRow(
  compiled: CompiledRow,
  env: Env,
  rows: RowResult[],
  plots: Plot[],
  caseDefinitionRows: Set<number>
): void {
  const { index, row, ast } = compiled;
  const isDefinition = isDefinitionRow(row);
  const label = isDefinition ? row.name : row.source;
  const value = isDefinition ? env.get(row.name) : evaluate(ast, env);
  if (!caseDefinitionRows.has(index)) {
    const plot = makePlot(value, label, colors[index % colors.length], index, row);
    if (plot) plots.push(plot);
  }
  rows[index] = { ok: true, text: summarizeRowValue(compiled, value, env, isDefinition ? row : null) };
}

function summarizeRowValue(
  compiled: CompiledRow,
  value: RuntimeValue,
  env: Env,
  binding: Extract<NormalizedRow, { kind: "binding" | "function-binding" | "case-binding" }> | null
): string {
  if (binding?.kind !== "case-binding" || !isRuntimeFunction(value) || !compiled.caseArgAsts) return summarizeValue(value, binding);
  if (compiled.caseArgAsts.some((arg) => unboundNames(arg, env).length > 0)) return `${binding.name}(${binding.args.join(", ")}) = ${binding.expr}`;

  const args = compiled.caseArgAsts.map((arg) => evaluate(arg, env));
  return `${binding.name}(${args.map(formatValue).join(", ")}) = ${formatValue(value(...args))}`;
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
