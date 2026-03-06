/**
 * Perspective transform for Sudoku grid extraction.
 * Maps a quadrilateral (detected grid corners) to a square output image.
 * Pure functions — no external dependencies.
 */

import type { Point } from './types';

/**
 * Compute a 3x3 homography matrix that maps 4 source points to 4 destination points.
 * Uses direct linear transform (DLT) with 8-equation system solved via Gaussian elimination.
 *
 * Returns a flat 9-element array representing the 3x3 matrix in row-major order.
 */
export function computeHomography(src: Point[], dst: Point[]): number[] {
  // Build 8x9 matrix for the system Ah = 0
  // Each point pair gives 2 equations:
  //   -x*h0 - y*h1 - h2 + x'*x*h6 + x'*y*h7 + x'*h8 = -x'  ... wait
  // Standard DLT: solve for h1..h8 (h9=1) via 8x8 system
  //
  // For each (x,y) -> (x',y'):
  //   x' = (h0*x + h1*y + h2) / (h6*x + h7*y + 1)
  //   y' = (h3*x + h4*y + h5) / (h6*x + h7*y + 1)
  //
  // Rearranged:
  //   h0*x + h1*y + h2 - h6*x*x' - h7*y*x' = x'
  //   h3*x + h4*y + h5 - h6*x*y' - h7*y*y' = y'

  const A: number[][] = [];
  const b: number[] = [];

  for (let i = 0; i < 4; i++) {
    const sx = src[i].x, sy = src[i].y;
    const dx = dst[i].x, dy = dst[i].y;

    A.push([sx, sy, 1, 0, 0, 0, -sx * dx, -sy * dx]);
    b.push(dx);

    A.push([0, 0, 0, sx, sy, 1, -sx * dy, -sy * dy]);
    b.push(dy);
  }

  // Solve 8x8 system via Gaussian elimination with partial pivoting
  const n = 8;
  // Augment matrix [A | b]
  const aug: number[][] = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    // Partial pivoting
    let maxVal = Math.abs(aug[col][col]);
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      const val = Math.abs(aug[row][col]);
      if (val > maxVal) {
        maxVal = val;
        maxRow = row;
      }
    }
    if (maxRow !== col) {
      [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];
    }

    const pivot = aug[col][col];
    if (Math.abs(pivot) < 1e-10) {
      throw new Error('Homography: singular matrix — points may be collinear');
    }

    // Eliminate below
    for (let row = col + 1; row < n; row++) {
      const factor = aug[row][col] / pivot;
      for (let j = col; j <= n; j++) {
        aug[row][j] -= factor * aug[col][j];
      }
    }
  }

  // Back-substitution
  const h = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let sum = aug[i][n];
    for (let j = i + 1; j < n; j++) {
      sum -= aug[i][j] * h[j];
    }
    h[i] = sum / aug[i][i];
  }

  // Return 3x3 matrix [h0..h7, 1]
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

/**
 * Compute the inverse of a 3x3 homography matrix.
 * Needed for inverse warping (mapping output pixels back to source).
 */
export function invertHomography(H: number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = H;

  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-10) {
    throw new Error('Homography: cannot invert — determinant is zero');
  }

  const invDet = 1 / det;

  return [
    (e * i - f * h) * invDet,
    (c * h - b * i) * invDet,
    (b * f - c * e) * invDet,
    (f * g - d * i) * invDet,
    (a * i - c * g) * invDet,
    (c * d - a * f) * invDet,
    (d * h - e * g) * invDet,
    (b * g - a * h) * invDet,
    (a * e - b * d) * invDet,
  ];
}

/**
 * Warp a grayscale image using a homography matrix.
 * Uses inverse mapping with bilinear interpolation for smooth output.
 *
 * @param image   Source grayscale image
 * @param w       Source width
 * @param h       Source height
 * @param H       3x3 homography (src → dst)
 * @param outSize Output square dimension
 * @returns       Warped grayscale image (outSize × outSize)
 */
export function warpPerspective(
  image: Uint8Array,
  w: number,
  h: number,
  H: number[],
  outSize: number
): Uint8Array {
  const out = new Uint8Array(outSize * outSize);
  const Hinv = invertHomography(H);

  for (let dy = 0; dy < outSize; dy++) {
    for (let dx = 0; dx < outSize; dx++) {
      // Map destination pixel back to source using inverse homography
      const denom = Hinv[6] * dx + Hinv[7] * dy + Hinv[8];
      const sx = (Hinv[0] * dx + Hinv[1] * dy + Hinv[2]) / denom;
      const sy = (Hinv[3] * dx + Hinv[4] * dy + Hinv[5]) / denom;

      // Bilinear interpolation
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = x0 + 1;
      const y1 = y0 + 1;

      if (x0 < 0 || y0 < 0 || x1 >= w || y1 >= h) {
        out[dy * outSize + dx] = 255; // white for out-of-bounds
        continue;
      }

      const fx = sx - x0;
      const fy = sy - y0;

      const v00 = image[y0 * w + x0];
      const v10 = image[y0 * w + x1];
      const v01 = image[y1 * w + x0];
      const v11 = image[y1 * w + x1];

      const value =
        v00 * (1 - fx) * (1 - fy) +
        v10 * fx * (1 - fy) +
        v01 * (1 - fx) * fy +
        v11 * fx * fy;

      out[dy * outSize + dx] = (value + 0.5) | 0;
    }
  }

  return out;
}
