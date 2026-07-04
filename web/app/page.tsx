"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSudoku } from "@/app/hooks/useSudoku";
import {
  DIFFICULTY_LABEL,
  firstPuzzle,
  randomPuzzle,
  type Difficulty,
} from "@/app/lib/puzzles";
import { Header } from "@/app/components/Header";
import { Footer } from "@/app/components/Footer";
import { DifficultyTabs } from "@/app/components/DifficultyTabs";
import { GameInfo } from "@/app/components/GameInfo";
import { Board } from "@/app/components/Board";
import { InputPanel } from "@/app/components/InputPanel";
import { CompletionModal } from "@/app/components/CompletionModal";

function formatTime(seconds: number): string {
  const s = Math.floor(seconds);
  const m = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${m}:${ss}`;
}

export default function Home() {
  const [difficulty, setDifficulty] = useState<Difficulty>("easy");
  // Deterministic first puzzle for the initial render (avoids hydration mismatch);
  // user actions below switch to random puzzles.
  const initial = useMemo(() => firstPuzzle("easy"), []);
  const game = useSudoku(initial);
  const { state, selected, notesMode, mistakeFlash } = game;

  const newGame = useCallback(() => {
    game.loadPuzzle(randomPuzzle(difficulty));
  }, [game, difficulty]);

  const changeDifficulty = useCallback(
    (d: Difficulty) => {
      setDifficulty(d);
      game.loadPuzzle(randomPuzzle(d));
    },
    [game],
  );

  // Keyboard: digits place, Backspace/Delete erase, arrows move selection.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= 9) {
        game.inputDigit(n);
        return;
      }
      if (e.key === "Backspace" || e.key === "Delete" || e.key === "0") {
        game.erase();
        return;
      }
      if (!selected) return;
      const moves: Record<string, [number, number]> = {
        ArrowUp: [-1, 0],
        ArrowDown: [1, 0],
        ArrowLeft: [0, -1],
        ArrowRight: [0, 1],
      };
      const move = moves[e.key];
      if (move) {
        e.preventDefault();
        const [dr, dc] = move;
        game.select(
          Math.max(0, Math.min(8, selected[0] + dr)),
          Math.max(0, Math.min(8, selected[1] + dc)),
        );
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [game, selected]);

  const share = useCallback(() => {
    const txt = `פתרתי סודוקו ${DIFFICULTY_LABEL[difficulty]} ב-${formatTime(
      state.elapsed,
    )} עם ${state.mistakes} טעויות 🧩\n${
      typeof location !== "undefined" ? location.href : ""
    }`;
    if (typeof navigator !== "undefined" && navigator.share) {
      navigator.share({ text: txt }).catch(() => {});
    } else if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(txt).catch(() => {});
    }
  }, [difficulty, state.elapsed, state.mistakes]);

  return (
    <>
      <Header />
      <DifficultyTabs active={difficulty} onChange={changeDifficulty} />

      <div className="game-area">
        <div className="puzzle-panel">
          <GameInfo
            difficulty={difficulty}
            mistakes={state.mistakes}
            maxMistakes={state.maxMistakes}
            elapsed={state.elapsed}
            onNewGame={newGame}
          />
          <Board
            state={state}
            selected={selected}
            mistakeFlash={mistakeFlash}
            onSelect={game.select}
          />
        </div>

        <InputPanel
          userGrid={state.userGrid}
          notesMode={notesMode}
          onUndo={game.undo}
          onErase={game.erase}
          onToggleNotes={game.toggleNotesMode}
          onHint={game.hint}
          onNumber={game.inputDigit}
        />
      </div>

      <CompletionModal
        open={state.isComplete || state.isGameOver}
        won={state.isComplete}
        elapsed={state.elapsed}
        mistakes={state.mistakes}
        hints={state.hintsUsed}
        onNewGame={newGame}
        onShare={share}
      />

      <Footer />
    </>
  );
}
