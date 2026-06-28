import type { NextConfig } from "next";
import path from "path";

// The Next app lives in web/, but the game engine (../lib/sudoku-engine.ts) and
// puzzle data (../puzzles.json) live at the repo root — the whole point of
// Phase 3 is ONE engine, imported, not copied. Pointing the workspace root at
// the repo root lets Turbopack resolve those parent imports cleanly (and
// silences the multi-lockfile root warning).
const repoRoot = path.join(process.cwd(), "..");

const nextConfig: NextConfig = {
  turbopack: { root: repoRoot },
  outputFileTracingRoot: repoRoot,
};

export default nextConfig;
