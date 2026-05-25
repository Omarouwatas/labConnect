import { useCallback, useRef, useState } from "react";
import { I } from "../icons";
import { ROLE_AVATARS, ROLE_LABELS, ROLES, initials } from "../constants";
import { useClickOutside } from "../hooks/useClickOutside";

/**
 * Affiche l'identité de l'utilisateur connecté et l'ENSEMBLE de ses rôles.
 *
 * Quand un utilisateur cumule plusieurs rôles (ex. biologiste + technicien),
 * tous ses rôles sont actifs en permanence — pas de "switch" qui restreint
 * les permissions. Le menu déroulant n'est qu'un affichage de référence
 * + le bouton de déconnexion.
 */
export default function RoleSwitcher({ user, roles = [], primaryRole, onLogout }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useClickOutside(ref, useCallback(() => setOpen(false), []));

  const fullName = user
    ? `${user.first_name || ""} ${user.last_name || ""}`.trim() || user.email || user.phone || "Utilisateur"
    : "—";
  const ini = initials(fullName);
  const avatarClass = ROLE_AVATARS[primaryRole] || "a1";

  // Libellé compact pour le trigger
  const triggerLabel = roles.length === 0
    ? "Aucun rôle"
    : roles.length === 1
      ? ROLE_LABELS[roles[0]]
      : `${ROLE_LABELS[primaryRole]} +${roles.length - 1}`;

  return (
    <div className="role-switch" ref={ref}>
      <button className="role-switch-trigger" onClick={() => setOpen((o) => !o)}>
        <div className={`avatar ${avatarClass}`}>{ini}</div>
        <div className="who">
          <span className="name">{fullName}</span>
          <span className="role">{triggerLabel}</span>
        </div>
        <I.Chev className="chev" size={14} />
      </button>
      {open && (
        <div className="role-menu">
          <div className="role-menu-label">Rôles cumulés</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "4px 10px 10px" }}>
            {roles.length === 0 && (
              <span style={{ fontSize: 12, color: "var(--ink-3)" }}>Aucun rôle staff attribué.</span>
            )}
            {roles.map((r) => (
              <span key={r} className={`badge ${r === ROLES.LAB_CHIEF ? "orange" : ""}`}>
                <span className="dot" />{ROLE_LABELS[r] || r}
              </span>
            ))}
          </div>
          {roles.length > 1 && (
            <div style={{
              padding: "8px 10px",
              fontSize: 11.5,
              color: "var(--ink-2)",
              background: "var(--o-glow)",
              borderRadius: 9,
              margin: "0 6px 6px",
              border: "1px solid var(--o-tint)",
            }}>
              ✨ Vos permissions sont l'<strong>union</strong> de tous vos rôles. Vous pouvez agir simultanément dans chacun d'eux.
            </div>
          )}
          <button className="logout-btn" onClick={() => { setOpen(false); onLogout?.(); }}>
            <I.Logout size={14} sw={1.8} /> Se déconnecter
          </button>
        </div>
      )}
    </div>
  );
}
