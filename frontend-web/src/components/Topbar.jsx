import { I } from "../icons";
import RoleSwitcher from "./RoleSwitcher";
import LabSwitcher from "./LabSwitcher";
import NotificationsBell from "./NotificationsBell";

export default function Topbar({
  screenLabel, lab, labs, onLabChange, onCreateLab,
  user, roles, primaryRole, onLogout,
  onMenuOpen,                    // appelé par le hamburger sur mobile
}) {
  return (
    <header className="topbar">
      {/* Hamburger — caché en desktop via CSS, visible ≤ 900 px. */}
      <button
        className="topbar-menu-btn"
        onClick={onMenuOpen}
        aria-label="Ouvrir le menu"
      >
        <I.Menu size={20} />
      </button>
      <div className="crumbs">
        <span>{lab?.name || "labConnect"}</span>
        <span>·</span>
        <strong>{screenLabel}</strong>
      </div>
      <div className="topbar-spacer" />
      <div className="search">
        <I.Search size={15} />
        <input placeholder="Rechercher un test, patient, membre…" />
        <span className="kbd">⌘K</span>
      </div>
      {/* Cloche notifications avec dropdown — polling 30 s, badge unread. */}
      <NotificationsBell />
      {labs && labs.length > 0 && (
        <LabSwitcher labs={labs} activeLab={lab} onChange={onLabChange} onCreateNew={onCreateLab} />
      )}
      <RoleSwitcher user={user} roles={roles} primaryRole={primaryRole} onLogout={onLogout} />
    </header>
  );
}
