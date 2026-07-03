export type RuntimeFunction = ((...args: RuntimeValue[]) => RuntimeValue) & { arity: number; plotHint?: "never" };
export type ParametricCurve = { kind: "parametric"; fn: RuntimeFunction; lo: number; hi: number };
export type ComplexValue = { kind: "complex"; re: number; im: number };
export type RuntimeValue = number | string | boolean | RuntimeValue[] | RuntimeFunction | ParametricCurve | ComplexValue;
export type ExplicitInequalityBoundary =
  | { axis: "y"; expr: Ast; fillSide: "below" | "above" }
  | { axis: "x"; expr: Ast; fillSide: "left" | "right" };

type TokenType = "number" | "string" | "name" | "op" | "arrow" | "(" | ")" | "[" | "]" | "," | "eof";
type Token = { type: TokenType; value: string | number };

type Ast =
  | { type: "number"; value: number }
  | { type: "string"; value: string }
  | { type: "name"; name: string }
  | { type: "array"; items: Ast[] }
  | { type: "unary"; op: string; expr: Ast }
  | { type: "binary"; op: string; left: Ast; right: Ast }
  | { type: "comparison-chain"; first: Ast; rest: { op: string; expr: Ast }[] }
  | { type: "let"; name: string; value: Ast; body: Ast }
  | { type: "if"; test: Ast; consequent: Ast; alternate: Ast }
  | { type: "fn"; params: string[]; body: Ast }
  | { type: "call"; callee: Ast; args: Ast[] };

export class Env {
  private readonly bindings = new Map<string, RuntimeValue>();

  constructor(private readonly parent: Env | null = null) {}

  get(name: string): RuntimeValue {
    if (this.bindings.has(name)) return this.bindings.get(name) as RuntimeValue;
    if (this.parent) return this.parent.get(name);
    throw new Error(`Unknown name: ${name}`);
  }

  has(name: string): boolean {
    return this.bindings.has(name) || Boolean(this.parent?.has(name));
  }

  set(name: string, value: RuntimeValue): void {
    this.bindings.set(name, value);
  }
}

export function createBaseEnv(): Env {
  const env = new Env();
  const constants: Record<string, RuntimeValue> = { pi: Math.PI, e: Math.E, i: { kind: "complex", re: 0, im: 1 }, true: true, false: false };
  Object.entries(constants).forEach(([name, value]) => env.set(name, value));

  const unaryMath = ["sin", "cos", "tan", "asin", "acos", "atan", "sqrt", "abs", "log", "exp", "floor", "ceil", "round"] as const;
  unaryMath.forEach((name) => {
    env.set(name, wrapFunction((value) => Math[name](asNumber(value)), 1));
  });

  env.set("min", wrapFunction((a, b) => Math.min(asNumber(a), asNumber(b)), 2));
  env.set("max", wrapFunction((a, b) => Math.max(asNumber(a), asNumber(b)), 2));
  env.set("pow", wrapFunction((a, b) => Math.pow(asNumber(a), asNumber(b)), 2));
  env.set("clamp", wrapFunction((n, lo, hi) => clamp(asNumber(n), asNumber(lo), asNumber(hi)), 3));
  env.set("lerp", wrapFunction((a, b, t) => asNumber(a) + (asNumber(b) - asNumber(a)) * asNumber(t), 3));
  env.set("range", wrapFunction((start, end, step) => range(asNumber(start), asNumber(end), asNumber(step)), 3));
  env.set("integral", wrapFunction((fn, lo, hi) => integrate(ensureFunction(fn), asNumber(lo), asNumber(hi)), 3));
  env.set("derivative", wrapFunction((...args) => derivativeValues(args), 1));
  env.set("parametric", wrapFunction((fn, lo, hi) => makeParametricCurve(ensureFunction(fn), asRealNumber(lo), asRealNumber(hi)), 3));
  env.set("error", wrapFunction((message) => {
    throw new Error(asString(message));
  }, 1));
  env.set("map", wrapFunction((fn, list) => ensureList(list).map((item) => ensureFunction(fn)(item)), 2));
  env.set("filter", wrapFunction((fn, list) => ensureList(list).filter((item) => Boolean(ensureFunction(fn)(item))), 2));
  env.set("fold", wrapFunction((fn, init, list) => ensureList(list).reduce((acc, item) => ensureFunction(fn)(acc, item), init), 3));
  env.set("zipWith", wrapFunction((fn, a, b) => zipWith(ensureFunction(fn), ensureList(a), ensureList(b)), 3));
  env.set("sum", wrapFunction((...args) => sumValues(args), 1));
  env.set("product", wrapFunction((...args) => productValues(args), 1));
  return env;
}

export function parseExpression(source: string): Ast {
  return new Parser(tokenize(source)).parseExpression();
}

export function evaluateExpression(source: string, env = createBaseEnv()): RuntimeValue {
  return evaluate(parseExpression(source), env);
}

export function evaluate(ast: Ast, env: Env): RuntimeValue {
  switch (ast.type) {
    case "number":
      return ast.value;
    case "string":
      return ast.value;
    case "name":
      return env.get(ast.name);
    case "array":
      return ast.items.map((item) => evaluate(item, env));
    case "unary":
      return applyUnary(ast.op, evaluate(ast.expr, env));
    case "binary":
      return applyBinary(ast.op, evaluate(ast.left, env), evaluate(ast.right, env));
    case "comparison-chain":
      return evaluateComparisonChain(ast, env);
    case "let": {
      const local = new Env(env);
      local.set(ast.name, evaluate(ast.value, env));
      return evaluate(ast.body, local);
    }
    case "if":
      return evaluate(ast.test, env) ? evaluate(ast.consequent, env) : evaluate(ast.alternate, env);
    case "fn":
      return makeUserFunction(ast.params, ast.body, env);
    case "call": {
      const callee = evaluate(ast.callee, env);
      const args = ast.args.map((arg) => evaluate(arg, env));
      return applyCall(callee, args);
    }
  }
}

export function makeUserFunction(params: string[], body: Ast, env: Env): RuntimeFunction {
  return wrapFunction((...args) => {
    const local = new Env(env);
    params.forEach((param, index) => local.set(param, args[index]));
    return evaluate(body, local);
  }, params.length);
}

export function usesName(ast: Ast, name: string): boolean {
  switch (ast.type) {
    case "name":
      return ast.name === name;
    case "fn":
      return !ast.params.includes(name) && usesName(ast.body, name);
    case "number":
    case "string":
      return false;
    case "array":
      return ast.items.some((item) => usesName(item, name));
    case "unary":
      return usesName(ast.expr, name);
    case "binary":
      return usesName(ast.left, name) || usesName(ast.right, name);
    case "comparison-chain":
      return usesName(ast.first, name) || ast.rest.some((item) => usesName(item.expr, name));
    case "let":
      return usesName(ast.value, name) || (ast.name !== name && usesName(ast.body, name));
    case "if":
      return usesName(ast.test, name) || usesName(ast.consequent, name) || usesName(ast.alternate, name);
    case "call":
      return usesName(ast.callee, name) || ast.args.some((arg) => usesName(arg, name));
  }
}

export function isComparisonExpression(ast: Ast): boolean {
  return ast.type === "comparison-chain" || (ast.type === "binary" && comparisonOperators.has(ast.op));
}

export function isEqualityExpression(ast: Ast): boolean {
  return ast.type === "binary" && equalityOperators.has(ast.op);
}

export function isInequalityExpression(ast: Ast): boolean {
  if (ast.type === "binary") return inequalityOperators.has(ast.op);
  return ast.type === "comparison-chain" && ast.rest.some((item) => inequalityOperators.has(item.op));
}

export type InequalityBoundaryStyle = "inclusive" | "strict" | "mixed";

export function inequalityBoundaryStyle(ast: Ast): InequalityBoundaryStyle {
  const ops = inequalityOpsIn(ast);
  const hasStrict = ops.some((op) => op === "<" || op === ">");
  const hasInclusive = ops.some((op) => op === "<=" || op === ">=");
  if (hasStrict && hasInclusive) return "mixed";
  return hasStrict ? "strict" : "inclusive";
}

export function explicitInequalityBoundary(ast: Ast): ExplicitInequalityBoundary | null {
  if (ast.type !== "binary" || !inequalityOperators.has(ast.op)) return null;

  const leftAxis = axisName(ast.left);
  if (leftAxis && !usesName(ast.right, leftAxis)) {
    if (leftAxis === "y") return { axis: "y", expr: ast.right, fillSide: fillSideFor("y", ast.op, "left") };
    return { axis: "x", expr: ast.right, fillSide: fillSideFor("x", ast.op, "left") };
  }

  const rightAxis = axisName(ast.right);
  if (rightAxis && !usesName(ast.left, rightAxis)) {
    if (rightAxis === "y") return { axis: "y", expr: ast.left, fillSide: fillSideFor("y", ast.op, "right") };
    return { axis: "x", expr: ast.left, fillSide: fillSideFor("x", ast.op, "right") };
  }

  return null;
}

export function freeNames(ast: Ast, bound = new Set<string>()): Set<string> {
  switch (ast.type) {
    case "number":
    case "string":
      return new Set();
    case "name":
      return bound.has(ast.name) ? new Set() : new Set([ast.name]);
    case "array":
      return unionSets(ast.items.map((item) => freeNames(item, bound)));
    case "unary":
      return freeNames(ast.expr, bound);
    case "binary":
      return unionSets([freeNames(ast.left, bound), freeNames(ast.right, bound)]);
    case "comparison-chain":
      return unionSets([freeNames(ast.first, bound), ...ast.rest.map((item) => freeNames(item.expr, bound))]);
    case "let": {
      const valueNames = freeNames(ast.value, bound);
      const bodyBound = new Set(bound);
      bodyBound.add(ast.name);
      return unionSets([valueNames, freeNames(ast.body, bodyBound)]);
    }
    case "if":
      return unionSets([freeNames(ast.test, bound), freeNames(ast.consequent, bound), freeNames(ast.alternate, bound)]);
    case "fn": {
      const bodyBound = new Set(bound);
      ast.params.forEach((param) => bodyBound.add(param));
      return freeNames(ast.body, bodyBound);
    }
    case "call":
      return unionSets([freeNames(ast.callee, bound), ...ast.args.map((arg) => freeNames(arg, bound))]);
  }
}

export function isRuntimeFunction(value: RuntimeValue): value is RuntimeFunction {
  return typeof value === "function";
}

export function isParametricCurve(value: RuntimeValue): value is ParametricCurve {
  return typeof value === "object" && value !== null && !Array.isArray(value) && "kind" in value && value.kind === "parametric";
}

export function ensureList(value: RuntimeValue): RuntimeValue[] {
  if (!Array.isArray(value)) throw new Error("Expected a list");
  return value;
}

export function range(start: number, end: number, step = 1): number[] {
  if (step === 0) throw new Error("range step cannot be zero");
  const out: number[] = [];
  const limit = 5000;
  if (step > 0) {
    for (let n = start; n <= end && out.length < limit; n += step) out.push(n);
  } else {
    for (let n = start; n >= end && out.length < limit; n += step) out.push(n);
  }
  return out;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (source.slice(i, i + 2) === "=>") {
      tokens.push({ type: "arrow", value: "=>" });
      i += 2;
      continue;
    }
    if (["<=", ">=", "==", "!="].includes(source.slice(i, i + 2))) {
      tokens.push({ type: "op", value: source.slice(i, i + 2) });
      i += 2;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      const match = source.slice(i).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i);
      if (!match) throw new Error(`Unexpected token: ${ch}`);
      tokens.push({ type: "number", value: Number(match[0]) });
      i += match[0].length;
      continue;
    }
    if (ch === "\"") {
      const string = readStringToken(source, i);
      tokens.push({ type: "string", value: string.value });
      i = string.end;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const match = source.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/);
      if (!match) throw new Error(`Unexpected token: ${ch}`);
      tokens.push({ type: "name", value: match[0] });
      i += match[0].length;
      continue;
    }
    if ("+-*/^<>=".includes(ch)) {
      tokens.push({ type: "op", value: ch });
      i++;
      continue;
    }
    if ("(),[]".includes(ch)) {
      tokens.push({ type: ch as TokenType, value: ch });
      i++;
      continue;
    }
    throw new Error(`Unexpected token: ${ch}`);
  }
  tokens.push({ type: "eof", value: "" });
  return tokens;
}

function readStringToken(source: string, start: number): { value: string; end: number } {
  let value = "";
  let index = start + 1;
  while (index < source.length) {
    const ch = source[index];
    if (ch === "\"") return { value, end: index + 1 };
    if (ch === "\\") {
      const next = source[index + 1];
      if (next === "\"" || next === "\\") {
        value += next;
        index += 2;
        continue;
      }
    }
    value += ch;
    index++;
  }
  throw new Error("Unterminated string");
}

class Parser {
  private pos = 0;

  constructor(private readonly tokens: Token[]) {}

  parseExpression(): Ast {
    const expr = this.parseSpecial();
    if (this.peek().type !== "eof") throw new Error(`Unexpected token: ${this.peek().value}`);
    return expr;
  }

  private parseSpecial(): Ast {
    if (this.matchName("let")) {
      const name = String(this.take("name").value);
      this.take("op", "=");
      const value = this.parseSpecial();
      this.expectName("in");
      return { type: "let", name, value, body: this.parseSpecial() };
    }
    if (this.matchName("if")) {
      const test = this.parseSpecial();
      this.expectName("then");
      const consequent = this.parseSpecial();
      this.expectName("else");
      return { type: "if", test, consequent, alternate: this.parseSpecial() };
    }
    if (this.matchName("fn")) {
      this.take("(");
      const params: string[] = [];
      if (this.peek().type !== ")") {
        do {
          params.push(String(this.take("name").value));
        } while (this.match(","));
      }
      this.take(")");
      this.take("arrow");
      return { type: "fn", params, body: this.parseSpecial() };
    }
    return this.parseComparisonChain();
  }

  private parseComparisonChain(): Ast {
    let left = this.parseBinary(0);
    const rest: { op: string; expr: Ast }[] = [];
    while (this.peek().type === "op" && comparisonOperators.has(String(this.peek().value))) {
      const op = String(this.take("op").value);
      rest.push({ op, expr: this.parseBinary(0) });
    }
    if (rest.length === 0) return left;
    if (rest.length === 1) return { type: "binary", op: rest[0].op, left, right: rest[0].expr };
    return { type: "comparison-chain", first: left, rest };
  }

  private parseBinary(minPower: number): Ast {
    let left = this.parseUnary();
    while (this.nextBinaryOp() && precedence(this.nextBinaryOp() as string) >= minPower) {
      const op = this.nextBinaryOp() as string;
      if (this.peek().type === "op") this.take("op");
      const power = precedence(op);
      const right = this.parseBinary(power + (op === "^" ? 0 : 1));
      left = { type: "binary", op, left, right };
    }
    return left;
  }

  private parseUnary(): Ast {
    if (this.peek().type === "op" && ["+", "-", "!"].includes(String(this.peek().value))) {
      const op = String(this.take("op").value);
      return { type: "unary", op, expr: this.parseUnary() };
    }
    return this.parseCall();
  }

  private parseCall(): Ast {
    let expr = this.parsePrimary();
    while ((expr.type === "name" || expr.type === "call") && this.peek().type === "(") {
      this.take("(");
      const args: Ast[] = [];
      if (this.peek().type !== ")") {
        do {
          args.push(this.parseSpecial());
        } while (this.match(","));
      }
      this.take(")");
      expr = { type: "call", callee: expr, args };
    }
    return expr;
  }

  private parsePrimary(): Ast {
    const token = this.peek();
    if (token.type === "number") return { type: "number", value: Number(this.take("number").value) };
    if (token.type === "string") return { type: "string", value: String(this.take("string").value) };
    if (token.type === "name") return { type: "name", name: String(this.take("name").value) };
    if (token.type === "(") {
      this.take("(");
      const expr = this.parseSpecial();
      this.take(")");
      return expr;
    }
    if (token.type === "[") {
      this.take("[");
      const items: Ast[] = [];
      if (this.peek().type !== "]") {
        do {
          items.push(this.parseSpecial());
        } while (this.match(","));
      }
      this.take("]");
      return { type: "array", items };
    }
    throw new Error(`Unexpected token: ${token.value}`);
  }

  private peek(): Token {
    return this.tokens[this.pos];
  }

  private take(type: TokenType, value?: string): Token {
    const token = this.peek();
    if (token.type !== type || (value !== undefined && token.value !== value)) {
      throw new Error(`Expected ${value ?? type}`);
    }
    this.pos++;
    return token;
  }

  private match(value: string): boolean {
    if (this.peek().value !== value) return false;
    this.pos++;
    return true;
  }

  private matchName(name: string): boolean {
    if (this.peek().type !== "name" || this.peek().value !== name) return false;
    this.pos++;
    return true;
  }

  private expectName(name: string): void {
    if (!this.matchName(name)) throw new Error(`Expected ${name}`);
  }

  private nextBinaryOp(): string | null {
    if (this.peek().type === "op") return String(this.peek().value);
    if (this.canStartImplicitFactor(this.peek())) return "*";
    return null;
  }

  private canStartImplicitFactor(token: Token): boolean {
    if (token.type === "number" || token.type === "(" || token.type === "[") return true;
    return token.type === "name" && !["in", "then", "else"].includes(String(token.value));
  }
}

const equalityOperators = new Set(["=", "=="]);
const comparisonOperators = new Set(["=", "==", "!=", "<", ">", "<=", ">="]);
const inequalityOperators = new Set(["<", ">", "<=", ">="]);

function inequalityOpsIn(ast: Ast): string[] {
  if (ast.type === "binary" && inequalityOperators.has(ast.op)) return [ast.op];
  if (ast.type === "comparison-chain") return ast.rest.map((item) => item.op).filter((op) => inequalityOperators.has(op));
  return [];
}

function axisName(ast: Ast): "x" | "y" | null {
  return ast.type === "name" && (ast.name === "x" || ast.name === "y") ? ast.name : null;
}

function fillSideFor(axis: "y", op: string, axisSide: "left" | "right"): "below" | "above";
function fillSideFor(axis: "x", op: string, axisSide: "left" | "right"): "left" | "right";
function fillSideFor(axis: "x" | "y", op: string, axisSide: "left" | "right"): ExplicitInequalityBoundary["fillSide"] {
  const axisIsLess = (axisSide === "left" && (op === "<" || op === "<=")) || (axisSide === "right" && (op === ">" || op === ">="));
  if (axis === "y") return axisIsLess ? "below" : "above";
  return axisIsLess ? "left" : "right";
}

function precedence(op: string): number {
  if (comparisonOperators.has(op)) return -1;
  return { "+": 3, "-": 3, "*": 4, "/": 4, "^": 5 }[op] ?? -1;
}

function unionSets<T>(sets: Set<T>[]): Set<T> {
  const out = new Set<T>();
  for (const set of sets) {
    for (const value of set) out.add(value);
  }
  return out;
}

function applyUnary(op: string, value: RuntimeValue): RuntimeValue {
  if (op === "-") return negateNumberLike(value);
  if (op === "+") return asNumber(value);
  if (op === "!") return !value;
  throw new Error(`Unknown operator: ${op}`);
}

function applyBinary(op: string, left: RuntimeValue, right: RuntimeValue): RuntimeValue {
  if (op === "+") return addNumberLike(left, right);
  if (op === "-") return subtractNumberLike(left, right);
  if (op === "*") return multiplyNumberLike(left, right);
  if (op === "/") return divideNumberLike(left, right);
  if (op === "^") return powerNumberLike(left, right);
  if (op === "<") return asNumber(left) < asNumber(right);
  if (op === ">") return asNumber(left) > asNumber(right);
  if (op === "<=") return asNumber(left) <= asNumber(right);
  if (op === ">=") return asNumber(left) >= asNumber(right);
  if (op === "=") return left === right;
  if (op === "==") return left === right;
  if (op === "!=") return left !== right;
  throw new Error(`Unknown operator: ${op}`);
}

function evaluateComparisonChain(ast: Extract<Ast, { type: "comparison-chain" }>, env: Env): boolean {
  let left = evaluate(ast.first, env);
  for (const item of ast.rest) {
    const right = evaluate(item.expr, env);
    if (!applyComparison(item.op, left, right)) return false;
    left = right;
  }
  return true;
}

function applyComparison(op: string, left: RuntimeValue, right: RuntimeValue): boolean {
  const result = applyBinary(op, left, right);
  if (typeof result !== "boolean") throw new Error(`Unknown comparison: ${op}`);
  return result;
}

function wrapFunction(fn: (...args: RuntimeValue[]) => RuntimeValue, arity: number): RuntimeFunction {
  const wrapped = ((...args: RuntimeValue[]) => fn(...args)) as RuntimeFunction;
  wrapped.arity = arity;
  return wrapped;
}

function ensureFunction(value: RuntimeValue): RuntimeFunction {
  if (!isRuntimeFunction(value)) throw new Error("Expected a function");
  return value;
}

function applyCall(callee: RuntimeValue, args: RuntimeValue[]): RuntimeValue {
  if (isRuntimeFunction(callee)) return callee(...args);
  if (typeof callee === "number" && args.length === 1) return callee * asNumber(args[0]);
  throw new Error("Expected a function");
}

function asNumber(value: RuntimeValue): number {
  if (typeof value !== "number") throw new Error("Expected a number");
  return value;
}

function asRealNumber(value: RuntimeValue): number {
  if (typeof value === "number") return value;
  if (isComplex(value) && value.im === 0) return value.re;
  throw new Error("Expected a real number");
}

function asComplex(value: RuntimeValue): ComplexValue {
  if (typeof value === "number") return { kind: "complex", re: value, im: 0 };
  if (isComplex(value)) return value;
  throw new Error("Expected a number");
}

export function isComplex(value: RuntimeValue): value is ComplexValue {
  return typeof value === "object" && value !== null && !Array.isArray(value) && "kind" in value && value.kind === "complex";
}

function simplifyNumberLike(value: ComplexValue): RuntimeValue {
  return value.im === 0 ? value.re : value;
}

function negateNumberLike(value: RuntimeValue): RuntimeValue {
  if (typeof value === "number") return -value;
  const complex = asComplex(value);
  return simplifyNumberLike({ kind: "complex", re: -complex.re, im: -complex.im });
}

function addNumberLike(left: RuntimeValue, right: RuntimeValue): RuntimeValue {
  if (typeof left === "number" && typeof right === "number") return left + right;
  const a = asComplex(left);
  const b = asComplex(right);
  return simplifyNumberLike({ kind: "complex", re: a.re + b.re, im: a.im + b.im });
}

function subtractNumberLike(left: RuntimeValue, right: RuntimeValue): RuntimeValue {
  if (typeof left === "number" && typeof right === "number") return left - right;
  const a = asComplex(left);
  const b = asComplex(right);
  return simplifyNumberLike({ kind: "complex", re: a.re - b.re, im: a.im - b.im });
}

function multiplyNumberLike(left: RuntimeValue, right: RuntimeValue): RuntimeValue {
  if (typeof left === "number" && typeof right === "number") return left * right;
  const a = asComplex(left);
  const b = asComplex(right);
  return simplifyNumberLike({ kind: "complex", re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
}

function divideNumberLike(left: RuntimeValue, right: RuntimeValue): RuntimeValue {
  if (typeof left === "number" && typeof right === "number") return left / right;
  const a = asComplex(left);
  const b = asComplex(right);
  const denominator = b.re * b.re + b.im * b.im;
  return simplifyNumberLike({ kind: "complex", re: (a.re * b.re + a.im * b.im) / denominator, im: (a.im * b.re - a.re * b.im) / denominator });
}

function powerNumberLike(left: RuntimeValue, right: RuntimeValue): RuntimeValue {
  if (typeof left === "number" && typeof right === "number") return left ** right;
  const base = asComplex(left);
  const exponent = asComplex(right);
  const baseRadius = Math.hypot(base.re, base.im);
  const baseAngle = Math.atan2(base.im, base.re);
  const logRe = Math.log(baseRadius);
  const logIm = baseAngle;
  const productRe = exponent.re * logRe - exponent.im * logIm;
  const productIm = exponent.re * logIm + exponent.im * logRe;
  const radius = Math.exp(productRe);
  const angle = productIm;
  return simplifyNumberLike({ kind: "complex", re: radius * Math.cos(angle), im: radius * Math.sin(angle) });
}

function asString(value: RuntimeValue): string {
  if (typeof value !== "string") throw new Error("Expected a string");
  return value;
}

function zipWith(fn: RuntimeFunction, a: RuntimeValue[], b: RuntimeValue[]): RuntimeValue[] {
  const length = Math.min(a.length, b.length);
  const out: RuntimeValue[] = [];
  for (let index = 0; index < length; index++) out.push(fn(a[index], b[index]));
  return out;
}

function integrate(fn: RuntimeFunction, lo: number, hi: number): number {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) throw new Error("Integral bounds must be finite");
  if (lo === hi) return 0;

  const intervals = 512;
  const step = (hi - lo) / intervals;
  let sum = asNumber(fn(lo)) + asNumber(fn(hi));
  for (let index = 1; index < intervals; index++) {
    const x = lo + step * index;
    sum += (index % 2 === 0 ? 2 : 4) * asNumber(fn(x));
  }
  return (sum * step) / 3;
}

function derivativeValues(args: RuntimeValue[]): RuntimeValue {
  if (args.length === 1) {
    const fn = ensureFunction(args[0]);
    return wrapFunction((at) => derivativeAt(fn, asNumber(at)), 1);
  }
  if (args.length === 2) return derivativeAt(ensureFunction(args[0]), asNumber(args[1]));
  throw new Error("derivative expects fn or fn, at");
}

function derivativeAt(fn: RuntimeFunction, at: number): number {
  if (!Number.isFinite(at)) throw new Error("Derivative point must be finite");
  const step = Math.max(1e-5, Math.abs(at) * 1e-5);
  return (asNumber(fn(at + step)) - asNumber(fn(at - step))) / (2 * step);
}

function makeParametricCurve(fn: RuntimeFunction, lo: number, hi: number): ParametricCurve {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) throw new Error("Parametric bounds must be finite");
  if (lo > hi) throw new Error("Parametric lower bound must be <= upper bound");
  return { kind: "parametric", fn, lo, hi };
}

function sumValues(args: RuntimeValue[]): number {
  if (args.length === 1) return ensureList(args[0]).reduce<number>((a, b) => a + asNumber(b), 0);
  if (args.length === 3) return aggregateIntegerRange(ensureFunction(args[0]), asNumber(args[1]), asNumber(args[2]), 0, (a, b) => a + b);
  throw new Error("sum expects a list or fn, lo, hi");
}

function productValues(args: RuntimeValue[]): number {
  if (args.length === 1) return ensureList(args[0]).reduce<number>((a, b) => a * asNumber(b), 1);
  if (args.length === 3) return aggregateIntegerRange(ensureFunction(args[0]), asNumber(args[1]), asNumber(args[2]), 1, (a, b) => a * b);
  throw new Error("product expects a list or fn, lo, hi");
}

function aggregateIntegerRange(
  fn: RuntimeFunction,
  lo: number,
  hi: number,
  initial: number,
  combine: (acc: number, value: number) => number
): number {
  if (!Number.isInteger(lo) || !Number.isInteger(hi)) throw new Error("Range bounds must be integers");
  const step = lo <= hi ? 1 : -1;
  const count = Math.abs(hi - lo) + 1;
  if (count > 10000) throw new Error("Range is too large");

  let acc = initial;
  for (let n = lo; step > 0 ? n <= hi : n >= hi; n += step) {
    acc = combine(acc, asNumber(fn(n)));
  }
  return acc;
}
