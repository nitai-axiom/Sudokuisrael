# Sudokuisrael

A full-stack Hebrew Sudoku platform built for Israeli users, targeting production on Next.js + Supabase.

---

## Pipeline Overview

### 1. Puzzle Generation (Rust)
`sudoku-generator/` is a CLI tool written in Rust. It generates valid Sudoku puzzles, grades them by difficulty (easy / medium / hard) using logical technique detection, and outputs structured JSON:
```json
{ "puzzle": "530070000...", "solution": "534678912...", "difficulty": "easy", "techniques": ["naked_single"] }
```

### 2. Upload to Supabase
`upload_to_supabase.py` reads the generated `puzzles.json` and bulk-inserts records into a Supabase (PostgreSQL) table, ready to be served to the client.

### 3. Client-Side Game Engine (TypeScript)
`lib/sudoku-engine.ts` is a zero-dependency TypeScript class that powers the live game:
- Tracks user input against the solution
- 3-strike mistake system with game-over detection
- Pencil notes with auto-cleanup on digit placement
- Detects completed rows, columns, and boxes
- Smart hint engine with 4 strategies (Naked Single → Hidden Single → Locked Candidates → Naked Pair), all with Hebrew explanations

Drop `sudoku-engine.ts` directly into any Next.js project — no install required.
