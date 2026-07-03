Lambda Graph
============

A browser-based graphing calculator with a small strict functional language underneath it.

This is a personal project and is likely to stay in flux. Features, behavior, and
builds may change without notice, and the app may or may not be working at any
given time.

Run the app with Vite during development:

```bash
npm install
npm run dev
```

The app starts with example rows, stores the current workspace in localStorage,
and can import/export versioned JSON workspace files.

Development:

```bash
npm run dev
npm run check
npm run build
npm test
```

Vite serves the app locally during development and bundles the production app into `dist/`.

Project structure:

- `src/core/` owns the expression language parser, evaluator, runtime environment, and source-structure helpers.
- `src/syntax/` adapts between MathLive LaTeX, text source, and parametric row syntax.
- `src/workspace/` normalizes rows, resolves definitions, compiles rows into results and plots, reads workspace files, and samples graph geometry.
- `src/ui/` owns the browser shell, expression list, diagnostics, graph interaction, and canvas drawing.
- `src/architecture.test.ts` documents and enforces the layer direction: core -> syntax -> workspace -> ui.
- `src/**/*.test.ts` files cover the boundary they are named after.

Design notes:

- [Design theory](docs/design-theory.md) records the principles for extending the tool.

Syntax sugar lives at explicit boundaries:

- `src/core/language.ts` owns expression-level sugar such as implicit multiplication (`2x`, `2(x + 1)`).
- `src/workspace/workspace-normalize.ts` owns row-level sugar such as treating `x`, `2x`, `y = 2x`, and `2x = y` as graph expressions, orienting `2 = t` as `t = 2`, and normalizing `f(x) = 2x` to `f = fn(x) => 2x`.
- `src/syntax/math-syntax.ts` owns visual-editor translation between MathLive LaTeX and the language source.

Language examples:

```text
x
y = 2x
f(x) = 2x
g(x) = 3*f(x)
g(4)
f = fn(x) => sin(x) + 0.35 * sin(4 * x)
f
let a = 0.18 in a * x^3 - 2 * x
(cos(t), sin(t)) {0 <= t <= 2*pi}
x^2 + y^2 = 4
y < sqrt(x)
area(lo, hi) = integral(fn(x) => x, lo, hi)
area(1, 2)
slope(x) = derivative(x^2)
slope(3)
sumTo(n) = sum(fn(i) => i, 0, n)
sumTo(5)
pts = map(fn(t) => [t, cos(t) + sin(2*t)/2], range(-8, 8, 0.35))
pts
fold(fn(acc, n) => acc + n^2, 0, range(1, 5, 1))
a(0) = 1
a(1) = 2
a(n) = a(n - 1) + a(n - 2)
a(6)
```

Supported language features include:

- Numeric expressions with `+`, `-`, `*`, `/`, `^`, comparisons, and booleans.
- Constants `pi`, `e`, and `i`; complex arithmetic is supported where the operation allows it.
- Lexical `let name = value in body` bindings.
- Conditional expressions with `if test then consequent else alternate`.
- First-class functions with `fn(x, y) => expression`.
- Arrays and higher-order functions: `map`, `filter`, `fold`, `zipWith`.
- Ranges and aggregates: `range`, `sum`, and `product`.
- Numeric calculus helpers: `integral` and `derivative`.
- Math functions such as `sin`, `cos`, `tan`, `sqrt`, `abs`, `log`, `exp`, `min`, `max`, `clamp`, and `lerp`.
- Immutable value definitions, function definitions, and case-style definitions such as `a(0) = 1`.
- Graphing constants, expressions that depend on `x`, unary functions, parametric curves, arrays of `[x, y]` points, implicit contours, and inequality regions.

The visual math editor also translates common notation such as fractions, roots,
subscripts, derivatives, definite integrals, sums, products, and parametric
arrays into the source language.
