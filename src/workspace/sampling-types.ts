export type GraphViewport = {
  cx: number;
  cy: number;
  scale: number;
  width: number;
  height: number;
  interactive: boolean;
};

export type ScreenPoint = { x: number; y: number };

export type SampledPlotBase = {
  rowIndex: number;
  label: string;
  color: string;
};

export type SampledPlot =
  | (SampledPlotBase & { kind: "points"; points: ScreenPoint[] })
  | (SampledPlotBase & { kind: "polyline"; segments: ScreenPoint[][] })
  | (SampledPlotBase & { kind: "region-grid"; cells: ScreenCell[]; boundarySegments: ScreenSegment[]; boundaryStyle: "inclusive" | "strict" | "mixed" })
  | (SampledPlotBase & { kind: "smooth-region"; points: ScreenPoint[]; fillSide: "below" | "above" | "left" | "right"; boundaryStyle: "inclusive" | "strict" | "mixed" });

export type ScreenCell = { x: number; y: number; size: number };
export type ScreenSegment = { from: ScreenPoint; to: ScreenPoint };
