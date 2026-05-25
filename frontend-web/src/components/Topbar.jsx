import { I } from "../icons";
import RoleSwitcher from "./RoleSwitcher";
import LabSwitcher from "./LabSwitcher";

export default function Topbar({
  screenLabel, lab, labs, onLabChange, onCreateLab,
  user, roles, primaryRole, onLogout,
}) {
  return (
    <header className="topbar">
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
      <button className="icon-btn" title="Notifications">
        <I.Bell size={16} />
        <span className="dot"></span>
      </button>
      {labs && labs.length > 0 && (
        <LabSwitcher labs={labs} activeLab={lab} onChange={onLabChange} onCreateNew={onCreateLab} />
      )}
      <RoleSwitcher user={user} roles={roles} primaryRole={primaryRole} onLogout={onLogout} />
    </header>
  );
}
