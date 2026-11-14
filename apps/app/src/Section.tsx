import { Icon } from "./ui/Icon";

/** Section repliable d'une fiche : titre, état (complète ou à compléter), contenu. */
export function Section(p: { id: string; title: string; ok: boolean; open: boolean; onToggle: (id: string) => void; okLabel?: string; todoLabel?: string; /** Sans état (ni « complet » ni « à compléter ») : section simple repliable. */ plain?: boolean; children: React.ReactNode }) {
  return (
    <section className={p.plain ? "sect" : p.ok ? "sect done" : "sect todo"}>
      <button className="secthead" aria-expanded={p.open} onClick={() => p.onToggle(p.id)}>
        <span className="secttitle"><Icon name={p.open ? "chevron-down" : "chevron-right"} size={16} /> {p.title}</span>
        {!p.plain && <span className={p.ok ? "badge okbadge" : "badge todobadge"}><Icon name={p.ok ? "circle-check" : "diamond-alert"} size={16} />{p.ok ? p.okLabel : p.todoLabel}</span>}
      </button>
      {p.open && <div className="sectbody">{p.children}</div>}
    </section>
  );
}

