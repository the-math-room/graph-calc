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
