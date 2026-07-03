import { sampleContour } from "./contour-plot-sampling.js";
import { sampleFunction } from "./function-sampling.js";
import { sampleParametric } from "./parametric-sampling.js";
import { samplePoints } from "./point-sampling.js";
import { sampleRegion } from "./region-sampling.js";
import type { GraphViewport, SampledPlot } from "./sampling-types.js";
import type { Plot } from "./workspace-values.js";

export type { GraphViewport, SampledPlot, SampledPlotBase, ScreenCell, ScreenPoint, ScreenSegment } from "./sampling-types.js";

export function sampleWorkspacePlots(plots: Plot[], viewport: GraphViewport): SampledPlot[] {
  return plots.map((plot) => samplePlot(plot, viewport)).filter((plot) => plot !== null);
}

function samplePlot(plot: Plot, viewport: GraphViewport): SampledPlot | null {
  switch (plot.kind) {
    case "points":
      return samplePoints(plot, viewport);
    case "region":
      return sampleRegion(plot, viewport);
    case "contour":
      return sampleContour(plot, viewport);
    case "parametric":
      return sampleParametric(plot, viewport);
    case "function":
    case "expression":
      return sampleFunction(plot, viewport);
  }
}
