import * as assert from "node:assert/strict";
import { test } from "node:test";
import { escapeLatexCommandToText, latexToSource, sourceToLatex } from "./math-syntax.js";

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
  assert.equal(latexToSource("y_3=\\frac{\\differentialD f}{\\differentialD x}\\left(2\\right)"), "y(3)=derivative(f,2)");
  assert.equal(latexToSource("y_3=\\frac{df}{dx}(2)"), "y(3)=derivative(f,2)");
  assert.equal(latexToSource("v=\\frac43"), "v=((4)/(3))");
  assert.equal(latexToSource("y=\\int_{1}^{2}x\\cdot dx"), "y=integral(fn(x)=>x,1,2)");
  assert.equal(latexToSource("\\int_0^1 x^2 dx"), "integral(fn(x)=>x^2,0,1)");
  assert.equal(latexToSource("\\int_0^1\\left(\\sin x\\right)\\differentialD x"), "integral(fn(x)=>(sin(x)),0,1)");
  assert.equal(latexToSource("\\int_0^1 (\\sin x) \\mathrm{d}x"), "integral(fn(x)=>(sin(x)),0,1)");
  assert.equal(latexToSource("\\int_0^1 (\\sin x) \\differentialD x"), "integral(fn(x)=>(sin(x)),0,1)");
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
