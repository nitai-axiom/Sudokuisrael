use std::io::Write as IoWrite;
use clap::Parser;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sudoku::Sudoku;
use sudoku::strategy::{StrategySolver, Strategy};

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

#[derive(Parser, Debug)]
#[command(
    name = "sudoku-generator",
    about = "Generates technique-graded sudoku puzzles and outputs JSON"
)]
struct Args {
    /// Number of puzzles to generate per difficulty tier (or total if --difficulty is set)
    #[arg(short, long, default_value_t = 100)]
    count: usize,

    /// Restrict output to a single difficulty tier: easy | medium | hard
    #[arg(short, long)]
    difficulty: Option<String>,

    /// Write output JSON to this file (default: stdout)
    #[arg(short, long)]
    output: Option<String>,
}

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize)]
struct PuzzleRecord {
    puzzle: String,
    solution: String,
    difficulty: String,
    techniques: Vec<String>,
    givens: usize,
    generated_at: String,
}

// ---------------------------------------------------------------------------
// Difficulty / technique mapping
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Difficulty {
    Easy,
    Medium,
    Hard,
}

impl Difficulty {
    fn as_str(self) -> &'static str {
        match self {
            Difficulty::Easy   => "easy",
            Difficulty::Medium => "medium",
            Difficulty::Hard   => "hard",
        }
    }

    fn from_str(s: &str) -> Option<Self> {
        match s {
            "easy"   => Some(Difficulty::Easy),
            "medium" => Some(Difficulty::Medium),
            "hard"   => Some(Difficulty::Hard),
            _ => None,
        }
    }
}

/// Map a `Strategy` variant to a stable snake_case name for JSON output.
fn strategy_name(s: &Strategy) -> &'static str {
    match s {
        Strategy::NakedSingles     => "naked_singles",
        Strategy::HiddenSingles    => "hidden_singles",
        Strategy::LockedCandidates => "locked_candidates",
        Strategy::NakedPairs       => "naked_pairs",
        Strategy::NakedTriples     => "naked_triples",
        Strategy::NakedQuads       => "naked_quads",
        Strategy::HiddenPairs      => "hidden_pairs",
        Strategy::HiddenTriples    => "hidden_triples",
        Strategy::HiddenQuads      => "hidden_quads",
        Strategy::XWing            => "x_wing",
        Strategy::Swordfish        => "swordfish",
        Strategy::Jellyfish        => "jellyfish",
        // The enum is non-exhaustive; treat unknowns gracefully.
        _ => "unknown",
    }
}

/// All strategies available in sudoku v0.7, in order of increasing difficulty.
fn all_strategies() -> Vec<Strategy> {
    vec![
        Strategy::NakedSingles,
        Strategy::HiddenSingles,
        Strategy::LockedCandidates,
        Strategy::NakedPairs,
        Strategy::HiddenPairs,
        Strategy::NakedTriples,
        Strategy::HiddenTriples,
        Strategy::NakedQuads,
        Strategy::HiddenQuads,
        Strategy::XWing,
        Strategy::Swordfish,
        Strategy::Jellyfish,
    ]
}

/// Grade a solved puzzle given the deductions that were applied.
fn grade_techniques(deductions: &sudoku::strategy::deduction::Deductions) -> (Difficulty, Vec<String>) {
    let mut used: Vec<String> = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for deduction in deductions.iter() {
        let s = deduction.strategy();
        let name = strategy_name(&s);
        if seen.insert(name) {
            used.push(name.to_string());
        }
    }

    let difficulty = classify_difficulty(&seen);
    (difficulty, used)
}

/// Determine difficulty from the set of technique names used.
fn classify_difficulty(used: &std::collections::HashSet<&'static str>) -> Difficulty {
    // Hard: fish patterns (X-Wing, Swordfish, Jellyfish)
    if used.contains("x_wing") || used.contains("swordfish") || used.contains("jellyfish") {
        return Difficulty::Hard;
    }

    // Medium: locked candidates or any subsets (pairs/triples/quads)
    if used.contains("locked_candidates")
        || used.contains("naked_pairs")
        || used.contains("naked_triples")
        || used.contains("naked_quads")
        || used.contains("hidden_pairs")
        || used.contains("hidden_triples")
        || used.contains("hidden_quads")
    {
        return Difficulty::Medium;
    }

    // Easy: only naked/hidden singles
    Difficulty::Easy
}

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

/// Try to generate one puzzle of the given difficulty.
/// Returns `None` if the generated puzzle doesn't match the target difficulty
/// or can't be solved purely by strategy (requires backtracking).
fn try_generate(target: Option<Difficulty>) -> Option<PuzzleRecord> {
    // Generate a random puzzle with a unique solution.
    let puzzle = Sudoku::generate_unique();

    // Attempt to solve with our allowed strategies.
    let solver = StrategySolver::from_sudoku(puzzle);
    let result = solver.solve(&all_strategies());

    let (solved, deductions) = match result {
        Ok(pair) => pair,
        Err(_) => return None, // couldn't solve without backtracking → reject
    };

    // Verify the strategy solver actually found a complete solution.
    let solution_bytes = solved.to_bytes();
    if solution_bytes.iter().any(|&b| b == 0) {
        return None; // incomplete — strategies weren't enough
    }

    let (difficulty, mut techniques) = grade_techniques(&deductions);

    // Filter by requested difficulty tier.
    if let Some(target_diff) = target {
        if difficulty != target_diff {
            return None;
        }
    }

    // Build puzzle/solution strings (use '0' for empty cells).
    let puzzle_str: String = puzzle
        .to_bytes()
        .iter()
        .map(|&b| if b == 0 { '0' } else { (b'0' + b) as char })
        .collect();

    let solution_str: String = solution_bytes
        .iter()
        .map(|&b| (b'0' + b) as char)
        .collect();

    // Ensure at least one technique is listed.
    if techniques.is_empty() {
        techniques.push("naked_singles".to_string());
    }

    let givens = puzzle_str.chars().filter(|&c| c != '0').count();

    Some(PuzzleRecord {
        puzzle: puzzle_str,
        solution: solution_str,
        difficulty: difficulty.as_str().to_string(),
        techniques,
        givens,
        generated_at: Utc::now().to_rfc3339(),
    })
}

/// Generate `count` puzzles for a single difficulty tier.
fn generate_for_tier(target: Option<Difficulty>, count: usize, label: &str) -> Vec<PuzzleRecord> {
    let mut results = Vec::with_capacity(count);
    let mut attempts = 0usize;

    while results.len() < count {
        attempts += 1;
        if let Some(record) = try_generate(target) {
            results.push(record);
            let done = results.len();
            eprint!("\r  {label}: {done}/{count} (attempts: {attempts})");
            let _ = std::io::stderr().flush();
        }
        // Safety valve.
        if attempts > count * 10_000 {
            eprintln!(
                "\nWARNING: gave up after {attempts} attempts — only {} puzzles generated for {label}",
                results.len()
            );
            break;
        }
    }

    eprintln!(); // newline after progress line
    results
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

fn main() {
    let args = Args::parse();

    // Validate --difficulty if provided.
    let target_difficulty: Option<Difficulty> = if let Some(ref s) = args.difficulty {
        match Difficulty::from_str(s) {
            Some(d) => Some(d),
            None => {
                eprintln!("ERROR: unknown difficulty '{}'. Use: easy | medium | hard", s);
                std::process::exit(1);
            }
        }
    } else {
        None
    };

    let mut all_puzzles: Vec<PuzzleRecord> = Vec::new();

    if let Some(diff) = target_difficulty {
        // Single tier mode.
        eprintln!("Generating {} {} puzzles…", args.count, diff.as_str());
        let mut batch = generate_for_tier(Some(diff), args.count, diff.as_str());
        all_puzzles.append(&mut batch);
    } else {
        // All tiers mode — generate `count` puzzles per tier.
        for &diff in &[Difficulty::Easy, Difficulty::Medium, Difficulty::Hard] {
            eprintln!("Generating {} {} puzzles…", args.count, diff.as_str());
            let mut batch = generate_for_tier(Some(diff), args.count, diff.as_str());
            all_puzzles.append(&mut batch);
        }
    }

    eprintln!("Total puzzles generated: {}", all_puzzles.len());

    // Serialize to JSON.
    let json = serde_json::to_string_pretty(&all_puzzles).expect("JSON serialization failed");

    match args.output {
        Some(ref path) => {
            std::fs::write(path, &json).unwrap_or_else(|e| {
                eprintln!("ERROR writing to {path}: {e}");
                std::process::exit(1);
            });
            eprintln!("Output written to {path}");
        }
        None => {
            println!("{json}");
        }
    }
}
