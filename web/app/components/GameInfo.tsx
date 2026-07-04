import { DIFFICULTY_LABEL, type Difficulty } from "@/app/lib/puzzles";

function formatTime(seconds: number): string {
  const s = Math.floor(seconds);
  const m = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${m}:${ss}`;
}

export function GameInfo({
  difficulty,
  mistakes,
  maxMistakes,
  elapsed,
  onNewGame,
}: {
  difficulty: Difficulty;
  mistakes: number;
  maxMistakes: number;
  elapsed: number;
  onNewGame: () => void;
}) {
  return (
    <div className="game-info">
      <div className="info-left">
        <span className="diff-lbl">{DIFFICULTY_LABEL[difficulty]}</span>
        <div className="mistakes-row">
          <span className="mistakes-txt">טעויות:</span>
          <div className="pips">
            {Array.from({ length: maxMistakes }, (_, i) => (
              <span key={i} className={"pip" + (i < mistakes ? " on" : "")} />
            ))}
          </div>
        </div>
      </div>
      <div className="timer">{formatTime(elapsed)}</div>
      <button className="btn-new" onClick={onNewGame}>
        משחק חדש
      </button>
    </div>
  );
}
