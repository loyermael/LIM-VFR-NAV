import type { ReactNode } from "react";

export interface ResultColumn { key: string; header: string }
export interface ResultRow { key: string; highlight?: boolean; cells: ReactNode[] }

/** Tableau de résultats : première colonne à gauche, nombres tabulaires à droite, ligne facultative mise en évidence. */
export function ResultTable(p: { columns: ResultColumn[]; rows: ResultRow[] }) {
  return (
    <table className="restable">
      <thead><tr>{p.columns.map((c) => <th key={c.key} scope="col">{c.header}</th>)}</tr></thead>
      <tbody>
        {p.rows.map((r) => (
          <tr key={r.key} className={r.highlight ? "min" : undefined}>
            {r.cells.map((c, i) => (i === 0 ? <th key={i} scope="row">{c}</th> : <td key={i}>{c}</td>))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
