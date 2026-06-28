import { DIFFICULTIES, DIFFICULTY_LABEL, type Difficulty } from "@/app/lib/puzzles";

export function DifficultyTabs({
  active,
  onChange,
}: {
  active: Difficulty;
  onChange: (d: Difficulty) => void;
}) {
  return (
    <div className="diff-bar">
      <div className="seg" role="tablist" aria-label="רמת קושי">
        {DIFFICULTIES.map((d) => (
          <span
            key={d}
            className={"seg-btn" + (d === active ? " active" : "")}
            role="tab"
            aria-selected={d === active}
            onClick={() => onChange(d)}
          >
            {DIFFICULTY_LABEL[d]}
          </span>
        ))}
      </div>
    </div>
  );
}
