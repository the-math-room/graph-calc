import { Env, RuntimeFunction, RuntimeValue, evaluate, freeNames, parseExpression } from "./language.js";
import { NormalizedRow } from "./workspace-normalize.js";
import { formatValue } from "./workspace-values.js";

export type CompiledRow = {
  index: number;
  row: Exclude<NormalizedRow, { kind: "empty" }>;
  ast: ReturnType<typeof parseExpression>;
  caseArgAsts?: ReturnType<typeof parseExpression>[];
};

export type DefinitionRow = CompiledRow & {
  row: Extract<NormalizedRow, { kind: "binding" | "function-binding" | "case-binding" }>;
};

type CaseDefinitionRow = DefinitionRow & {
  row: Extract<NormalizedRow, { kind: "case-binding" }>;
};

type ResolvableDefinition =
  | { kind: "single"; name: string; definition: DefinitionRow }
  | { kind: "cases"; name: string; definitions: CaseDefinitionRow[] };

type CaseEvaluationBudget = { remaining: number };
const maxCaseEvaluations = 20_000;

export function resolveDefinitions(definitions: DefinitionRow[], env: Env, rowErrors: Map<number, string>): void {
  const definitionsByName = groupDefinitionsByName(definitions);
  validateDefinitionGroups(definitionsByName, rowErrors);

  const validDefinitions = collectValidDefinitions(definitionsByName, rowErrors);
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

function groupDefinitionsByName(definitions: DefinitionRow[]): Map<string, DefinitionRow[]> {
  const definitionsByName = new Map<string, DefinitionRow[]>();
  for (const definition of definitions) {
    const existing = definitionsByName.get(definition.row.name) ?? [];
    existing.push(definition);
    definitionsByName.set(definition.row.name, existing);
  }
  return definitionsByName;
}

function validateDefinitionGroups(definitionsByName: Map<string, DefinitionRow[]>, rowErrors: Map<number, string>): void {
  for (const [name, candidates] of definitionsByName) {
    const caseDefinitions = candidates.filter(isCaseDefinitionRow);
    const scalarDefinitions = candidates.filter((definition) => definition.row.kind === "binding");
    const functionDefinitions = candidates.filter((definition) => definition.row.kind === "function-binding");
    if (caseDefinitions.length > 0 && scalarDefinitions.length > 0) {
      for (const definition of candidates) rowErrors.set(definition.index, `Mixed definition forms: ${name}`);
      continue;
    }
    if (caseDefinitions.length === 0 && candidates.length > 1) {
      for (const definition of candidates) rowErrors.set(definition.index, `Duplicate definition: ${name}`);
    }
    if (caseDefinitions.length > 0) reportDuplicateCases(name, [...caseDefinitions, ...functionDefinitions.map(functionDefinitionToCase)], rowErrors);
  }
}

function collectValidDefinitions(definitionsByName: Map<string, DefinitionRow[]>, rowErrors: Map<number, string>): Map<string, ResolvableDefinition> {
  const validDefinitions = new Map<string, ResolvableDefinition>();
  for (const [name, candidates] of definitionsByName) {
    const validCandidates = candidates.filter((candidate) => !rowErrors.has(candidate.index));
    if (validCandidates.length === 0) continue;
    if (validCandidates.some((candidate) => candidate.row.kind === "case-binding")) {
      validDefinitions.set(name, { kind: "cases", name, definitions: validCandidates.map(definitionToCase).filter(isPresentCaseDefinition) });
    } else if (validCandidates.length === 1) {
      validDefinitions.set(name, { kind: "single", name, definition: validCandidates[0] });
    }
  }
  return validDefinitions;
}

function isCaseDefinitionRow(definition: DefinitionRow): definition is CaseDefinitionRow {
  return definition.row.kind === "case-binding";
}

function isPresentCaseDefinition(definition: CaseDefinitionRow | null): definition is CaseDefinitionRow {
  return definition !== null;
}

function definitionToCase(definition: DefinitionRow): CaseDefinitionRow | null {
  if (isCaseDefinitionRow(definition)) return definition;
  if (definition.row.kind === "function-binding") return functionDefinitionToCase(definition);
  return null;
}

function functionDefinitionToCase(definition: DefinitionRow): CaseDefinitionRow {
  if (definition.row.kind !== "function-binding") throw new Error("Expected a function definition");
  return {
    ...definition,
    ast: parseExpression(definition.row.expr),
    caseArgAsts: definition.row.params.map((param) => parseExpression(param)),
    row: {
      kind: "case-binding",
      source: definition.row.source,
      name: definition.row.name,
      args: definition.row.params,
      expr: definition.row.expr
    }
  };
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
    const patternNames = casePatternNames(caseDefinition);
    for (const name of freeNames(caseDefinition.ast)) {
      if (!patternNames.has(name)) names.add(name);
    }
    for (const argAst of caseDefinition.caseArgAsts ?? []) {
      for (const name of freeNames(argAst)) {
        if (!patternNames.has(name)) names.add(name);
      }
    }
  }
  return names;
}

function evaluateDefinition(definition: ResolvableDefinition, env: Env): RuntimeValue {
  if (definition.kind === "single") return evaluate(definition.definition.ast, env);
  return makeCaseFunction(definition.name, definition.definitions, env, [], { remaining: maxCaseEvaluations });
}

function makeCaseFunction(
  name: string,
  definitions: CaseDefinitionRow[],
  env: Env,
  supplied: RuntimeValue[] = [],
  budget: CaseEvaluationBudget
): RuntimeValue {
  const fn = ((...args: RuntimeValue[]): RuntimeValue => {
    spendCaseEvaluation(budget);
    const values = [...supplied, ...args];
    for (const definition of definitions) {
      const local = matchCasePrefix(definition, values, env);
      if (local && values.length === definition.row.args.length) {
        return evaluate(definition.ast, local);
      }
    }

    const hasPrefix = definitions.some((definition) => values.length < definition.row.args.length && matchCasePrefix(definition, values, env));
    if (hasPrefix) return makeCaseFunction(name, definitions, env, values, budget);
    throw new Error(`No matching case: ${name}(${values.map(formatValue).join(", ")})`);
  }) as RuntimeFunction;
  fn.arity = 1;
  return fn;
}

function spendCaseEvaluation(budget: CaseEvaluationBudget): void {
  budget.remaining--;
  if (budget.remaining < 0) throw new Error("Evaluation limit exceeded");
}

function matchCasePrefix(definition: CaseDefinitionRow, values: RuntimeValue[], env: Env): Env | null {
  if (values.length > definition.row.args.length) return null;
  const local = new Env(env);
  const bindings = new Map<string, RuntimeValue>();
  for (let index = 0; index < values.length; index++) {
    const pattern = definition.row.args[index];
    const value = values[index];
    if (isPatternName(pattern)) {
      const existing = bindings.get(pattern);
      if (existing !== undefined && !runtimeValuesEqual(existing, value)) return null;
      bindings.set(pattern, value);
      local.set(pattern, value);
      continue;
    }

    const expected = evaluate((definition.caseArgAsts ?? [])[index], local);
    if (!runtimeValuesEqual(value, expected)) return null;
  }
  return local;
}

function casePatternNames(definition: CaseDefinitionRow): Set<string> {
  return new Set(definition.row.args.filter(isPatternName));
}

function isPatternName(source: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(source.trim());
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
