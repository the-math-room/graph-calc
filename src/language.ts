export type RuntimeFunction = ((...args: RuntimeValue[]) => RuntimeValue) & { arity: number };
export type RuntimeValue = number | string | boolean | RuntimeValue[] | RuntimeFunction;

type TokenType = "number" | "string" | "name" | "op" | "arrow" | "(" | ")" | "[" | "]" | "," | "eof";
type Token = { type: TokenType; value: string | number };

type Ast =
  | { type: "number"; value: number }
  | { type: "string"; value: string }
  | { type: "name"; name: string }
  | { type: "array"; items: Ast[] }
  | { type: "unary"; op: string; expr: Ast }
  | { type: "binary"; op: string; left: Ast; right: Ast }
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
  const constants: Record<string, RuntimeValue> = { pi: Math.PI, e: Math.E, true: true, false: false };
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
    case "let":
      return usesName(ast.value, name) || (ast.name !== name && usesName(ast.body, name));
    case "if":
      return usesName(ast.test, name) || usesName(ast.consequent, name) || usesName(ast.alternate, name);
    case "call":
      return usesName(ast.callee, name) || ast.args.some((arg) => usesName(arg, name));
  }
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
    return this.parseBinary(0);
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

function precedence(op: string): number {
  return { "==": 1, "!=": 1, "<": 2, ">": 2, "<=": 2, ">=": 2, "+": 3, "-": 3, "*": 4, "/": 4, "^": 5 }[op] ?? -1;
}

function unionSets<T>(sets: Set<T>[]): Set<T> {
  const out = new Set<T>();
  for (const set of sets) {
    for (const value of set) out.add(value);
  }
  return out;
}

function applyUnary(op: string, value: RuntimeValue): RuntimeValue {
  if (op === "-") return -asNumber(value);
  if (op === "+") return asNumber(value);
  if (op === "!") return !value;
  throw new Error(`Unknown operator: ${op}`);
}

function applyBinary(op: string, left: RuntimeValue, right: RuntimeValue): RuntimeValue {
  if (op === "+") return asNumber(left) + asNumber(right);
  if (op === "-") return asNumber(left) - asNumber(right);
  if (op === "*") return asNumber(left) * asNumber(right);
  if (op === "/") return asNumber(left) / asNumber(right);
  if (op === "^") return asNumber(left) ** asNumber(right);
  if (op === "<") return asNumber(left) < asNumber(right);
  if (op === ">") return asNumber(left) > asNumber(right);
  if (op === "<=") return asNumber(left) <= asNumber(right);
  if (op === ">=") return asNumber(left) >= asNumber(right);
  if (op === "==") return left === right;
  if (op === "!=") return left !== right;
  throw new Error(`Unknown operator: ${op}`);
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
