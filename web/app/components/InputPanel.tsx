import type { Grid } from "@engine";

const UndoIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </svg>
);

const EraseIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 20H7L3 16l9-9 8 8-3 3Z" />
    <path d="m6.5 17.5 1 1" />
  </svg>
);

const NotesIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 20h9" />
    <path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 19l-4 1 1-4Z" />
  </svg>
);

const HintIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" />
    <path d="M9 18h6" />
    <path d="M10 22h4" />
  </svg>
);

/** Count how many of each digit are already correctly placed (engine never stores wrong values). */
function placedCounts(userGrid: Grid): number[] {
  const counts = new Array(10).fill(0);
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const v = userGrid[r][c];
      if (v > 0) counts[v]++;
    }
  }
  return counts;
}

export function InputPanel({
  userGrid,
  notesMode,
  onUndo,
  onErase,
  onToggleNotes,
  onHint,
  onNumber,
}: {
  userGrid: Grid;
  notesMode: boolean;
  onUndo: () => void;
  onErase: () => void;
  onToggleNotes: () => void;
  onHint: () => void;
  onNumber: (n: number) => void;
}) {
  const counts = placedCounts(userGrid);

  return (
    <div className="input-panel">
      <div className="controls">
        <button className="ctrl" onClick={onUndo} aria-label="ביטול">
          {UndoIcon}
          ביטול
        </button>
        <button className="ctrl" onClick={onErase} aria-label="מחיקה">
          {EraseIcon}
          מחיקה
        </button>
        <button
          className={"ctrl" + (notesMode ? " active" : "")}
          onClick={onToggleNotes}
          aria-label="הערות"
          aria-pressed={notesMode}
        >
          {NotesIcon}
          הערות
        </button>
        <button className="ctrl" onClick={onHint} aria-label="רמז">
          {HintIcon}
          רמז
        </button>
      </div>

      <div className="input-divider" aria-hidden="true" />

      <div className="numpad" role="group" aria-label="לוח מספרים">
        {Array.from({ length: 9 }, (_, i) => {
          const n = i + 1;
          return (
            <button
              key={n}
              className={"num-btn" + (counts[n] >= 9 ? " done" : "")}
              onPointerDown={() => onNumber(n)}
              aria-label={String(n)}
            >
              {n}
            </button>
          );
        })}
      </div>
    </div>
  );
}
