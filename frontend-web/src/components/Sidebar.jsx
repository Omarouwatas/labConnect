import { I } from "../icons";

export default function Sidebar({ active, onNavigate, permissions, lab, counts = {} }) {
  const items = [
    { id: "dashboard", label: "Tableau de bord", icon: I.Home,     locked: false },
    { id: "analyses",  label: "Analyses",        icon: I.Sparkle,  locked: !permissions.enterResult && !permissions.validate && !permissions.editTests, count: counts.toAct },
    { id: "tests",     label: "Tests & tarifs",  icon: I.Beaker,   locked: false, count: counts.tests },
    { id: "staff",     label: "Personnel",       icon: I.Users,    locked: !permissions.editStaff && !permissions.viewFinance, count: counts.staff },
    { id: "stats",     label: "Statistiques",    icon: I.BarChart, locked: false },
    { id: "inventory", label: "Inventaire",      icon: I.Box,      locked: !permissions.editTests, count: counts.lowStock },
    { id: "map",       label: "Carte terrain",   icon: I.Building, locked: !permissions.editStaff && !permissions.editSettings },
    { id: "settings",  label: "Paramètres",      icon: I.Settings, locked: !permissions.editSettings },
  ];

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">l</div>
        <div className="brand-name">lab<em>Connect</em></div>
      </div>

      <div className="nav-section-label">Espace de travail</div>
      {items.map((it) => (
        <button
          key={it.id}
          className={`nav-item ${active === it.id ? "active" : ""} ${it.locked ? "disabled" : ""}`}
          onClick={() => !it.locked && onNavigate(it.id)}
          title={it.locked ? "Accès restreint pour votre rôle" : undefined}
        >
          <it.icon size={17} sw={1.7} />
          <span>{it.label}</span>
          {it.locked
            ? <I.Lock size={13} sw={1.7} style={{ marginLeft: "auto", color: "var(--ink-3)" }} />
            : (it.count !== undefined && <span className="nav-count">{it.count}</span>)
          }
        </button>
      ))}

      <div className="sidebar-foot">
        <div className="lab-card">
          <div className="lc-mark">{(lab?.name || "L")[0].toUpperCase()}</div>
          <div>
            <div className="lc-name">{lab?.name || "Aucun labo"}</div>
            <div className="lc-sub">{lab ? "Nouakchott · Mauritanie" : "Créez votre premier labo"}</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
