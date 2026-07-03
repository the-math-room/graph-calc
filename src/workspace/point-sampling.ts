import { sampledBase, worldToScreen } from "./sampling-geometry.js";
import type { GraphViewport, SampledPlot } from "./sampling-types.js";
import type { Plot } from "./workspace-values.js";

export function samplePoints(plot: Extract<Plot, { kind: "points" }>, viewport: GraphViewport): SampledPlot {
  return {
    ...sampledBase(plot),
    kind: "points",
    points: plot.points.map(([x, y]) => worldToScreen(viewport, x, y))
  };
}
