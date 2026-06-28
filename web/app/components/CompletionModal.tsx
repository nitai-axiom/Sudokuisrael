function formatTime(seconds: number): string {
  const s = Math.floor(seconds);
  const m = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${m}:${ss}`;
}

export function CompletionModal({
  open,
  won,
  elapsed,
  mistakes,
  hints,
  onNewGame,
  onShare,
}: {
  open: boolean;
  won: boolean;
  elapsed: number;
  mistakes: number;
  hints: number;
  onNewGame: () => void;
  onShare: () => void;
}) {
  return (
    <div
      className={"modal-scrim" + (open ? " open" : "")}
      role="dialog"
      aria-modal="true"
      aria-label={won ? "פאזל הושלם" : "המשחק הסתיים"}
    >
      <div className="modal">
        <div className="modal-handle" aria-hidden="true" />
        <div className="modal-icon">{won ? "🎉" : "😕"}</div>
        <h2 className="modal-title">{won ? "כל הכבוד!" : "אוי, נגמרו הטעויות"}</h2>
        <p className="modal-sub">
          {won ? "פתרתם את הפאזל בהצלחה" : "הגעתם ל-3 טעויות — נסו שוב"}
        </p>
        <div className="modal-stats">
          <div>
            <div className="stat-val">{formatTime(elapsed)}</div>
            <div className="stat-lbl">זמן</div>
          </div>
          <div>
            <div className="stat-val">{mistakes}</div>
            <div className="stat-lbl">טעויות</div>
          </div>
          <div>
            <div className="stat-val">{hints}</div>
            <div className="stat-lbl">רמזים</div>
          </div>
        </div>
        <div className="modal-actions">
          {won && (
            <button className="m-btn m-btn-secondary" onClick={onShare}>
              שיתוף ↗
            </button>
          )}
          <button className="m-btn m-btn-primary" onClick={onNewGame}>
            משחק חדש
          </button>
        </div>
      </div>
    </div>
  );
}
