import * as assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateExpression, freeNames, isRuntimeFunction, parseExpression } from "./language.js";
import { escapeLatexCommandToText, latexToSource, sourceToLatex } from "./math-syntax.js";
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
  assert.equal(evaluateExpression("let x = 3 in x(2)"), 6);
});

test("tracks free names with lexical scope", () => {
  assert.deepEqual([...freeNames(parseExpression("x + t"))].sort(), ["t", "x"]);
  assert.deepEqual([...freeNames(parseExpression("fn(x) => x + t"))].sort(), ["t"]);
  assert.deepEqual([...freeNames(parseExpression("let t = 2 in x + t"))].sort(), ["x"]);
});

test("converts common math editor latex into source syntax", () => {
  assert.equal(latexToSource("x^{2}"), "x^2");
  assert.equal(latexToSource("x_{1}"), "x(1)");
  assert.equal(latexToSource("x_1_2"), "x(1)(2)");
  assert.equal(latexToSource("x_1_h"), "x(1)(h)");
  assert.equal(latexToSource("y_{1,2}"), "y(1,2)");
  assert.equal(latexToSource("x_{n-1}"), "x(n-1)");
  assert.equal(latexToSource("y=2x"), "y=2x");
  assert.equal(latexToSource("\\sin(x)+\\pi"), "sin(x)+pi");
  assert.equal(latexToSource("\\frac{x^{2}}{2}"), "((x^2)/(2))");
  assert.equal(latexToSource("v=\\frac43"), "v=((4)/(3))");
  assert.equal(latexToSource("y=\\int_{1}^{2}x\\cdot dx"), "y=integral(fn(x)=>x,1,2)");
  assert.equal(latexToSource("\\int_0^1 x^2 dx"), "integral(fn(x)=>x^2,0,1)");
  assert.equal(latexToSource("\\sum_{i=1}^{4}i^2"), "sum(fn(i)=>i^2,1,4)");
  assert.equal(latexToSource("\\sum_{0}^{n}n"), "error(\"sum notation needs an index binding\")");
  assert.equal(latexToSource("\\prod_{i=1}^{4}i"), "product(fn(i)=>i,1,4)");
  assert.equal(latexToSource("\\mathrm{produce}(n)=n+1"), "produce(n)=n+1");
  assert.equal(latexToSource("\\operatorname{produce}(n)=n+1"), "produce(n)=n+1");
  assert.equal(latexToSource("\\sqrt{x+1}"), "sqrt(x+1)");
  assert.equal(latexToSource("\\sqrt x"), "sqrt(x)");
  assert.equal(latexToSource("$$ a(n)_{}=a\\left(n-1\\right)+1 $$"), "a(n)=a(n-1)+1");
});

test("escapes latex command shortcuts back to text", () => {
  assert.deepEqual(escapeLatexCommandToText("\\prod", 5), { latex: "prod", cursor: 4 });
  assert.deepEqual(escapeLatexCommandToText("y=\\sin(x)", 6), { latex: "y=sin(x)", cursor: 5 });
  assert.equal(escapeLatexCommandToText("produce(n)=n+1", 4), null);
  assert.equal(escapeLatexCommandToText("\\prod_{i=1}^{n}i", 5), null);
});

test("converts source syntax into latex for math editing", () => {
  assert.equal(sourceToLatex("x^2"), "x^2");
  assert.equal(sourceToLatex("x(1)"), "x(1)");
  assert.equal(sourceToLatex("x(1)(2)"), "x(1)(2)");
  assert.equal(sourceToLatex("sin(1)"), "\\sin(1)");
  assert.equal(sourceToLatex("sin(x) + pi"), "\\sin(x) + \\pi ");
  assert.equal(sourceToLatex("2*x"), "2\\cdot x");
  assert.equal(sourceToLatex("v=((4)/(3))*pi*r^3"), "v=\\frac{4}{3}\\cdot \\pi \\cdot r^3");
});

test("normalizes workspace row sugar before compilation", () => {
  assert.deepEqual(normalizeRow(""), { kind: "empty" });
  assert.deepEqual(normalizeRow("f = fn(x) => x^2"), { kind: "binding", source: "f = fn(x) => x^2", name: "f", expr: "fn(x) => x^2" });
  assert.deepEqual(normalizeRow("2 = t"), { kind: "binding", source: "2 = t", name: "t", expr: "2" });
  assert.deepEqual(normalizeRow("f(x) = 2x"), { kind: "function-binding", source: "f(x) = 2x", name: "f", params: ["x"], expr: "2x" });
  assert.deepEqual(normalizeRow("x(1) = 2"), { kind: "case-binding", source: "x(1) = 2", name: "x", args: ["1"], expr: "2" });
  assert.deepEqual(normalizeRow("3 = x(2)"), { kind: "case-binding", source: "3 = x(2)", name: "x", args: ["2"], expr: "3" });
  assert.deepEqual(normalizeRow("x(1)(2) = 12"), { kind: "case-binding", source: "x(1)(2) = 12", name: "x", args: ["1", "2"], expr: "12" });
  assert.deepEqual(normalizeRow("2x = f(x)"), { kind: "function-binding", source: "2x = f(x)", name: "f", params: ["x"], expr: "2x" });
  assert.deepEqual(normalizeRow("g(x) = 3*f(x)"), { kind: "function-binding", source: "g(x) = 3*f(x)", name: "g", params: ["x"], expr: "3*f(x)" });
  assert.deepEqual(normalizeRow("y = 2x"), { kind: "graph", source: "y = 2x", expr: "2x" });
  assert.deepEqual(normalizeRow("t = y"), { kind: "graph", source: "t = y", expr: "t" });
  assert.deepEqual(normalizeRow("2s = y"), { kind: "graph", source: "2s = y", expr: "2s" });
  assert.deepEqual(normalizeRow("2x"), { kind: "expression", source: "2x", expr: "2x" });
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

test("compiles function definition sugar through lexical bindings", () => {
  const program = compileWorkspace(["f(x) = 2x", "g(x) = 3*f(x)", "g"]);
  assert.deepEqual(program.rows.map((row) => row.ok), [true, true, true]);
  assert.deepEqual(program.rows.map((row) => row.text), ["f: fn/1", "g: fn/1", "fn/1"]);
  assert.equal(program.plots.length, 3);
  assert.equal(program.plots[0].kind, "function");
  assert.equal(program.plots[0].fn(4), 8);
  assert.equal(program.plots[1].kind, "function");
  assert.equal(program.plots[1].fn(4), 24);
  assert.equal(program.plots[2].kind, "function");
  assert.equal(program.plots[2].fn(5), 30);
});

test("supports multi-letter function names from math editor text identifiers", () => {
  const program = compileWorkspace([latexToSource("\\mathrm{produce}(n)=2n"), "produce(4)"]);
  assert.deepEqual(program.rows.map((row) => row.ok), [true, true]);
  assert.deepEqual(program.rows.map((row) => row.text), ["produce: fn/1", "8"]);
});

test("compiles functions whose parameters are integration bounds", () => {
  const program = compileWorkspace(["area(x1, x2) = integral(fn(x) => x, x1, x2)", "area(1, 2)", latexToSource("area_{1,2}")]);
  assert.deepEqual(program.rows.map((row) => row.ok), [true, true, true]);
  assert.deepEqual(program.rows.map((row) => row.text), ["area: fn/2", "1.5", "1.5"]);
  assert.equal(program.plots.length, 3);
});

test("compiles latex definite integral notation through the workspace", () => {
  const program = compileWorkspace([latexToSource("y=\\int_{1}^{2}x\\cdot dx")]);
  assert.deepEqual(program.rows.map((row) => row.ok), [true]);
  assert.deepEqual(program.rows.map((row) => row.text), ["y = integral(fn(x)=>x,1,2)"]);
  assert.equal(program.plots.length, 1);
  assert.equal(program.plots[0].kind, "expression");
  assert.ok(Math.abs(program.plots[0].fn(0) as number - 1.5) < 1e-6);
});

test("compiles latex sum and product notation through the workspace", () => {
  const program = compileWorkspace([latexToSource("y=\\sum_{i=1}^{4}i^2"), latexToSource("\\prod_{i=1}^{4}i"), latexToSource("s(n)=\\sum_{i=0}^{n}i"), "s(5)"]);
  assert.deepEqual(program.rows.map((row) => row.ok), [true, true, true, true]);
  assert.deepEqual(program.rows.map((row) => row.text), ["y = sum(fn(i)=>i^2,1,4)", "24", "s: fn/1", "15"]);
  assert.equal(program.plots.length, 4);
  assert.equal(program.plots[0].kind, "expression");
  assert.equal(program.plots[0].fn(0), 30);
  assert.equal(program.plots[1].kind, "expression");
  assert.equal(program.plots[1].fn(0), 24);
  assert.equal(program.plots[3].kind, "expression");
  assert.equal(program.plots[3].fn(0), 15);
});

test("reports aggregate notation without an index binder", () => {
  const program = compileWorkspace([latexToSource("\\sum_{0}^{n}n"), latexToSource("s(n)=\\sum_{0}^{n}n"), "s(5)"]);
  assert.deepEqual(program.rows.map((row) => row.ok), [false, true, false]);
  assert.equal(program.rows[0].text, "sum notation needs an index binding");
  assert.equal(program.rows[2].text, "sum notation needs an index binding");
});

test("compiles subscript-style case definitions as function cases", () => {
  const program = compileWorkspace(["x(1) = 2", "3 = x(2)", "x(1)", "x(2)", "a(1)(2) = 12", "a(1)(2)"]);
  assert.deepEqual(program.rows.map((row) => row.ok), [true, true, true, true, true, true]);
  assert.deepEqual(program.rows.map((row) => row.text), ["x(1) = 2", "x(2) = 3", "2", "3", "a(1, 2) = 12", "12"]);
  assert.equal(program.plots.length, 6);
  assert.equal(program.plots[2].kind, "expression");
  assert.equal(program.plots[2].fn(0), 2);
  assert.equal(program.plots[3].kind, "expression");
  assert.equal(program.plots[3].fn(0), 3);
  assert.equal(program.plots[5].kind, "expression");
  assert.equal(program.plots[5].fn(0), 12);
});

test("binds identifiers in case arguments as application parameters", () => {
  const program = compileWorkspace(["x(1)(h) = 2*h", "x(1)(3)", "x(1)"]);
  assert.deepEqual(program.rows.map((row) => row.ok), [true, true, true]);
  assert.deepEqual(program.rows.map((row) => row.text), ["x(1, h) = 2*h", "6", "fn/1"]);
  assert.equal(program.plots.length, 3);
  assert.equal(program.plots[0].kind, "function");
  assert.equal(program.plots[1].kind, "expression");
  assert.equal(program.plots[1].fn(0), 6);
  assert.equal(program.plots[2].kind, "function");
  assert.equal(program.plots[2].fn(4), 8);
});

test("mixes base cases with a general recursive case rule", () => {
  const program = compileWorkspace(["a(0) = 1", "a(1) = 2", "a(n) = a(n-1) + a(n-2)", "a(5)"]);
  assert.deepEqual(program.rows.map((row) => row.ok), [true, true, true, true]);
  assert.deepEqual(program.rows.map((row) => row.text), ["a(0) = 1", "a(1) = 2", "a: fn/1", "13"]);
  assert.equal(program.plots.length, 4);
  assert.equal(program.plots[3].kind, "expression");
  assert.equal(program.plots[3].fn(0), 13);
});

test("stops runaway recursive case evaluation", () => {
  const program = compileWorkspace(["a(0) = 1", "a(1) = 2", "a(n) = a(n-1) + a(n-2)", "a(30)"]);
  assert.deepEqual(program.rows.map((row) => row.ok), [true, true, true, false]);
  assert.equal(program.rows[3].text, "Evaluation limit exceeded");
});

test("uses scalar arity to read applied scalars as multiplication", () => {
  const program = compileWorkspace(["x = 3", "y = x(2)", "x(2)"]);
  assert.deepEqual(program.rows.map((row) => row.ok), [true, true, true]);
  assert.deepEqual(program.rows.map((row) => row.text), ["x: 3", "y = x(2)", "6"]);
  assert.equal(program.plots.length, 2);
  assert.equal(program.plots[0].kind, "expression");
  assert.equal(program.plots[0].fn(0), 6);
  assert.equal(program.plots[1].kind, "expression");
  assert.equal(program.plots[1].fn(0), 6);
});

test("reports duplicate case definitions separately from duplicate values", () => {
  const program = compileWorkspace(["x(1) = 2", "x(1) = 3", "x(2) = 4"]);
  assert.deepEqual(program.rows.map((row) => row.ok), [false, false, true]);
  assert.deepEqual(program.rows.map((row) => row.text), ["Duplicate case: x(1)", "Duplicate case: x(1)", "x(2) = 4"]);
});

test("summarizes concrete recursive case rows by their evaluated result", () => {
  const program = compileWorkspace(["s(10) = 1", "s(9) = s(10) + 1", "s(9)"]);
  assert.deepEqual(program.rows.map((row) => row.ok), [true, true, true]);
  assert.deepEqual(program.rows.map((row) => row.text), ["s(10) = 1", "s(9) = 2", "2"]);
});

test("resolves immutable definitions by dependency order", () => {
  const program = compileWorkspace(["t = x", "3 = x", "t", "f(n) = n + a", "4 = a", "f", "2n = h(n)", "h"]);
  assert.deepEqual(program.rows.map((row) => row.ok), [true, true, true, true, true, true, true, true]);
  assert.deepEqual(program.rows.map((row) => row.text), ["t: 3", "x: 3", "3", "f: fn/1", "a: 4", "fn/1", "h: fn/1", "fn/1"]);
  assert.equal(program.plots.length, 5);
  assert.equal(program.plots[0].kind, "expression");
  assert.equal(program.plots[0].fn(0), 3);
  assert.equal(program.plots[1].kind, "function");
  assert.equal(program.plots[1].fn(6), 10);
  assert.equal(program.plots[2].kind, "function");
  assert.equal(program.plots[2].fn(6), 10);
  assert.equal(program.plots[3].kind, "function");
  assert.equal(program.plots[3].fn(7), 14);
  assert.equal(program.plots[4].kind, "function");
  assert.equal(program.plots[4].fn(8), 16);
});

test("reports duplicate immutable definitions but allows repeated graph rows", () => {
  const program = compileWorkspace(["a = 1", "a = 2", "f(x) = x", "f(x) = x^2", "y = x", "x = y"]);
  assert.deepEqual(program.rows.map((row) => row.ok), [false, false, false, false, true, true]);
  assert.deepEqual(program.rows.map((row) => row.text), [
    "Duplicate definition: a",
    "Duplicate definition: a",
    "Duplicate definition: f",
    "Duplicate definition: f",
    "y = x",
    "y = x"
  ]);
  assert.equal(program.plots.length, 2);
});

test("reports cyclic immutable definitions", () => {
  const program = compileWorkspace(["a = b", "b = a", "z = z + 1"]);
  assert.deepEqual(program.rows.map((row) => row.ok), [false, false, false]);
  assert.equal(program.rows[0].text, "Cyclic definition: a -> b -> a");
  assert.equal(program.rows[1].text, "Cyclic definition: a -> b -> a");
  assert.equal(program.rows[2].text, "Cyclic definition: z -> z");
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

test("uses explicit y rows to infer one workspace horizontal axis", () => {
  const program = compileWorkspace(["y = t", "2t = y", "1 = y", "y = 2s", "y = s + t", "t"]);
  assert.deepEqual(program.rows.map((row) => row.ok), [true, true, true, false, false, false]);
  assert.deepEqual(program.rows.map((row) => row.text), [
    "y = t",
    "y = 2t",
    "y = 1",
    "Pick one horizontal axis: s, t",
    "Pick one horizontal axis: s, t",
    "Unknown name: t"
  ]);
  assert.equal(program.plots.length, 3);
  assert.equal(program.plots[0].kind, "expression");
  assert.equal(program.plots[0].fn(4), 4);
  assert.equal(program.plots[1].kind, "expression");
  assert.equal(program.plots[1].fn(5), 10);
  assert.equal(program.plots[2].kind, "expression");
  assert.equal(program.plots[2].fn(100), 1);
});

test("explicit graph rows respect bound names instead of shadowing with the axis", () => {
  const program = compileWorkspace(["x = 1", "y = x", "t = 2", "y = t"]);
  assert.deepEqual(program.rows.map((row) => row.ok), [true, true, true, true]);
  assert.deepEqual(program.rows.map((row) => row.text), ["x: 1", "y = x", "t: 2", "y = t"]);
  assert.equal(program.plots.length, 2);
  assert.equal(program.plots[0].kind, "expression");
  assert.equal(program.plots[0].fn(100), 1);
  assert.equal(program.plots[1].kind, "expression");
  assert.equal(program.plots[1].fn(100), 2);
});

test("reports conflicting explicit graph axis signals", () => {
  const program = compileWorkspace(["y = x", "y = 2t", "y = 3r"]);
  assert.deepEqual(program.rows.map((row) => row.ok), [true, false, false]);
  assert.deepEqual(program.rows.map((row) => row.text), ["y = x", "Pick one horizontal axis: t, x", "Pick one horizontal axis: r, x"]);
  assert.equal(program.plots.length, 1);
});

test("graphs bare scalar expressions as constant functions", () => {
  const program = compileWorkspace(["1", "2 + 3", "pi", "a = 1", "a"]);
  assert.deepEqual(program.rows.map((row) => row.ok), [true, true, true, true, true]);
  assert.deepEqual(program.rows.map((row) => row.text), ["1", "5", "3.1416", "a: 1", "1"]);
  assert.equal(program.plots.length, 4);
  for (const plot of program.plots) assert.notEqual(plot.kind, "points");
  assert.equal(program.plots[0].kind, "expression");
  assert.equal(program.plots[0].fn(100), 1);
  assert.equal(program.plots[1].kind, "expression");
  assert.equal(program.plots[1].fn(-4), 5);
  assert.equal(program.plots[2].kind, "expression");
  assert.equal(program.plots[2].fn(0), Math.PI);
  assert.equal(program.plots[3].kind, "expression");
  assert.equal(program.plots[3].fn(0), 1);
});

test("reports parse errors without throwing out of workspace compilation", () => {
  const program = compileWorkspace(["1 +", "2 + 2"]);
  assert.equal(program.rows[0].ok, false);
  assert.equal(program.rows[1].text, "4");
});
