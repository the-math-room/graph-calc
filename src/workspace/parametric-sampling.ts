import { pushSegment, sampledBase, screenDistance, worldToScreen } from "./sampling-geometry.js";
import type { GraphViewport, SampledPlot, ScreenPoint } from "./sampling-types.js";
import type { Plot } from "./workspace-values.js";

export function sampleParametric(plot: Extract<Plot, { kind: "parametric" }>, viewport: GraphViewport): SampledPlot {
  const segments: ScreenPoint[][] = [];
  let segment: ScreenPoint[] = [];
  let previous: ScreenPoint | null = null;
  const maxSamples = viewport.interactive ? 420 : 1600;
  const samples = Math.max(64, Math.min(maxSamples, Math.floor(viewport.width * 1.5)));

  for (let index = 0; index <= samples; index++) {
    const ratio = index / samples;
    const t = plot.curve.lo + (plot.curve.hi - plot.curve.lo) * ratio;
    const world = evaluateParametricPoint(plot, t);
    if (!world) {
      segment = pushSegment(segments, segment);
      previous = null;
      continue;
    }

    const point = worldToScreen(viewport, world.x, world.y);
    if (previous && screenDistance(point, previous) > Math.max(viewport.width, viewport.height) * 0.72) segment = pushSegment(segments, segment);
    segment.push(point);
    previous = point;
  }
  pushSegment(segments, segment);
  return { ...sampledBase(plot), kind: "polyline", segments };
}

function evaluateParametricPoint(plot: Extract<Plot, { kind: "parametric" }>, t: number): ScreenPoint | null {
  try {
    const value = plot.curve.fn(t);
    if (!Array.isArray(value) || value.length !== 2) return null;
    const [x, y] = value;
    return typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y) ? { x, y } : null;
  } catch {
    return null;
  }
}
