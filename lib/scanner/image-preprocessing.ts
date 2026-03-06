/**
 * Image preprocessing for Sudoku OCR scanner.
 * Pure functions — no external dependencies.
 */

/**
 * Convert RGBA ImageData to grayscale using green channel extraction.
 * Green channel has best contrast for printed digits and lowest noise.
 */
export function grayscale(imageData: ImageData): Uint8Array {
  const { data, width, height } = imageData;
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < gray.length; i++) {
    gray[i] = data[i * 4 + 1]; // green channel
  }
  return gray;
}

/**
 * Box blur (mean filter) for noise reduction.
 * Uses integral image for O(1) per-pixel regardless of radius.
 */
export function boxBlur(
  gray: Uint8Array,
  w: number,
  h: number,
  radius: number
): Uint8Array {
  // Build integral image (use Float64 to avoid overflow on large images)
  const integral = new Float64Array((w + 1) * (h + 1));
  const iw = w + 1;

  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    for (let x = 0; x < w; x++) {
      rowSum += gray[y * w + x];
      integral[(y + 1) * iw + (x + 1)] =
        rowSum + integral[y * iw + (x + 1)];
    }
  }

  const out = new Uint8Array(w * h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - radius);
      const y0 = Math.max(0, y - radius);
      const x1 = Math.min(w - 1, x + radius);
      const y1 = Math.min(h - 1, y + radius);

      const area = (x1 - x0 + 1) * (y1 - y0 + 1);

      const sum =
        integral[(y1 + 1) * iw + (x1 + 1)] -
        integral[y0 * iw + (x1 + 1)] -
        integral[(y1 + 1) * iw + x0] +
        integral[y0 * iw + x0];

      out[y * w + x] = (sum / area + 0.5) | 0;
    }
  }

  return out;
}

/**
 * Adaptive thresholding using local mean.
 * For each pixel: if pixel < localMean - constant → black (0), else white (255).
 * Good for photos with uneven lighting.
 */
export function adaptiveThreshold(
  gray: Uint8Array,
  w: number,
  h: number,
  windowSize = 15,
  constant = 10
): Uint8Array {
  const radius = (windowSize - 1) >> 1;
  const blurred = boxBlur(gray, w, h, radius);
  const out = new Uint8Array(w * h);

  for (let i = 0; i < out.length; i++) {
    out[i] = gray[i] < blurred[i] - constant ? 0 : 255;
  }

  return out;
}

/**
 * Detect if an image is a screenshot (vs camera photo).
 * Screenshots have very low noise variance and sharp pixel transitions.
 */
export function isScreenshot(imageData: ImageData): boolean {
  const { data, width, height } = imageData;

  // Sample a grid of pixels and measure local variance
  const step = Math.max(1, Math.floor(Math.min(width, height) / 50));
  let totalVariance = 0;
  let samples = 0;

  for (let y = step; y < height - step; y += step) {
    for (let x = step; x < width - step; x += step) {
      const idx = (y * width + x) * 4;
      const center = data[idx + 1]; // green channel

      // Compare with 4 neighbors
      const neighbors = [
        data[((y - 1) * width + x) * 4 + 1],
        data[((y + 1) * width + x) * 4 + 1],
        data[(y * width + x - 1) * 4 + 1],
        data[(y * width + x + 1) * 4 + 1],
      ];

      let variance = 0;
      for (const n of neighbors) {
        const diff = center - n;
        variance += diff * diff;
      }
      totalVariance += variance / 4;
      samples++;
    }
  }

  const avgVariance = totalVariance / samples;

  // Screenshots typically have very low inter-pixel variance
  // and lots of perfectly flat regions. Threshold determined empirically.
  return avgVariance < 50;
}

/**
 * Global threshold using Otsu's method.
 * Better than adaptive for screenshots (uniform lighting, no gradients).
 */
export function globalThreshold(gray: Uint8Array): Uint8Array {
  // Build histogram
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) {
    hist[gray[i]]++;
  }

  const total = gray.length;

  // Otsu's method: find threshold that maximizes between-class variance
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * hist[i];

  let sumBg = 0;
  let weightBg = 0;
  let maxVariance = 0;
  let bestThreshold = 0;

  for (let t = 0; t < 256; t++) {
    weightBg += hist[t];
    if (weightBg === 0) continue;

    const weightFg = total - weightBg;
    if (weightFg === 0) break;

    sumBg += t * hist[t];

    const meanBg = sumBg / weightBg;
    const meanFg = (sumAll - sumBg) / weightFg;

    const diff = meanBg - meanFg;
    const variance = weightBg * weightFg * diff * diff;

    if (variance > maxVariance) {
      maxVariance = variance;
      bestThreshold = t;
    }
  }

  const out = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) {
    out[i] = gray[i] > bestThreshold ? 255 : 0;
  }
  return out;
}

/**
 * Smart preprocess: auto-detects screenshot vs photo, applies appropriate thresholding.
 * Returns binary image (0 = ink/dark, 255 = paper/light).
 */
export function preprocess(imageData: ImageData): {
  binary: Uint8Array;
  width: number;
  height: number;
  wasScreenshot: boolean;
} {
  const { width, height } = imageData;
  const gray = grayscale(imageData);
  const screenshot = isScreenshot(imageData);

  let binary: Uint8Array;
  if (screenshot) {
    binary = globalThreshold(gray);
  } else {
    // For photos: blur first to reduce noise, then adaptive threshold
    const denoised = boxBlur(gray, width, height, 1);
    binary = adaptiveThreshold(denoised, width, height, 25, 12);
  }

  return { binary, width, height, wasScreenshot: screenshot };
}
