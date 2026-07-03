import * as assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateExpression, isRuntimeFunction } from "./language.js";
import { compileWorkspace } from "./workspace.js";

test("evaluates arithmetic with precedence", () => {
  assert.equal(evaluateExpression("1 + 2 * 3^2"), 19);
});

test("supports lexical let bindings", () => {
  assert.equal(evaluateExpression("let x = 4 in let y = x + 1 in y * 2"), 10);
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

test("reports parse errors without throwing out of workspace compilation", () => {
  const program = compileWorkspace(["1 +", "2 + 2"]);
  assert.equal(program.rows[0].ok, false);
  assert.equal(program.rows[1].text, "4");
});
