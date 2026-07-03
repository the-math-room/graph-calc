import * as assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateExpression, freeNames, isRuntimeFunction, parseExpression } from "./language.js";

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
  assert.equal(evaluateExpression("let x = 3 in x(2)"), 6);
});

test("tracks free names with lexical scope", () => {
  assert.deepEqual([...freeNames(parseExpression("x + t"))].sort(), ["t", "x"]);
  assert.deepEqual([...freeNames(parseExpression("fn(x) => x + t"))].sort(), ["t"]);
  assert.deepEqual([...freeNames(parseExpression("let t = 2 in x + t"))].sort(), ["x"]);
});

test("supports first-class functions and higher-order list operations", () => {
  assert.deepEqual(evaluateExpression("map(fn(x) => x^2, range(1, 4, 1))"), [1, 4, 9, 16]);
  assert.equal(evaluateExpression("fold(fn(acc, n) => acc + n, 0, range(1, 4, 1))"), 10);
  assert.equal(evaluateExpression("sum(fn(i) => i^2, 1, 4)"), 30);
  assert.equal(evaluateExpression("product(fn(i) => i, 1, 4)"), 24);
  assert.equal(evaluateExpression("let hi = 4 in sum(fn(i) => i, 1, hi)"), 10);
});

test("evaluates numeric integrals with expression bounds", () => {
  assert.ok(Math.abs(Number(evaluateExpression("integral(fn(x) => x^2, 0, 1)")) - 1 / 3) < 1e-6);
  assert.ok(Math.abs(Number(evaluateExpression("let lo = 1 in let hi = 2 in integral(fn(x) => x, lo, hi)")) - 1.5) < 1e-6);
  assert.ok(Math.abs(Number(evaluateExpression("let area = fn(x1, x2) => integral(fn(x) => x, x1, x2) in area(1, 2)")) - 1.5) < 1e-6);
});

test("evaluates numeric derivatives", () => {
  assert.ok(Math.abs(Number(evaluateExpression("derivative(fn(x) => x^2, 3)")) - 6) < 1e-3);
  assert.ok(Math.abs(Number(evaluateExpression("derivative(sin, 0)")) - 1) < 1e-3);
  const derivative = evaluateExpression("derivative(fn(x) => x^3)");
  assert.equal(isRuntimeFunction(derivative), true);
  if (isRuntimeFunction(derivative)) assert.ok(Math.abs(Number(derivative(2)) - 12) < 1e-3);
});

test("returns callable runtime functions", () => {
  const value = evaluateExpression("fn(x) => x * x");
  assert.equal(isRuntimeFunction(value), true);
  if (isRuntimeFunction(value)) assert.equal(value(5), 25);
});
