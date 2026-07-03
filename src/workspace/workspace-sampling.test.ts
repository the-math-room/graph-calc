import * as assert from "node:assert/strict";
import { test } from "node:test";
import { compileWorkspace } from "./workspace.js";
import { sampleWorkspacePlots } from "./workspace-sampling.js";

test("samples implicit region boundaries as contours instead of cell edges", () => {
  const program = compileWorkspace(["x^2 + y^2 <= 1"]);
  const sampled = sampleWorkspacePlots(program.plots, {
    cx: 0,
    cy: 0,
    scale: 64,
    width: 300,
    height: 300,
    interactive: false
  });

  assert.equal(sampled.length, 1);
  assert.equal(sampled[0].kind, "region-grid");
  if (sampled[0].kind !== "region-grid") return;
  assert.ok(sampled[0].boundarySegments.some((segment) => segment.from.x !== segment.to.x && segment.from.y !== segment.to.y));
  assert.ok(sampled[0].boundarySegments.some((segment) => !Number.isInteger(segment.from.x / 6) && !Number.isInteger(segment.from.x / 3)));
});

test("samples implicit equality rows as contours", () => {
  const program = compileWorkspace(["x^2 + y^2 = 4"]);
  const sampled = sampleWorkspacePlots(program.plots, {
    cx: 0,
    cy: 0,
    scale: 64,
    width: 300,
    height: 300,
    interactive: false
  });

  assert.equal(sampled.length, 1);
  assert.equal(sampled[0].kind, "polyline");
  if (sampled[0].kind !== "polyline") return;
  assert.ok(sampled[0].segments.length > 0);
});
