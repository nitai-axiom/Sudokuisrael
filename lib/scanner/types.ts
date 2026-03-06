/** Shared types for the Sudoku OCR scanner pipeline */

export interface Point {
  x: number;
  y: number;
}

export interface CellResult {
  digit: number;       // 0 = empty, 1-9 = recognized digit
  confidence: number;  // 0-1
}

export interface GridExtractionResult {
  cellImages: Uint8Array[];  // 81 cell images (28x28 grayscale)
  emptyCells: boolean[];     // true if cell appears empty
}

export interface ScanResult {
  grid: number[][];          // 9x9, 0 = empty
  confidences: number[][];   // 9x9, per-cell confidence
  solution: number[][] | null;
}

export type ProgressCallback = (stage: string, pct: number) => void;
