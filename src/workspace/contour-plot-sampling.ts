import { interpolatedContourSegments } from "./contour-sampling.js";
import { sampledBase, screenToWorld } from "./sampling-geometry.js";
import type { GraphViewport, SampledPlot } from "./sampling-types.js";
import type { Plot } from "./workspace-values.js";

export function sampleContour(plot: Extract<Plot, { kind: "contour" }>, viewport: GraphViewport): SampledPlot {
  const cellSize = viewport.interactive ? 10 : 4;
  const columns = Math.ceil(viewport.width / cellSize);
  const rows = Math.ceil(viewport.height / cellSize);
  const values: (number | null)[][] = [];

  for (let row = 0; row <= rows; row++) {
    values[row] = [];
    for (let column = 0; column <= columns; column++) {
      const world = screenToWorld(viewport, column * cellSize, row * cellSize);
      values[row][column] = plot.boundaryValue(world.x, world.y);
    }
  }

  return {
    ...sampledBase(plot),
    kind: "polyline",
    segments: interpolatedContourSegments(values, cellSize, columns, rows).map((segment) => [segment.from, segment.to])
  };
}
