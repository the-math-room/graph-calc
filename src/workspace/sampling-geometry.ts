import type { GraphViewport, ScreenPoint } from "./sampling-types.js";
import type { Plot } from "./workspace-values.js";

export function sampledBase(plot: Plot): Pick<Plot, "rowIndex" | "label" | "color"> {
  return { rowIndex: plot.rowIndex, label: plot.label, color: plot.color };
}

export function pushSegment(segments: ScreenPoint[][], segment: ScreenPoint[]): ScreenPoint[] {
  if (segment.length >= 2) segments.push(segment);
  return [];
}

export function screenToWorld(viewport: GraphViewport, x: number, y: number): ScreenPoint {
  return {
    x: viewport.cx + (x - viewport.width / 2) / viewport.scale,
    y: viewport.cy - (y - viewport.height / 2) / viewport.scale
  };
}

export function worldToScreen(viewport: GraphViewport, x: number, y: number): ScreenPoint {
  return {
    x: viewport.width / 2 + (x - viewport.cx) * viewport.scale,
    y: viewport.height / 2 - (y - viewport.cy) * viewport.scale
  };
}

export function isVisibleBoundaryPoint(point: ScreenPoint, viewport: GraphViewport): boolean {
  return point.x >= -viewport.width && point.x <= viewport.width * 2 && point.y >= -viewport.height && point.y <= viewport.height * 2;
}

export function screenDistance(a: ScreenPoint, b: ScreenPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
