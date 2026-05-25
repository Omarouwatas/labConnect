import { useCallback, useRef, useState } from "react";
import { I } from "../icons";
import { useClickOutside } from "../hooks/useClickOutside";

export default function LabSwitcher({ labs, activeLab, onChange, onCreateNew }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useClickOutside(ref, useCallback(() => setOpen(false), []));

  if (!activeLab) return null;
  const mark = (activeLab.name || "L")[0].toUpperCase();

  return (
    <div className="role-switch" ref={ref}>
      <button className="role-switch-trigger" onClick={() => setOpen((o) => !o)} title="Changer de laboratoire">
        <div className="avatar" style={{ background: "linear-gradient(135deg, var(--o) 0%, var(--o-deep) 100%)", color: "white", fontFamily: "var(--serif)" }}>
          {mark}
        </div>
        <div className="who">
          <span className="name">{activeLab.name}</span>
          <span className="role">Laboratoire actif</span>
        </div>
        <I.Chev className="chev" size={14} />
      </button>
      {open && (
        <div className="role-menu">
          <div className="role-menu-label">Vos laboratoires</div>
          {labs.map((l) => (
            <button
              key={l.uuid}
              className={`role-option ${activeLab.uuid === l.uuid ? "active" : ""}`}
              onClick={() => { onChange(l); setOpen(false); }}
            >
              <div className="avatar ro-avatar" style={{ background: "linear-gradient(135deg, var(--o) 0%, var(--o-deep) 100%)", color: "white", fontFamily: "var(--serif)" }}>
                {(l.name || "L")[0].toUpperCase()}
              </div>
              <div className="ro-meta">
                <div className="n">{l.name}</div>
                <div className="r">{l.address?.slice(0, 48) || "—"}</div>
              </div>
              <I.Check className="ro-check" size={16} />
            </button>
          ))}
          {onCreateNew && (
            <button
              className="logout-btn"
              onClick={() => { setOpen(false); onCreateNew(); }}
              style={{ marginTop: 8 }}
            >
              <I.Plus size={14} sw={2} /> Créer un nouveau labo
            </button>
          )}
        </div>
      )}
    </div>
  );
}
