import { Icon } from "./Icon";

/** Bouton « supprimer » discret : icône seule en couleur secondaire au repos, rouge au survol et au focus. */
export function TrashButton(p: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="trashbtn" aria-label={p.label} title={p.label} onClick={p.onClick}>
      <Icon name="trash-2" size={20} />
    </button>
  );
}
