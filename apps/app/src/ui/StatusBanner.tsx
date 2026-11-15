import type { ReactNode } from "react";
import { Icon } from "./Icon";
import type { Level } from "../balanceView";

const ICON = { ok: "circle-check", caution: "diamond-alert", bad: "triangle-alert" } as const;

/** Bandeau d'état : toujours icône + mot (forme et couleur : vert ● OK, orange ◆ prudence, rouge ▲ alerte). */
export function StatusBanner(p: { level: Level; title: string; children?: ReactNode }) {
  return (
    <div className={`statusbanner lvl-${p.level}`} role={p.level === "bad" ? "alert" : "status"}>
      <Icon name={ICON[p.level]} size={24} />
      <div className="sb-text">
        <b>{p.title}</b>
        {p.children}
      </div>
    </div>
  );
}

/** Icône + libellé d'un niveau, pour une cellule de tableau. */
export function LevelMark(p: { level: Level; label: string }) {
  return <span className={`levelmark lvl-${p.level}`} title={p.label}><Icon name={ICON[p.level]} size={16} /><span className="lm-t">{p.label}</span></span>;
}
