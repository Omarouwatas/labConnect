import { useEffect } from "react";

/**
 * Ferme un popover / menu quand l'utilisateur clique en dehors de l'élément
 * pointé par `ref`. Le handler est attaché à `mousedown` (et non `click`)
 * pour fermer dès que le bouton est enfoncé, avant qu'un éventuel élément
 * cible perde le focus.
 */
export function useClickOutside(ref, onOutside) {
  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onOutside();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [ref, onOutside]);
}
