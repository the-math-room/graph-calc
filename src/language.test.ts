import * as assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateExpression, isRuntimeFunction } from "./language.js";
import { latexToSource, sourceToLatex } from "./math-syntax.js";
import { compileWorkspace, normalizeRow } from "./workspace.js";

test("evaluates arithmetic with precedence", () => {
  assert.equal(evaluateExpression("1 + 2 * 3^2"), 19);
});

test("supports lexical let bindings", () => {
  assert.equal(evaluateExpression("let x = 4 in let y = x + 1 in y * 2"), 10);
});

test("supports implicit multiplication in expression positions", () => {
  assert.equal(evaluateExpression("2pi"), 2 * Math.PI);
  assert.equal(evaluateExpression("2(3 + 4)"), 14);
  assert.equal(evaluateExpression("(2 + 3)(4 + 1)"), 25);
});

test("converts common math editor latex into source syntax", () => {
  assert.equal(latexToSource("x^{2}"), "x^2");
  assert.equal(latexToSource("y=2x"), "y=2x");
  assert.equal(latexToSource("\\sin(x)+\\pi"), "sin(x)+pi");
  assert.equal(latexToSource("\\frac{x^{2}}{2}"), "((x^2)/(2))");
  assert.equal(latexToSource("\\sqrt{x+1}"), "sqrt(x+1)");
});

test("converts source syntax into latex for math editing", () => {
  assert.equal(sourceToLatex("x^2"), "x^2");
  assert.equal(sourceToLatex("sin(x) + pi"), "\\sin(x) + \\pi ");
  assert.equal(sourceToLatex("2*x"), "2\\cdot x");
});

test("normalizes workspace row sugar before compilation", () => {
  assert.deepEqual(normalizeRow(""), { kind: "empty" });
  assert.deepEqual(normalizeRow("f = fn(x) => x^2"), { kind: "binding", source: "f = fn(x) => x^2", name: "f", expr: "fn(x) => x^2" });
  assert.deepEqual(normalizeRow("y = 2x"), { kind: "graph", source: "y = 2x", expr: "2x" });
  assert.deepEqual(normalizeRow("2x"), { kind: "expression", source: "2x", expr: "2x" });
});

test("supports first-class functions and higher-order list operations", () => {
  assert.deepEqual(evaluateExpression("map(fn(x) => x^2, range(1, 4, 1))"), [1, 4, 9, 16]);
  assert.equal(evaluateExpression("fold(fn(acc, n) => acc + n, 0, range(1, 4, 1))"), 10);
});

test("returns callable runtime functions", () => {
  const value = evaluateExpression("fn(x) => x * x");
  assert.equal(isRuntimeFunction(value), true);
  if (isRuntimeFunction(value)) assert.equal(value(5), 25);
});

test("compiles assignments and plots in order", () => {
  const program = compileWorkspace(["f = fn(x) => x^2", "f", "pts = map(fn(t) => [t, t + 1], range(0, 2, 1))", "pts"]);
  assert.deepEqual(program.rows.map((row) => row.ok), [true, true, true, true]);
  assert.equal(program.plots.length, 4);
  assert.equal(program.plots[0].kind, "function");
  assert.equal(program.plots[1].kind, "function");
  assert.equal(program.plots[2].kind, "points");
  assert.equal(program.plots[3].kind, "points");
});

test("graphs bare x expressions as y expressions", () => {
  const program = compileWorkspace(["x", "x^2 + 1", "sin(x)", "2x", "y = 2x"]);
  assert.deepEqual(program.rows.map((row) => row.ok), [true, true, true, true, true]);
  assert.deepEqual(program.rows.map((row) => row.text), ["y = x", "y = x^2 + 1", "y = sin(x)", "y = 2x", "y = 2x"]);
  assert.equal(program.plots.length, 5);
  assert.equal(program.plots[0].kind, "expression");
  assert.equal(program.plots[0].fn(4), 4);
  assert.equal(program.plots[1].kind, "expression");
  assert.equal(program.plots[1].fn(3), 10);
  assert.equal(program.plots[3].kind, "expression");
  assert.equal(program.plots[3].fn(6), 12);
  assert.equal(program.plots[4].kind, "expression");
  assert.equal(program.plots[4].fn(7), 14);
});

test("reports parse errors without throwing out of workspace compilation", () => {
  const program = compileWorkspace(["1 +", "2 + 2"]);
  assert.equal(program.rows[0].ok, false);
  assert.equal(program.rows[1].text, "4");
});
