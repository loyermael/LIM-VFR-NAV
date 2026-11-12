import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Bouton à confirmation en deux temps, commun à toutes les actions destructives : un premier appui « arme » le bouton (il devient « Confirmer »),
 * un second appui exécute. L'état armé retombe seul après 4 s ou au premier appui ailleurs, et un second appui trop rapide (moins de 0,35 s, double-tap)
 * est ignoré pour qu'une suppression ne puisse pas partir d'un double appui involontaire.
 */
export function ConfirmButton(p: {
  label: ReactNode;
  confirmLabel: ReactNode;
  onConfirm: () => void;
  className?: string;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  const armedAt = useRef(0);
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 4000);
    const away = (e: Event) => { if (!ref.current?.contains(e.target as Node)) setArmed(false); };
    document.addEventListener("pointerdown", away);
    return () => { clearTimeout(timer); document.removeEventListener("pointerdown", away); };
  }, [armed]);
  if (!armed) {
    return (
      <button ref={ref} className={p.className} aria-label={p.ariaLabel} disabled={p.disabled} onClick={() => { armedAt.current = Date.now(); setArmed(true); }}>
        {p.label}
      </button>
    );
  }
  return (
    <button
      ref={ref}
      className={`brand ${p.className ?? ""}`.trim()}
      onClick={() => {
        if (Date.now() - armedAt.current < 350) return;
        setArmed(false);
        p.onConfirm();
      }}
    >
      {p.confirmLabel}
    </button>
  );
}
