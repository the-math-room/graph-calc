import { createBaseEnv } from "../core/language.js";
import { compileWorkspaceRows, fillParseErrors } from "./workspace-compiler.js";
import { resolveDefinitions } from "./workspace-definitions.js";
import { normalizeRow, parametricPromptFor } from "./workspace-normalize.js";
import { renderRows } from "./workspace-render.js";
import { Plot, RowResult, WorkspaceProgram, colors, examples, formatNumber, isPoint } from "./workspace-values.js";

export type { Assignment, NormalizedRow } from "./workspace-normalize.js";
export type { GraphPoint, Plot, RowResult, WorkspaceProgram } from "./workspace-values.js";
export { colors, examples, formatNumber, isPoint, normalizeRow, parametricPromptFor };

export function compileWorkspace(expressions: string[]): WorkspaceProgram {
  const env = createBaseEnv();
  const plots: Plot[] = [];
  const compilation = compileWorkspaceRows(expressions);

  resolveDefinitions(compilation.definitionRows, env, compilation.rowErrors);
  renderRows(compilation.compiledRows, env, compilation.rows, plots, compilation.rowErrors);
  fillParseErrors(compilation.rows, compilation.rowErrors);

  return { rows: compilation.rows, plots };
}
