"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SudokuEngine, type GameState } from "@engine";
import type { Puzzle } from "@/app/lib/puzzles";

// The bridge between React and the tested game engine. It holds ONE SudokuEngine
// instance and forwards every action to it — no game logic lives here. Selection
// and notes-mode are pure UI state (the engine has no concept of them), exactly
// as the original prototype kept them separate.
export interface UseSudoku {
  state: GameState;
  selected: [number, number] | null;
  notesMode: boolean;
  mistakeFlash: boolean;
  select: (row: number, col: number) => void;
  inputDigit: (digit: number) => void;
  erase: () => void;
  undo: () => void;
  hint: () => void;
  toggleNotesMode: () => void;
  loadPuzzle: (p: Puzzle) => void;
}

export function useSudoku(initial: Puzzle): UseSudoku {
  const engineRef = useRef<SudokuEngine | null>(null);
  if (engineRef.current === null) {
    engineRef.current = new SudokuEngine(initial.puzzle, initial.solution);
  }

  const [state, setState] = useState<GameState>(() => engineRef.current!.getState());
  const [selected, setSelected] = useState<[number, number] | null>(null);
  const [notesMode, setNotesMode] = useState(false);
  const [mistakeFlash, setMistakeFlash] = useState(false);

  const refresh = useCallback(() => setState(engineRef.current!.getState()), []);

  // Start the clock on mount and tick the displayed time once a second.
  useEffect(() => {
    engineRef.current!.startTimer();
    refresh();
    const id = setInterval(refresh, 1000);
    return () => clearInterval(id);
  }, [refresh]);

  const loadPuzzle = useCallback(
    (p: Puzzle) => {
      const engine = new SudokuEngine(p.puzzle, p.solution);
      engine.startTimer();
      engineRef.current = engine;
      setSelected(null);
      setNotesMode(false);
      setMistakeFlash(false);
      refresh();
    },
    [refresh],
  );

  const select = useCallback((row: number, col: number) => {
    setSelected([row, col]);
  }, []);

  const inputDigit = useCallback(
    (digit: number) => {
      if (!selected) return;
      const [r, c] = selected;
      const engine = engineRef.current!;
      if (notesMode) {
        engine.toggleNote(r, c, digit);
      } else {
        const result = engine.enterDigit(r, c, digit);
        if (result.mistake) {
          // The engine refuses to place a wrong digit (it only counts a
          // mistake), so flash the cell briefly to give the player feedback.
          setMistakeFlash(true);
          setTimeout(() => setMistakeFlash(false), 350);
        }
      }
      refresh();
    },
    [selected, notesMode, refresh],
  );

  const erase = useCallback(() => {
    if (!selected) return;
    const [r, c] = selected;
    engineRef.current!.eraseCell(r, c);
    refresh();
  }, [selected, refresh]);

  const undo = useCallback(() => {
    engineRef.current!.undo();
    refresh();
  }, [refresh]);

  const hint = useCallback(() => {
    const engine = engineRef.current!;
    const h = engine.getHint(); // also increments hintsUsed
    if (!h) {
      refresh();
      return;
    }
    // Reveal the cell the engine recommends. For 'place' hints h.digit is the
    // answer; for 'eliminate' hints we can't apply note-elimination yet (ENG-4),
    // so we fill that cell's correct value to keep the hint useful in v1.
    const [r, c] = h.targetCell;
    const answer = engine.getState().solution[r][c];
    engine.enterDigit(r, c, answer);
    setSelected([r, c]);
    refresh();
  }, [refresh]);

  const toggleNotesMode = useCallback(() => setNotesMode((m) => !m), []);

  return {
    state,
    selected,
    notesMode,
    mistakeFlash,
    select,
    inputDigit,
    erase,
    undo,
    hint,
    toggleNotesMode,
    loadPuzzle,
  };
}
