Lambda Graph
============

A browser-based graphing calculator with a small strict functional language underneath it.

Open `index.html` in a browser to run the compiled app.

Development:

```bash
npm install
npm run build
npm test
```

The TypeScript source lives in `src/app.ts`; the browser loads `dist/app.js`.

Project structure:

- `src/app.ts` owns browser event handling and canvas rendering.
- `src/language.ts` owns the parser, evaluator, runtime environment, and functional standard library.
- `src/workspace.ts` adapts expression rows into graphable plots and user-facing result text.
- `src/language.test.ts` covers the functional language and workspace compilation behavior.

Language examples:

```text
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
