import type { GraphViewport } from "./sampling-types.js";

export type SamplingCellKind = "region" | "contour";

type SamplingQuality = {
  worldStep: number;
  minCellSize: number;
  maxCellSize: number;
  maxCells: number;
};

const samplingQuality: Record<SamplingCellKind, { idle: SamplingQuality; interactive: SamplingQuality }> = {
  region: {
    idle: { worldStep: 1 / 22, minCellSize: 3, maxCellSize: 7, maxCells: 70_000 },
    interactive: { worldStep: 1 / 9, minCellSize: 8, maxCellSize: 14, maxCells: 28_000 }
  },
  contour: {
    idle: { worldStep: 1 / 26, minCellSize: 3, maxCellSize: 6, maxCells: 85_000 },
    interactive: { worldStep: 1 / 10, minCellSize: 8, maxCellSize: 13, maxCells: 32_000 }
  }
};

export function samplingCellSize(viewport: GraphViewport, kind: SamplingCellKind): number {
  const quality = samplingQuality[kind][viewport.interactive ? "interactive" : "idle"];
  const desired = clamp(viewport.scale * quality.worldStep, quality.minCellSize, quality.maxCellSize);
  const budgeted = Math.sqrt((viewport.width * viewport.height) / quality.maxCells);
  return Math.ceil(Math.max(desired, budgeted));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
