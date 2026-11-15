/** Champ texte encadré (même style que UnitField), libellé au-dessus ; validé à la sortie du champ. */
export function TextField(p: { label: string; value: string; onCommit: (v: string) => void; optional?: string; upper?: boolean; maxLength?: number }) {
  return (
    <div className="ufield stack">
      <label className="uf-label">
        <span>{p.label}{p.optional && <em className="uf-opt">{p.optional}</em>}</span>
        <span className="uf-inp txt">
          <input
            defaultValue={p.value}
            key={p.value}
            maxLength={p.maxLength}
            placeholder={p.optional ?? "—"}
            style={p.upper ? { textTransform: "uppercase" } : undefined}
            onBlur={(e) => p.onCommit(e.target.value.trim())}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
        </span>
      </label>
    </div>
  );
}
