Design Theory
=============

Lambda Graph is a graphing workspace over a small, strict functional language. The core language should stay boring and principled: expressions evaluate in lexical environments, functions are first-class values, definitions are immutable, and ordinary source order should not be the hidden meaning of a pure definition. The graphing calculator behavior lives around that core as workspace interpretation, not inside the evaluator.

The project should feel unsurprising to someone with undergraduate math habits while still having functional-language semantics underneath. That means notation like `f(x) = 2x`, `2 = t`, `x_1`, and `\sum_{i=1}^{n}` can be accepted when it has a clear mathematical reading, but it must lower to one coherent internal model rather than becoming a pile of special cases.

Design Principles
-----------------

- Keep the evaluator small and semantic. Add core constructs to `src/language.ts` only when they are true language features, not editor conveniences.
- Put sugar at explicit boundaries. Visual notation belongs in `src/syntax/math-syntax.ts`; row-level graphing and assignment conventions belong in `src/workspace/workspace-normalize.ts`; workspace rendering belongs in `src/workspace/workspace-render.ts`; evaluation belongs in `src/core/language.ts`.
- Keep module dependencies flowing one way: `src/ui` may depend on `src/workspace`, `src/syntax`, and `src/core`; `src/workspace` may depend on `src/syntax` and `src/core`; `src/syntax` may depend on `src/core`; `src/core` depends on no app layer.
- Prefer desugaring over parallel meanings. Subscripts desugar to function application, function definition sugar desugars to `fn`, and aggregate notation desugars to ordinary functions like `sum(fn(i) => ..., lo, hi)`.
- Make equations symmetric when the target is clear. `t = 2` and `2 = t` are the same definition; `y = 2x` and `2x = y` are the same graph row.
- Preserve graphing conventions only where they are graphing conventions. Multiple `y = ...` rows are allowed because graphing calculators do that; duplicate immutable definitions are errors.
- Resolve pure definitions as a workspace, not as a script. Immutable definitions may refer to later immutable definitions, cycles are errors, and row order should not change the meaning of a pure definition.
- Use explicit errors when notation becomes ambiguous. If more than one horizontal axis is signaled, ask the user to pick one. If aggregate notation omits the index binding, report that instead of guessing.
- Prefer recoverable editor behavior. MathLive can offer pretty shortcuts, but users need a way back to text (`Escape`, text mode) when a shortcut guesses wrong.
- Summaries should explain the row, not just the runtime type. A concrete case like `s(9) = s(10) + 1` should show `s(9) = 2`; a general function can still summarize as `fn/1`.
- Add tests at the boundary where the rule lives. Parser/evaluator rules belong in language tests; notation lowering belongs in math syntax tests; graphing/workspace conventions belong in workspace compilation tests.

Current Commitments
-------------------

- `x(1)` in source remains function application, not subscript notation.
- `x_1` in the visual editor lowers to `x(1)`.
- If a bound scalar is applied to one argument, `x(2)` behaves as multiplication.
- Case definitions such as `a(0) = 1`, `a(1) = 2`, and `a(n) = a(n-1) + a(n-2)` define one case function.
- Recurrence evaluation is bounded so a typo cannot hang the page indefinitely.
- Definite integrals, sums, and products are runtime functions; their visual notations lower to those functions.
- Parametric curves are explicit runtime values: `parametric(fn(t) => [x(t), y(t)], lo, hi)`. Desmos-shaped coordinate-pair notation such as `(cos(t), sin(t)) {0 <= t <= 2*pi}` is workspace sugar for that value.
- Parametric bounds denote an ordered interval; `lo` must be less than or equal to `hi`. Reversed chained notation such as `2 >= t >= -2` is accepted only because it still describes the ordered interval `[-2, 2]`.
- Complex values do not silently become real through numerical tolerance. Real-only contexts, such as parametric bounds, require an actual real number or an explicit projection we have deliberately added.
