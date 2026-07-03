import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { compileWorkspace } from "./workspace.js";
import { readWorkspaceFile, workspaceFileSchema } from "./workspace-file.js";

test("reads versioned workspace files losslessly", () => {
  const file = readWorkspaceFile({
    schema: workspaceFileSchema,
    rows: [
      { id: "row-a", source: "x^2", latex: "x^2", mode: "pretty" },
      { source: "(cos(t), sin(t)) {0 <= t <= 2*pi}", mode: "text" }
    ],
    view: {
      expressionSizeScale: 57,
      sidebarWidth: 460
    }
  });

  assert.deepEqual(file, {
    schema: workspaceFileSchema,
    rows: [
      { id: "row-a", source: "x^2", latex: "x^2", mode: "pretty" },
      { source: "(cos(t), sin(t)) {0 <= t <= 2*pi}", mode: "text" }
    ],
    view: {
      expressionSizeScale: 57,
      sidebarWidth: 460
    }
  });
});

test("rejects unsupported workspace file versions", () => {
  assert.equal(readWorkspaceFile({ schema: "lambda-graph.workspace.v0", rows: [] }), null);
});

test("rejects malformed workspace rows", () => {
  assert.equal(readWorkspaceFile({ schema: workspaceFileSchema, rows: [{ source: "x", mode: "symbolic" }] }), null);
  assert.equal(readWorkspaceFile({ schema: workspaceFileSchema, rows: [{ latex: "x", mode: "pretty" }] }), null);
  assert.equal(readWorkspaceFile({ schema: workspaceFileSchema, rows: [{ source: "x", latex: 1, mode: "pretty" }] }), null);
});

test("rejects malformed workspace view state", () => {
  assert.equal(readWorkspaceFile({ schema: workspaceFileSchema, rows: [], view: { sidebarWidth: "wide" } }), null);
  assert.equal(readWorkspaceFile({ schema: workspaceFileSchema, rows: [], view: [] }), null);
});

test("kitchen sink workspace fixture imports and compiles without row errors", () => {
  const file = readWorkspaceFile(JSON.parse(readFileSync("fixtures/kitchen-sink.workspace.json", "utf8")));
  assert.ok(file);

  const program = compileWorkspace(file.rows.map((row) => row.source));
  assert.deepEqual(program.rows.map((row) => row.ok), file.rows.map(() => true));
  assert.ok(program.plots.length > 0);
});
