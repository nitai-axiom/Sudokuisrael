// Loads the bundled puzzle dataset (../../puzzles.json at the repo root) and
// exposes helpers to pick a puzzle by difficulty. ONE dataset, imported — not
// copied. Supabase replaces this in a later phase.
import data from "@puzzles";

export type Difficulty = "easy" | "medium" | "hard";

export interface Puzzle {
  puzzle: string;   // 81-char givens ('.'/0 = empty)
  solution: string; // 81-char full solution
  difficulty: Difficulty;
  givens: number;
}

const puzzles = data as Puzzle[];

export const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: "קל",
  medium: "בינוני",
  hard: "קשה",
};

export function byDifficulty(d: Difficulty): Puzzle[] {
  return puzzles.filter((p) => p.difficulty === d);
}

/** Deterministic first puzzle — used for the initial render (no hydration mismatch). */
export function firstPuzzle(d: Difficulty): Puzzle {
  return byDifficulty(d)[0];
}

/** Random puzzle of a difficulty — only called on user action (New game / tab switch). */
export function randomPuzzle(d: Difficulty): Puzzle {
  const list = byDifficulty(d);
  return list[Math.floor(Math.random() * list.length)];
}
