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
  assert.equal(sampled[0].kind, "implicit-region");
  if (sampled[0].kind !== "implicit-region") return;
  assert.ok(sampled[0].boundarySegments.some((segment) => segment.from.x !== segment.to.x && segment.from.y !== segment.to.y));
  assert.ok(sampled[0].boundarySegments.some((segment) => !Number.isInteger(segment.from.x) || !Number.isInteger(segment.from.y)));
  assert.ok(sampled[0].cellCount > 0);
  assert.ok(sampled[0].fillRuns.length > 0);
  assert.ok(sampled[0].fillPolygons.length < sampled[0].cellCount);
  assert.ok(sampled[0].fillPolygons.some((polygon) => polygon.length === 3 || polygon.length > 4));
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

test("uses caller supplied row colors for plots", () => {
  const program = compileWorkspace(["x", "x^2"], ["#111111", "#222222"]);

  assert.equal(program.plots[0].color, "#111111");
  assert.equal(program.plots[1].color, "#222222");
});

test("fills smooth regions when the boundary is outside the viewport", () => {
  const program = compileWorkspace(["y < 100"]);
  const sampled = sampleWorkspacePlots(program.plots, {
    cx: 0,
    cy: 0,
    scale: 64,
    width: 300,
    height: 300,
    interactive: false
  });

  assert.equal(sampled[0].kind, "smooth-region");
  if (sampled[0].kind !== "smooth-region") return;
  assert.equal(sampled[0].points.length, 0);
  assert.equal(sampled[0].fillAll, true);
});

test("samples implicit regions more finely when idle than while interacting", () => {
  const program = compileWorkspace(["x^2 + y^2 <= 1"]);
  const baseViewport = {
    cx: 0,
    cy: 0,
    scale: 64,
    width: 300,
    height: 300
  };
  const idle = sampleWorkspacePlots(program.plots, { ...baseViewport, interactive: false });
  const interactive = sampleWorkspacePlots(program.plots, { ...baseViewport, interactive: true });

  assert.equal(idle[0].kind, "implicit-region");
  assert.equal(interactive[0].kind, "implicit-region");
  if (idle[0].kind !== "implicit-region" || interactive[0].kind !== "implicit-region") return;
  assert.ok(idle[0].boundarySegments.length > interactive[0].boundarySegments.length);
  assert.ok(idle[0].cellCount > interactive[0].cellCount);
});

test("caps implicit region sampling budget on large viewports", () => {
  const program = compileWorkspace(["x^2 + y^2 <= 1"]);
  const sampled = sampleWorkspacePlots(program.plots, {
    cx: 0,
    cy: 0,
    scale: 64,
    width: 2400,
    height: 1600,
    interactive: false
  });

  assert.equal(sampled[0].kind, "implicit-region");
  if (sampled[0].kind !== "implicit-region") return;
  assert.ok(sampled[0].cellCount < 160_000);
  assert.ok(sampled[0].fillRuns.length < sampled[0].cellCount);
});
