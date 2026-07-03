import * as assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { test } from "node:test";

const srcRoot = resolve("src");
const layerOrder = new Map([
  ["core", 0],
  ["syntax", 1],
  ["workspace", 2],
  ["ui", 3]
]);

const imperativeShellOnlyPatterns = [
  /\bdocument\b/,
  /\bwindow\b/,
  /\blocalStorage\b/,
  /\bHTMLElement\b/,
  /\bHTML[A-Za-z]*Element\b/,
  /\bCanvasRenderingContext2D\b/,
  /\bMathfieldElement\b/,
  /\baddEventListener\b/,
  /\bquerySelector\b/,
  /\bclassList\b/,
  /\bgetContext\b/,
  /\bdevicePixelRatio\b/,
  /\bMath\.random\b/,
  /\bDate\./,
  /\bnew Date\b/,
  /\bperformance\b/,
  /\bsetTimeout\b/,
  /\bsetInterval\b/,
  /\bfetch\b/,
  /\bXMLHttpRequest\b/,
  /\bconsole\./,
  /\bprocess\./,
  /\bglobalThis\b/,
  /\bnavigator\b/,
  /\blocation\b/,
  /\bhistory\b/
];

const workspaceSamplingInternals = new Set([
  "workspace/contour-plot-sampling.ts",
  "workspace/function-sampling.ts",
  "workspace/marching-squares.ts",
  "workspace/parametric-sampling.ts",
  "workspace/point-sampling.ts",
  "workspace/region-sampling.ts",
  "workspace/sampling-geometry.ts",
  "workspace/sampling-types.ts"
]);

test("module dependencies follow the documented layer direction", () => {
  const violations: string[] = [];
  for (const file of sourceFiles(srcRoot)) {
    const fromLayer = layerFor(file);
    if (fromLayer === null) continue;

    for (const specifier of importSpecifiers(readFileSync(file, "utf8"))) {
      if (!specifier.startsWith(".")) continue;
      const targetLayer = layerFor(resolve(file, "..", specifier));
      if (targetLayer === null) continue;

      const fromOrder = layerOrder.get(fromLayer) ?? -1;
      const targetOrder = layerOrder.get(targetLayer) ?? -1;
      if (targetOrder > fromOrder) {
        violations.push(`${relative(srcRoot, file)} imports ${specifier} from ${targetLayer}`);
      }
    }
  }

  assert.deepEqual(violations, []);
});

test("ambient effects stay in the UI shell", () => {
  const violations: string[] = [];
  for (const file of sourceFiles(srcRoot)) {
    if (file.endsWith(".test.ts") || layerFor(file) === "ui") continue;
    const source = readFileSync(file, "utf8");
    const matches = imperativeShellOnlyPatterns
      .filter((pattern) => pattern.test(source))
      .map((pattern) => pattern.source);
    if (matches.length > 0) violations.push(`${relative(srcRoot, file)} uses shell-only tokens: ${matches.join(", ")}`);
  }

  assert.deepEqual(violations, []);
});

test("workspace sampling internals stay behind the workspace sampling facade outside the workspace layer", () => {
  const violations: string[] = [];
  for (const file of sourceFiles(srcRoot)) {
    const fromLayer = layerFor(file);
    if (fromLayer === "workspace") continue;

    for (const specifier of importSpecifiers(readFileSync(file, "utf8"))) {
      if (!specifier.startsWith(".")) continue;
      const target = resolveSourceImport(file, specifier);
      if (target && workspaceSamplingInternals.has(relative(srcRoot, target))) {
        violations.push(`${relative(srcRoot, file)} imports workspace sampling internal ${specifier}`);
      }
    }
  }

  assert.deepEqual(violations, []);
});

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = resolve(dir, entry);
    if (statSync(path).isDirectory()) {
      files.push(...sourceFiles(path));
    } else if (path.endsWith(".ts")) {
      files.push(path);
    }
  }
  return files;
}

function layerFor(path: string): string | null {
  const [layer] = relative(srcRoot, path).split(/[\\/]/);
  return layerOrder.has(layer) ? layer : null;
}

function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const pattern = /\b(?:import|export)\b(?:\s+type)?(?:[^'"]*?\sfrom\s*)?["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) specifiers.push(match[1]);
  return specifiers;
}

function resolveSourceImport(fromFile: string, specifier: string): string | null {
  const target = resolve(fromFile, "..", specifier);
  if (target.endsWith(".ts")) return target;
  return `${target}.ts`;
}
