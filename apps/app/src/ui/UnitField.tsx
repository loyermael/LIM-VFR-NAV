import { useEffect, useState, type ReactNode } from "react";
import { fillLevel } from "../balanceView";

/**
 * Champ numérique en ligne « libellé | valeur » : unité dans le champ (à droite), limite facultative (« / 110 »)
 * et fine barre de remplissage (neutre, orange près de la limite, rouge au-delà). Valeur validée à la sortie du champ.
 */
export function UnitField(props: {
  label: string;
  value: number | null;
  unit: string;
  onCommit: (v: number | null) => void;
  decimals?: number;
  /** Limite affichée (même unité que la valeur) ; active la barre de remplissage. */
  limit?: number | null;
  /** Ligne d'aide sous le champ (ex. équivalent en kg). */
  hint?: ReactNode;
}) {
  const decimals = props.decimals ?? 0;
  const show = (v: number | null) => (v === null ? "" : v.toFixed(decimals));
  const [text, setText] = useState(show(props.value));
  useEffect(() => setText(show(props.value)), [props.value, decimals]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = () => {
    const s = text.trim().replace(",", ".");
    if (s === "") return props.onCommit(null);
    const v = Number(s);
    if (Number.isFinite(v)) props.onCommit(v);
    else setText(show(props.value));
  };
  const lim = props.limit ?? null;
  const fill = fillLevel(props.value, lim);
  return (
    <div className="ufield">
      <label className="uf-label">
        <span>{props.label}</span>
        <span className={fill && fill.level !== "ok" ? `uf-inp lvl-${fill.level}` : "uf-inp"}>
          {lim !== null && <span className="uf-lim">/ {lim.toFixed(decimals)}</span>}
          <input
            className="mono"
            inputMode="decimal"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === "Enter" && commit()}
          />
          <span className="uf-unit">{props.unit}</span>
        </span>
      </label>
      {fill && (
        <div className={`uf-bar lvl-${fill.level}`} aria-hidden="true">
          <i style={{ width: `${Math.min(100, fill.ratio * 100)}%` }} />
        </div>
      )}
      {props.hint && <div className="uf-hint">{props.hint}</div>}
    </div>
  );
}
