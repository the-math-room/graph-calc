Lambda Graph
============

A browser-based graphing calculator with a small strict functional language underneath it.

Open `index.html` in a browser to run the compiled app.

Development:

```bash
npm install
npm run dev
npm run build
npm test
```

Vite serves the app locally during development and bundles the production app into `dist/`.

Project structure:

- `src/app.ts` owns browser event handling and canvas rendering.
- `src/language.ts` owns the parser, evaluator, runtime environment, and functional standard library.
- `src/math-syntax.ts` adapts between the visual math editor's LaTeX and the graph language syntax.
- `src/workspace.ts` is the public workspace facade.
- `src/workspace-compiler.ts` normalizes and parses rows into compiled workspace rows.
- `src/workspace-definitions.ts` resolves immutable and case definitions into the workspace environment.
- `src/workspace-render.ts` adapts compiled rows into graphable plots and user-facing result text.
- `src/*.test.ts` files cover the boundary they are named after: language, math syntax, and workspace behavior.

Design notes:

- [Design theory](docs/design-theory.md) records the principles for extending the tool.

Syntax sugar lives at explicit boundaries:

- `src/language.ts` owns expression-level sugar such as implicit multiplication (`2x`, `2(x + 1)`).
- `src/workspace-normalize.ts` owns row-level sugar such as treating `x`, `2x`, `y = 2x`, and `2x = y` as graph expressions, orienting `2 = t` as `t = 2`, and normalizing `f(x) = 2x` to `f = fn(x) => 2x`.
- `src/math-syntax.ts` owns visual-editor translation between MathLive LaTeX and the language source.

Language examples:

```text
f(x) = 2x
g(x) = 3*f(x)
f = fn(x) => sin(x) + 0.35 * sin(4 * x)
f
let a = 0.18 in a * x^3 - 2 * x
pts = map(fn(t) => [t, cos(t) + sin(2*t)/2], range(-8, 8, 0.35))
pts
fold(fn(acc, n) => acc + n^2, 0, range(1, 5, 1))
```

Supported language features include:

- Numeric expressions with `+`, `-`, `*`, `/`, `^`, comparisons, and booleans.
- Lexical `let name = value in body` bindings.
- First-class functions with `fn(x, y) => expression`.
- Arrays and higher-order functions: `map`, `filter`, `fold`, `zipWith`.
- Math functions such as `sin`, `cos`, `tan`, `sqrt`, `abs`, `log`, and `exp`.
- Graphing unary functions, expressions that depend on `x`, and arrays of `[x, y]` points.
