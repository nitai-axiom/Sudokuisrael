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

The host orchestrates everything and runs the pure-TS validation/assembly logic and
the Rust grader, but the two external sudoku tools each run in their own container.
Trust is about *provenance*, not host-vs-container:

- **Trusted qqwing container.** Debian image that `apt`-installs the distro-signed
  `qqwing` package (network used **only at build time**; run with `--network none`).
  Generates the lower tiers and is the independent re-validation gate. qqwing is
  trusted because it is the distro-signed apt binary built from a known Dockerfile —
  Homebrew has no qqwing formula on macOS, so this container is how we obtain the
  apt-signed binary the plan always intended.
- **Untrusted JAR container.** Debian + Java runtime, run with `--network none`. The
  two untrusted JARs (HoDoKu, Sudoku Explainer / serate) are quarantined here,
  mounted **read-only**. **Only plain text files** cross any boundary. Even a hostile
  JAR cannot phone home or alter the host.

The host itself runs: the TS pipeline (dedupe, symmetry check, clue-floor check,
schema assembly, the driver) and the Rust technique grader (compiled from your own
source → maximally trusted). The host never runs the untrusted JARs directly.

### Where each stage runs

| Stage | Tool | Trust | Where |
|---|---|---|---|
| 1 — generate very_easy / easy / medium | qqwing (apt) | trusted | trusted qqwing container (`--network none`) |
| 1 — generate hard | HoDoKu (JAR) | untrusted | untrusted JAR container (`--network none`) |
| 2 — rate hard | serate / SE (JAR) | untrusted | untrusted JAR container (`--network none`) |
| 3 — validation gate (count-solutions) | qqwing (apt) | trusted | trusted qqwing container (`--network none`) |
| 3 — fun-score / techniques (lower tiers) | Rust grader | trusted | host |
| 3 — dedupe / symmetry / clue-floor / assemble | TS pipeline | trusted | host |

### Data flow

```
qqwing container → very_easy/easy/medium text  ─┐
JAR container:    HoDoKu → hard text → serate → ER nums ─┤ (text files only cross boundary)
HOST (TS + Rust grader + qqwing-container gate) → validate → fun-score → dedupe → sudoku_10000.json
```

---

## 3. Components

### A0. Host language & tooling
- The host pipeline is **TypeScript**, run with Node's built-in test runner and
  type-stripping (matches the repo's existing `npm test`, zero new deps). It shells
  out to `docker run` and the Rust grader via `node:child_process`, and uses
  `node:crypto` for hash verification and `node:fs` for checkpoints.
- The Rust **technique grader** is a new `grade` subcommand added to the existing
  `sudoku-generator` binary (reuses its `StrategySolver` + `strategy_name` map). It
  reads an 81-char puzzle on stdin and prints the required techniques + difficulty.

### A. Container images (`sandbox/`)
- **`sandbox/qqwing.Dockerfile`** — Debian + `apt install qqwing`. Network used at
  build only; run with `--network none`. No JARs.
- **`sandbox/jars.Dockerfile`** — Debian + Java runtime only. **No JARs baked in, no
  qqwing.** The untrusted JARs enter at **run time** via a **read-only bind mount**
  from the host (see §6) — never downloaded by the container (no network) and never
  written by it. The checkpoint dir is bind-mounted read-write for text I/O only.
- Run invocation shapes:
  - `docker run --network none -v $PWD/<checkpoint>:/work qqwing-trusted qqwing ...`
  - `docker run --network none -v $PWD/sandbox/jars:/opt/jars:ro -v $PWD/<checkpoint>:/work sudoku-jars ...`

### B. Stage 1 — Generate

- **very_easy / easy / medium** (trusted qqwing container): `qqwing --generate`,
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
- Re-check with `qqwing --count-solutions` (in the trusted qqwing container) to
  confirm exactly one solution and independently re-derive it.
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
2. **Verify their published SHA-256 hashes** on the host.
3. Place the verified JARs in `sandbox/jars/`. The container reads them via a
   **read-only bind mount** at run time (Option A). Nothing is baked into the image;
   the host stays the single verified source and the container can neither fetch nor
   alter the JARs.

**Why both the hash and the container** (they defend different things):
- SHA-256 proves *authenticity* — the JAR is byte-for-byte what the author published
  (protects against a tampered/corrupted download). It says nothing about whether the
  authentic code is safe to run.
- The container provides *containment* — even the genuine, hash-verified JAR is
  unaudited third-party code; `--network none` + read-only mounts cap what it can do
  at runtime (no network, no write access to host files).

qqwing is the distro-signed apt binary inside its own trusted container (Homebrew has
no qqwing on macOS). Its image is built from a committed Dockerfile, network is used
only at build, and it runs `--network none`. It is never sourced from inside the
untrusted JAR container.

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
| Sandbox realization | Docker, `--network none`; two images (trusted qqwing, untrusted JARs) |
| qqwing acquisition | Trusted Debian container, distro-signed apt package (no Homebrew formula on macOS) |
| qqwing role | Lower-tier generation + the count-solutions validation gate |
| Host language | TypeScript (Node built-in test runner + type-stripping; zero new deps) |
| Fun-score / techniques | Reuse existing Rust solver as a host-side `grade` subcommand |
| JAR delivery | Read-only bind mount at run time (host = single verified source) |
| Tier split | 2,000 / 3,000 / 3,000 / 2,000 (very_easy / easy / medium / hard) |
| Hard-tier ER range | 3.4–5.0 (X-wing / swordfish / wings / subsets; no chains) |
| Record schema | Extend existing schema + `er_rating` + `fun_score` |
| Build sequencing | Two plans: Plan 1 host-only lower tiers + foundation; Plan 2 hard-tier sandbox |
