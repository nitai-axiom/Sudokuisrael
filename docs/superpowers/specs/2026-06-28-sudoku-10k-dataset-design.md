# Design: the 10,000-puzzle Sudoku dataset build

**Date:** 2026-06-28
**Status:** Approved (ready for implementation plan)
**Output artifact:** `sudoku_10000.json`

---

## 1. Goal

Build a graded dataset of 10,000 unique, quality-gated Sudoku puzzles across four
tiers, written to `sudoku_10000.json` in a schema that is drop-in compatible with
the existing `upload_to_supabase.py` uploader and the `web/` puzzle loader.

Tier split (approved):

| Tier | Count |
|---|---|
| very_easy | 2,000 |
| easy | 3,000 |
| medium | 3,000 |
| hard | 2,000 |
| **total** | **10,000** |

---

## 2. Architecture — two trust zones, three stages

The core principle: **untrusted tools propose, the trusted host disposes.** Nothing
produced by the untrusted tools is believed until the trusted host independently
re-verifies it.

- **Trusted zone = the host Mac.** qqwing (installed via Homebrew, distro-signed)
  generates the lower tiers and is the independent re-validation gate.
- **Untrusted zone = a Docker container run with `--network none`.** The two
  untrusted JARs (HoDoKu, Sudoku Explainer / serate) are quarantined here. The
  container has no network, the JARs are mounted read-only, and **only plain text
  files** cross the boundary. Even a hostile JAR cannot phone home or alter the host.

**qqwing is NOT in the container.** It is the trusted tool; placing it in the
untrusted zone would defeat the trust split. It runs on the host on both ends.

### Where each stage runs

| Stage | Tool | Trust | Where |
|---|---|---|---|
| 1 — generate very_easy / easy / medium | qqwing (Homebrew) | trusted | host |
| 1 — generate hard | HoDoKu (JAR) | untrusted | container (`--network none`) |
| 2 — rate hard | serate / SE (JAR) | untrusted | container (`--network none`) |
| 3 — validate + fun-score + dedupe + assemble | qqwing (Homebrew) | trusted | host |

### Data flow

```
HOST:       qqwing → very_easy/easy/medium text  ─┐
CONTAINER:  HoDoKu → hard text → serate → ER nums ─┤  (text files only cross boundary)
HOST:       qqwing validate → fun-score → dedupe → sudoku_10000.json
```

---

## 3. Components

### A. Container image (`sandbox/Dockerfile`)
- Debian base + Java runtime only.
- HoDoKu + SE JARs copied in, used read-only. **No qqwing inside.**
- Built once. Run with `--network none` and the checkpoint dir bind-mounted for
  text I/O only.

### B. Stage 1 — Generate

- **very_easy / easy / medium** (host, qqwing): `qqwing --generate`,
  `--symmetry rotate180`, mapping qqwing's difficulty tiers → our tiers. Unique
  solution and 180° symmetry hold by construction. Output: one text file of puzzle
  strings per tier.
- **hard** (container, HoDoKu): batch mode, technique-targeted so the puzzle is
  *required* to use an X-wing / swordfish / wing / subset — making "hard" a real
  claim rather than "the generator gave up." Output: `hard.raw.txt`.

### C. Stage 2 — Rate the hard tier (container, serate / SE)
- Run serate over the hard puzzles to attach the community-standard **ER (Sudoku
  Explainer) rating** number.
- Keep only **ER 3.4–5.0** (hardest required technique is X-wing / swordfish /
  XY-wing / subset; no chains). Drop anything > 5.0 (needs chains) or < 3.4
  (actually easier than the hard tier).
- Output: `hard.rated.txt` (puzzle string + ER number).

### D. Stage 3 — Validate & assemble (host, trusted)

**The gate (mandatory, every hard puzzle):**
- Re-check with `qqwing --count-solutions` to confirm exactly one solution and
  independently re-derive it.
- **Timeout guard**: `count-solutions` hangs on under-constrained grids; bound it
  per puzzle and reject on timeout.

**Lower tiers:**
- **Fun-score**: reject any puzzle that requires guessing (score 0 = reject);
  otherwise assign a 0–5 technique-variety score.

**All tiers:**
- **Quality gates**: unique solution, ≥17 clues (≥18 for symmetric), 180° symmetry.
- **Dedupe** on the canonical puzzle string (catches the same puzzle in disguise).
- Merge, label into the 4 tiers, sort, write `sudoku_10000.json`.

---

## 4. Record schema

Extends the existing `puzzles.json` schema (drop-in compatible) with two fields.

```json
{
  "puzzle": "81-char string",
  "solution": "81-char string",
  "difficulty": "very_easy | easy | medium | hard",
  "techniques": ["x_wing", "..."],
  "givens": 24,
  "er_rating": 4.2,
  "fun_score": 3,
  "generated_at": "ISO-8601"
}
```

- `er_rating`: number for the hard tier; `null` for lower tiers.
- `fun_score`: 0–5 for lower tiers; `null` for hard.

---

## 5. Reliability — the gotchas, handled

- **Per-tier checkpointing.** Each tier writes incrementally to its own file; a
  crash resumes from the last checkpoint, not from zero. No monolithic job.
- **Timeout guard** on `count-solutions` (see Stage 3).
- **Over-generation.** Dedupe + gate rejection shrink each batch, so the driver
  keeps generating a tier until it has enough *survivors*, not enough *attempts*.

---

## 6. Security ritual (one-time, before any run)

1. Download HoDoKu + SE JARs on the host.
2. **Verify their published SHA-256 hashes.**
3. Only then bake them read-only into the container image.

qqwing stays the Homebrew-installed (distro-signed) binary on the host. It is never
sourced from inside the untrusted zone.

---

## 7. Testing

- **Validator unit tests** (host, engine-agnostic): uniqueness gate, symmetry check,
  clue floor, dedupe — using known-good and known-bad fixtures.
- **Smoke run**: `--count 20` per tier, end-to-end through all three stages, before
  committing to the full 10k run.

---

## 8. Open risk — flagged, not guessed

**serate availability.** Sudoku Explainer's `serate` mode is the standard ER tool,
but the JAR and its published hash can be finicky to source. If sourcing it cleanly
proves hard, the fallback is to rate hard puzzles by HoDoKu's own difficulty score
and tag `er_rating` as approximate (with a flag in the record). This will be
surfaced for a decision *before* it becomes a blocker — not silently worked around.

---

## 9. Decisions locked during brainstorming

| Decision | Choice |
|---|---|
| Generation engine | Full qqwing / HoDoKu / SE pipeline (not the existing Rust generator) |
| Sandbox realization | Docker container, `--network none` (untrusted JARs only) |
| qqwing placement | Host (trusted) — both generate lower tiers and validate |
| Tier split | 2,000 / 3,000 / 3,000 / 2,000 (very_easy / easy / medium / hard) |
| Hard-tier ER range | 3.4–5.0 (X-wing / swordfish / wings / subsets; no chains) |
| Record schema | Extend existing schema + `er_rating` + `fun_score` |
