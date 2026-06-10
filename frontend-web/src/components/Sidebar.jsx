import { I } from "../icons";

/**
 * Sidebar — Filtrée par permission, pas verrouillée.
 *
 * Avant : on affichait tous les items et on rajoutait un cadenas sur
 * ceux interdits par le rôle. Inconvénient — un biologiste voyait
 * « Paramètres » alors qu'il ne pouvait rien y faire, ce qui crée
 * une attente fausse + un clic perdu.
 *
 * Maintenant : `hidden` masque l'item entièrement. Le menu d'un
 * biologiste ne montre QUE ce qu'il peut faire (Dashboard, Analyses,
 * Tests, Personnel, Statistiques). Idem pour chaque rôle.
 *
 * Choix d'UX : on garde quand même Tableau de bord, Tests & tarifs et
 * Statistiques visibles à tous les rôles staff — ce sont des écrans
 * d'information utiles à n'importe qui dans le labo. Le reste est
 * gated par sa permission métier.
 */
export default function Sidebar({
  active, onNavigate, permissions, lab, counts = {},
  mobileOpen = false, onMobileClose,
}) {
  const items = [
    { id: "dashboard", label: "Tableau de bord", icon: I.Home,     hidden: false },
    { id: "analyses",  label: "Analyses",        icon: I.Sparkle,  hidden: !permissions.enterResult && !permissions.validate && !permissions.editTests, count: counts.toAct },
    { id: "tests",     label: "Tests & tarifs",  icon: I.Beaker,   hidden: false, count: counts.tests },
    { id: "staff",     label: "Personnel",       icon: I.Users,    hidden: !permissions.editStaff && !permissions.viewFinance, count: counts.staff },
    { id: "stats",     label: "Statistiques",    icon: I.BarChart, hidden: false },
    { id: "inventory", label: "Inventaire",      icon: I.Box,      hidden: !permissions.editTests, count: counts.lowStock },
    { id: "map",       label: "Tournées",        icon: I.Building, hidden: !permissions.viewHomeVisits, count: counts.todayVisits },
    { id: "settings",  label: "Paramètres",      icon: I.Settings, hidden: !permissions.editSettings },
  ].filter((it) => !it.hidden);

  return (
    // Sur desktop, `mobile-open` n'a aucun effet — la sidebar est toujours
    // visible (cf. CSS .sidebar position: sticky sans transform). En-dessous
    // de 900 px, le CSS la translate hors écran sauf si .mobile-open.
    <aside className={`sidebar ${mobileOpen ? "mobile-open" : ""}`}>
      <div className="brand">
        <div className="brand-mark">l</div>
        <div className="brand-name">lab<em>Connect</em></div>
        {/* Bouton fermeture du drawer — visible uniquement sur mobile via CSS. */}
        <button
          className="sidebar-close"
          onClick={onMobileClose}
          aria-label="Fermer le menu"
        >
          <I.X size={16} />
        </button>
      </div>

      <div className="nav-section-label">Espace de travail</div>
      {items.map((it) => (
        <button
          key={it.id}
          className={`nav-item ${active === it.id ? "active" : ""}`}
          onClick={() => onNavigate(it.id)}
        >
          <it.icon size={17} sw={1.7} />
          <span>{it.label}</span>
          {it.count !== undefined && <span className="nav-count">{it.count}</span>}
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
