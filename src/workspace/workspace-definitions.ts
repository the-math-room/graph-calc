import { Env, RuntimeValue, evaluate, freeNames } from "../core/language.js";
import {
  caseDefinitionFreeNames,
  definitionToCase,
  functionDefinitionToCase,
  isCaseDefinitionRow,
  isPresentCaseDefinition,
  makeCaseFunction,
  reportDuplicateCases
} from "./workspace-cases.js";
import { CaseDefinitionRow, DefinitionRow } from "./workspace-compiled.js";

type ResolvableDefinition =
  | { kind: "single"; name: string; definition: DefinitionRow }
  | { kind: "cases"; name: string; definitions: CaseDefinitionRow[] };

export function resolveDefinitions(definitions: DefinitionRow[], env: Env, rowErrors: Map<number, string>, caseDefinitionRows: Set<number> = new Set()): void {
  const definitionsByName = groupDefinitionsByName(definitions);
  validateDefinitionGroups(definitionsByName, rowErrors);

  const validDefinitions = collectValidDefinitions(definitionsByName, rowErrors, caseDefinitionRows);
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

function collectValidDefinitions(definitionsByName: Map<string, DefinitionRow[]>, rowErrors: Map<number, string>, caseDefinitionRows: Set<number>): Map<string, ResolvableDefinition> {
  const validDefinitions = new Map<string, ResolvableDefinition>();
  for (const [name, candidates] of definitionsByName) {
    const validCandidates = candidates.filter((candidate) => !rowErrors.has(candidate.index));
    if (validCandidates.length === 0) continue;
    if (validCandidates.some((candidate) => candidate.row.kind === "case-binding")) {
      const definitions = validCandidates.map(definitionToCase).filter(isPresentCaseDefinition);
      for (const definition of definitions) caseDefinitionRows.add(definition.index);
      validDefinitions.set(name, { kind: "cases", name, definitions });
    } else if (validCandidates.length === 1) {
      validDefinitions.set(name, { kind: "single", name, definition: validCandidates[0] });
    }
  }
  return validDefinitions;
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
    for (const name of caseDefinitionFreeNames(caseDefinition)) names.add(name);
  }
  return names;
}

function evaluateDefinition(definition: ResolvableDefinition, env: Env): RuntimeValue {
  if (definition.kind === "single") return evaluate(definition.definition.ast, env);
  return makeCaseFunction(definition.name, definition.definitions, env);
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
