import type { ScreenPoint, ScreenSegment } from "./sampling-types.js";

export function predicateContourSegments(corners: boolean[][], cellSize: number, columns: number, rows: number): ScreenSegment[] {
  const segments: ScreenSegment[] = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const topLeft = corners[row][column];
      const topRight = corners[row][column + 1];
      const bottomRight = corners[row + 1][column + 1];
      const bottomLeft = corners[row + 1][column];
      const points: ScreenPoint[] = [];
      const x = column * cellSize;
      const y = row * cellSize;

      if (topLeft !== topRight) points.push({ x: x + cellSize / 2, y });
      if (topRight !== bottomRight) points.push({ x: x + cellSize, y: y + cellSize / 2 });
      if (bottomLeft !== bottomRight) points.push({ x: x + cellSize / 2, y: y + cellSize });
      if (topLeft !== bottomLeft) points.push({ x, y: y + cellSize / 2 });

      if (points.length === 2) {
        segments.push({ from: points[0], to: points[1] });
      } else if (points.length === 4) {
        segments.push({ from: points[0], to: points[1] }, { from: points[2], to: points[3] });
      }
    }
  }
  return segments;
}

export function interpolatedContourSegments(values: (number | null)[][], cellSize: number, columns: number, rows: number): ScreenSegment[] {
  const segments: ScreenSegment[] = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const topLeft = values[row][column];
      const topRight = values[row][column + 1];
      const bottomRight = values[row + 1][column + 1];
      const bottomLeft = values[row + 1][column];
      if (topLeft === null || topRight === null || bottomRight === null || bottomLeft === null) continue;

      const x = column * cellSize;
      const y = row * cellSize;
      const points: ScreenPoint[] = [];
      const top = zeroCrossing(topLeft, topRight);
      const right = zeroCrossing(topRight, bottomRight);
      const bottom = zeroCrossing(bottomLeft, bottomRight);
      const left = zeroCrossing(topLeft, bottomLeft);

      if (top !== null) points.push({ x: x + top * cellSize, y });
      if (right !== null) points.push({ x: x + cellSize, y: y + right * cellSize });
      if (bottom !== null) points.push({ x: x + bottom * cellSize, y: y + cellSize });
      if (left !== null) points.push({ x, y: y + left * cellSize });

      if (points.length === 2) {
        segments.push({ from: points[0], to: points[1] });
      } else if (points.length === 4) {
        segments.push({ from: points[0], to: points[1] }, { from: points[2], to: points[3] });
      }
    }
  }
  return segments;
}

function zeroCrossing(a: number, b: number): number | null {
  if (a === 0 && b === 0) return null;
  if (a === 0) return 0;
  if (b === 0) return 1;
  if ((a < 0) === (b < 0)) return null;
  return Math.max(0, Math.min(1, a / (a - b)));
}
