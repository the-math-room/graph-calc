import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const includeRoots = [
  "src",
  "docs",
  "fixtures",
  "scripts",
  "index.html",
  "styles.css",
  "package.json",
  "tsconfig.json",
  "tsconfig.test.json",
  "vite.config.ts",
  "README.md"
];
const sourceExtensions = new Set([".css", ".html", ".json", ".md", ".mjs", ".ts"]);

for (const file of sourceFiles()) {
  const path = relative(root, file);
  process.stdout.write(`\n===== ${path} =====\n`);
  process.stdout.write(readFileSync(file, "utf8"));
  process.stdout.write("\n");
}

function sourceFiles() {
  return includeRoots
    .flatMap((entry) => filesFor(resolve(root, entry)))
    .filter((file) => sourceExtensions.has(extension(file)))
    .sort((a, b) => relative(root, a).localeCompare(relative(root, b)));
}

function filesFor(path) {
  if (!exists(path)) return [];
  const stats = statSync(path);
  if (stats.isFile()) return [path];
  if (!stats.isDirectory()) return [];

  return readdirSync(path)
    .flatMap((entry) => filesFor(resolve(path, entry)));
}

function exists(path) {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

function extension(path) {
  const match = /(\.[^.]+)$/.exec(path);
  return match ? match[1] : "";
}
