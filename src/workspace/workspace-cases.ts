import { Env, RuntimeFunction, RuntimeValue, evaluate, freeNames, parseExpression } from "../core/language.js";
import { CaseDefinitionRow, DefinitionRow } from "./workspace-compiled.js";
import { formatValue } from "./workspace-values.js";

type CaseEvaluationBudget = { remaining: number; depth: number };
const maxCaseEvaluations = 20_000;

export function isCaseDefinitionRow(definition: DefinitionRow): definition is CaseDefinitionRow {
  return definition.row.kind === "case-binding";
}

export function definitionToCase(definition: DefinitionRow): CaseDefinitionRow | null {
  if (isCaseDefinitionRow(definition)) return definition;
  if (definition.row.kind === "function-binding") return functionDefinitionToCase(definition);
  return null;
}

export function isPresentCaseDefinition(definition: CaseDefinitionRow | null): definition is CaseDefinitionRow {
  return definition !== null;
}

export function functionDefinitionToCase(definition: DefinitionRow): CaseDefinitionRow {
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

export function reportDuplicateCases(name: string, definitions: CaseDefinitionRow[], rowErrors: Map<number, string>): void {
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

export function caseDefinitionFreeNames(definition: CaseDefinitionRow): Set<string> {
  const names = new Set<string>();
  const patternNames = casePatternNames(definition);
  for (const name of freeNames(definition.ast)) {
    if (!patternNames.has(name)) names.add(name);
  }
  for (const argAst of definition.caseArgAsts ?? []) {
    for (const name of freeNames(argAst)) {
      if (!patternNames.has(name)) names.add(name);
    }
  }
  return names;
}

export function makeCaseFunction(name: string, definitions: CaseDefinitionRow[], env: Env): RuntimeFunction {
  return makeCaseFunctionWithState(name, definitions, env, [], { remaining: maxCaseEvaluations, depth: 0 });
}

function makeCaseFunctionWithState(
  name: string,
  definitions: CaseDefinitionRow[],
  env: Env,
  supplied: RuntimeValue[],
  budget: CaseEvaluationBudget
): RuntimeFunction {
  const fn = ((...args: RuntimeValue[]): RuntimeValue => {
    return withCaseEvaluationBudget(budget, () => {
      const values = [...supplied, ...args];
      for (const definition of definitions) {
        const local = matchCasePrefix(definition, values, env);
        if (local && values.length === definition.row.args.length) {
          return evaluate(definition.ast, local);
        }
      }

      const hasPrefix = definitions.some((definition) => values.length < definition.row.args.length && matchCasePrefix(definition, values, env));
      if (hasPrefix) return makeCaseFunctionWithState(name, definitions, env, values, budget);
      throw new Error(`No matching case: ${name}(${values.map(formatValue).join(", ")})`);
    });
  }) as RuntimeFunction;
  fn.arity = 1;
  fn.plotHint = "never";
  return fn;
}

function withCaseEvaluationBudget<T>(budget: CaseEvaluationBudget, evaluateCase: () => T): T {
  if (budget.depth === 0) budget.remaining = maxCaseEvaluations;
  budget.depth++;
  try {
    budget.remaining--;
    if (budget.remaining < 0) throw new Error("Evaluation limit exceeded");
    return evaluateCase();
  } finally {
    budget.depth--;
  }
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
