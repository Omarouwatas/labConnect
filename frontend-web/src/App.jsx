import { useEffect, useState } from "react";
import { AuthProvider, useAuth } from "./auth";
import { permissionsFor, primaryRole, STAFF_ROLES_FOR_WEB } from "./constants";
import Login from "./screens/Login";
import Onboarding from "./screens/Onboarding";
import Dashboard from "./screens/Dashboard";
import Analyses from "./screens/Analyses";
import Tests from "./screens/Tests";
import Staff from "./screens/Staff";
import Settings from "./screens/Settings";
import NursesMap from "./screens/NursesMap";
import Stats from "./screens/Stats";
import Inventory from "./screens/Inventory";
import Sidebar from "./components/Sidebar";
import Topbar from "./components/Topbar";
import { FullScreenLoader } from "./components/Misc";
import { fetchCatalog, fetchEmployees, fetchOrders, fetchHomeVisits } from "./api";

const SCREEN_LABELS = {
  dashboard: "Tableau de bord",
  analyses:  "Analyses",
  tests:     "Tests & tarifs",
  staff:     "Personnel",
  stats:     "Statistiques",
  inventory: "Inventaire",
  map:       "Tournées",
  settings:  "Paramètres",
};

function defaultScreenFor(roles) {
  const arr = roles || [];
  // Chaque rôle atterrit sur son écran de travail quotidien.
  if (arr.includes("lab_chief")) return "dashboard";
  if (arr.includes("biologist") || arr.includes("technician")) return "analyses";
  // Une infirmière sans autre rôle commence sur sa tournée du jour.
  if (arr.includes("nurse")) return "map";
  return "dashboard";
}

function Shell({ showCreateLab }) {
  const { user, labs, activeLab, setActiveLab, logout } = useAuth();
  // Rôles cumulés (un user peut être bio + tech) : les permissions sont l'UNION.
  const staffRoles = (user?.roles || []).filter((r) => STAFF_ROLES_FOR_WEB.includes(r));
  const displayRole = primaryRole(staffRoles);
  const [screen, setScreen] = useState(() => defaultScreenFor(staffRoles));
  const [counts, setCounts] = useState({});
  // Drawer mobile — ouvert/fermé. Sur desktop la sidebar est toujours
  // visible ; en dessous de 900 px elle se cache et s'ouvre via le
  // hamburger de la topbar. On ferme automatiquement quand on change
  // d'écran (la navigation a eu lieu, l'utilisateur veut voir le contenu).
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const permissions = permissionsFor(staffRoles);

  useEffect(() => {
    (async () => {
      try {
        const targetStatus = permissions.validate ? "completed" : "in_progress";
        const [tests, staff, toAct, todayVisits] = await Promise.allSettled([
          fetchCatalog(),
          fetchEmployees(),
          (permissions.enterResult || permissions.validate)
            ? fetchOrders(`?status=${targetStatus}`)
            : Promise.resolve([]),
          // Badge sidebar « Tournées » : nombre de visites à domicile
          // pertinentes pour cet utilisateur (mine si nurse seule, all
          // sinon — le backend décide en fonction du rôle).
          permissions.viewHomeVisits
            ? fetchHomeVisits()
            : Promise.resolve([]),
        ]);
        const len = (s) => s.status === "fulfilled" ? s.value.length : undefined;
        setCounts({
          tests: len(tests),
          staff: len(staff),
          toAct: len(toAct),
          todayVisits: len(todayVisits),
        });
      } catch { /* ignore */ }
    })();
  }, [screen, activeLab?.uuid, permissions.enterResult, permissions.validate, permissions.viewHomeVisits]);

  // Garde-fou : si l'écran courant n'est plus accessible (changement
  // de rôle, init désynchronisé), on rebondit vers le dashboard. C'est
  // une ceinture-et-bretelles avec le filtre côté Sidebar : la sidebar
  // masque l'item, mais on peut atterrir ici si l'état est obsolète.
  useEffect(() => {
    if (screen === "settings" && !permissions.editSettings) setScreen("dashboard");
    if (screen === "map" && !permissions.viewHomeVisits) setScreen("dashboard");
    if (screen === "analyses" && !permissions.enterResult && !permissions.validate && !permissions.editTests) {
      setScreen("dashboard");
    }
    if (screen === "inventory" && !permissions.editTests) setScreen("dashboard");
    if (screen === "staff" && !permissions.editStaff && !permissions.viewFinance) {
      setScreen("dashboard");
    }
  }, [
    screen,
    permissions.editSettings, permissions.viewHomeVisits,
    permissions.enterResult, permissions.validate, permissions.editTests,
    permissions.editStaff, permissions.viewFinance,
  ]);

  const ScreenCmp = {
    dashboard: <Dashboard user={user} lab={activeLab} roles={staffRoles} primaryRole={displayRole} permissions={permissions} />,
    analyses:  <Analyses roles={staffRoles} permissions={permissions} />,
    tests:     <Tests permissions={permissions} />,
    staff:     <Staff permissions={permissions} />,
    stats:     <Stats permissions={permissions} />,
    inventory: <Inventory permissions={permissions} />,
    map:       <NursesMap lab={activeLab} permissions={permissions} />,
    settings:  <Settings permissions={permissions} lab={activeLab} />,
  }[screen];

  // Bascule l'écran ET ferme le drawer mobile en même temps (sinon
  // le menu reste ouvert par-dessus l'écran qu'on vient d'ouvrir).
  const navigate = (next) => { setScreen(next); setMobileMenuOpen(false); };

  return (
    <div className={`app ${mobileMenuOpen ? "menu-open" : ""}`}>
      <Sidebar
        active={screen}
        onNavigate={navigate}
        permissions={permissions}
        lab={activeLab}
        counts={counts}
        mobileOpen={mobileMenuOpen}
        onMobileClose={() => setMobileMenuOpen(false)}
      />
      {/* Backdrop semi-opaque cliquable — visible uniquement quand le
          drawer mobile est ouvert. Sur desktop ce div est masqué via CSS. */}
      <div
        className={`sidebar-backdrop ${mobileMenuOpen ? "open" : ""}`}
        onClick={() => setMobileMenuOpen(false)}
        aria-hidden="true"
      />
      <main>
        <Topbar
          screenLabel={SCREEN_LABELS[screen]}
          lab={activeLab}
          labs={labs}
          onLabChange={setActiveLab}
          onCreateLab={showCreateLab}
          user={user}
          roles={staffRoles}
          primaryRole={displayRole}
          onLogout={logout}
          onMenuOpen={() => setMobileMenuOpen(true)}
        />
        {ScreenCmp}
      </main>
    </div>
  );
}

function Gate() {
  const { loading, user, labs, activeLab, reload } = useAuth();
  const [forceOnboarding, setForceOnboarding] = useState(false);

  if (loading) return <FullScreenLoader />;
  if (!user) return <Login />;

  // Chef avec aucun labo → onboarding
  const isChief = (user.roles || []).includes("lab_chief");
  if ((isChief && labs.length === 0) || forceOnboarding) {
    return <Onboarding onCreated={async () => { setForceOnboarding(false); await reload(); }} />;
  }

  // Staff non-chef sans labo : compte mal rattaché — message
  if (!activeLab) {
    return (
      <div className="full-screen-loader">
        <div className="card" style={{ padding: 32, maxWidth: 420, textAlign: "center" }}>
          <h3 style={{ fontFamily: "var(--serif)", margin: "0 0 8px" }}>Aucun laboratoire</h3>
          <p style={{ color: "var(--ink-2)", fontSize: 13 }}>
            Votre compte n'est rattaché à aucun laboratoire. Demandez à votre chef de labo de vous inviter.
          </p>
        </div>
      </div>
    );
  }

  return <Shell showCreateLab={() => setForceOnboarding(true)} />;
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
