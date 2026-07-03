import { parseExpression } from "./language.js";
import { NormalizedRow } from "./workspace-normalize.js";

export type CompiledRow = {
  index: number;
  row: Exclude<NormalizedRow, { kind: "empty" }>;
  ast: ReturnType<typeof parseExpression>;
  caseArgAsts?: ReturnType<typeof parseExpression>[];
};

export type DefinitionRow = CompiledRow & {
  row: Extract<NormalizedRow, { kind: "binding" | "function-binding" | "case-binding" }>;
};

export type CaseDefinitionRow = DefinitionRow & {
  row: Extract<NormalizedRow, { kind: "case-binding" }>;
};
