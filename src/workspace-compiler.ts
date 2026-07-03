import { parseExpression } from "./language.js";
import { CompiledRow, DefinitionRow } from "./workspace-compiled.js";
import { RowResult } from "./workspace-values.js";
import { coreExpressionFor, isDefinitionRow, normalizeRow } from "./workspace-normalize.js";

export type WorkspaceCompilation = {
  rows: RowResult[];
  compiledRows: CompiledRow[];
  definitionRows: DefinitionRow[];
  rowErrors: Map<number, string>;
};

export function compileWorkspaceRows(expressions: string[]): WorkspaceCompilation {
  const rows: RowResult[] = [];
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
      const compiled: CompiledRow = { index, row, ast, caseArgAsts };
      compiledRows.push(compiled);
      if (isDefinitionRow(row)) definitionRows.push({ ...compiled, row });
    } catch (error) {
      rowErrors.set(index, error instanceof Error ? error.message : String(error));
    }
  });

  return { rows, compiledRows, definitionRows, rowErrors };
}

export function fillParseErrors(rows: RowResult[], rowErrors: Map<number, string>): void {
  for (const [index, text] of rowErrors) {
    if (!rows[index]) rows[index] = { ok: false, text };
  }
}
