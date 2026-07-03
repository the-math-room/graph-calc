import type { RuntimeValue } from "../core/language.js";
import { pushSegment, sampledBase, screenDistance, screenToWorld, worldToScreen } from "./sampling-geometry.js";
import type { GraphViewport, SampledPlot, ScreenPoint } from "./sampling-types.js";
import type { Plot } from "./workspace-values.js";

export function sampleFunction(plot: Extract<Plot, { kind: "function" | "expression" }>, viewport: GraphViewport): SampledPlot {
  const segments: ScreenPoint[][] = [];
  let segment: ScreenPoint[] = [];
  let previous: ScreenPoint | null = null;
  const step = viewport.interactive ? 4 : 2;

  for (let sx = 0; sx <= viewport.width; sx += step) {
    const x = screenToWorld(viewport, sx, 0).x;
    const y = evaluatePlotY(plot, x);
    if (y === null) {
      segment = pushSegment(segments, segment);
      previous = null;
      continue;
    }

    const point = worldToScreen(viewport, x, y);
    if (previous && screenDistance(point, previous) > viewport.height * 0.72) segment = pushSegment(segments, segment);
    segment.push(point);
    previous = point;
  }
  pushSegment(segments, segment);
  return { ...sampledBase(plot), kind: "polyline", segments };
}

function evaluatePlotY(plot: Extract<Plot, { kind: "function" | "expression" }>, x: number): number | null {
  try {
    const y: RuntimeValue = plot.fn(x);
    return typeof y === "number" && Number.isFinite(y) ? y : null;
  } catch {
    return null;
  }
}
