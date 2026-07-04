import type { GameState } from "@engine";

function sameBox(r1: number, c1: number, r2: number, c2: number): boolean {
  return ((r1 / 3) | 0) === ((r2 / 3) | 0) && ((c1 / 3) | 0) === ((c2 / 3) | 0);
}

export function Board({
  state,
  selected,
  mistakeFlash,
  onSelect,
}: {
  state: GameState;
  selected: [number, number] | null;
  mistakeFlash: boolean;
  onSelect: (row: number, col: number) => void;
}) {
  const { puzzle, userGrid, solution, notes } = state;
  const sr = selected ? selected[0] : -1;
  const sc = selected ? selected[1] : -1;
  const selValue = sr >= 0 ? userGrid[sr][sc] : 0;

  return (
    <div className="board-wrap">
      <div className="sudoku-grid">
        {Array.from({ length: 9 }, (_, r) => (
          <div key={r} className={"grid-row" + (r === 2 || r === 5 ? " box-row" : "")}>
            {Array.from({ length: 9 }, (_, c) => {
              const given = puzzle[r][c] !== 0;
              const value = userGrid[r][c];
              const isSelected = r === sr && c === sc;
              const hasNotes = value === 0 && notes[r][c].size > 0;

              let cls = "cell" + (c === 2 || c === 5 ? " box-col" : "");
              if (given) cls += " given";
              else if (value > 0) cls += " user";

              if (isSelected && mistakeFlash) {
                cls += " hl-err";
              } else if (isSelected) {
                cls += " hl-sel";
              } else if (sr >= 0) {
                if (r === sr || c === sc || sameBox(r, c, sr, sc)) cls += " hl-peer";
                if (selValue > 0 && value === selValue) cls += " hl-same";
              }

              return (
                <div
                  key={c}
                  className={cls}
                  onPointerDown={() => onSelect(r, c)}
                >
                  {value > 0 ? (
                    <span className="cell-num">{value}</span>
                  ) : hasNotes ? (
                    <div className="notes-grid">
                      {Array.from({ length: 9 }, (_, i) => (
                        <span key={i} className="note-n">
                          {notes[r][c].has(i + 1) ? i + 1 : ""}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
