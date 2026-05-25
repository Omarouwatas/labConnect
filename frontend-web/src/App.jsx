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
import Sidebar from "./components/Sidebar";
import Topbar from "./components/Topbar";
import { FullScreenLoader } from "./components/Misc";
import { fetchCatalog, fetchEmployees, fetchOrders } from "./api";

const SCREEN_LABELS = {
  dashboard: "Tableau de bord",
  analyses:  "Analyses",
  tests:     "Tests & tarifs",
  staff:     "Personnel",
  map:       "Carte terrain",
  settings:  "Paramètres",
};

function defaultScreenFor(roles) {
  const arr = roles || [];
  // Chef → vue d'ensemble. Sinon, si l'utilisateur peut saisir ou valider,
  // son boulot quotidien = écran Analyses.
  if (arr.includes("lab_chief")) return "dashboard";
  if (arr.includes("biologist") || arr.includes("technician")) return "analyses";
  return "dashboard";
}

function Shell({ showCreateLab }) {
  const { user, labs, activeLab, setActiveLab, logout } = useAuth();
  // Rôles cumulés (un user peut être bio + tech) : les permissions sont l'UNION.
  const staffRoles = (user?.roles || []).filter((r) => STAFF_ROLES_FOR_WEB.includes(r));
  const displayRole = primaryRole(staffRoles);
  const [screen, setScreen] = useState(() => defaultScreenFor(staffRoles));
  const [counts, setCounts] = useState({});

  const permissions = permissionsFor(staffRoles);

  useEffect(() => {
    (async () => {
      try {
        const targetStatus = permissions.validate ? "completed" : "in_progress";
        const [tests, staff, toAct] = await Promise.allSettled([
          fetchCatalog(),
          fetchEmployees(),
          (permissions.enterResult || permissions.validate)
            ? fetchOrders(`?status=${targetStatus}`)
            : Promise.resolve([]),
        ]);
        const len = (s) => s.status === "fulfilled" ? s.value.length : undefined;
        setCounts({
          tests: len(tests),
          staff: len(staff),
          toAct: len(toAct),
        });
      } catch { /* ignore */ }
    })();
  }, [screen, activeLab?.uuid, permissions.enterResult, permissions.validate]);

  useEffect(() => {
    if (screen === "settings" && !permissions.editSettings) setScreen("dashboard");
    if (screen === "map" && !(permissions.editStaff || permissions.editSettings)) setScreen("dashboard");
    if (screen === "analyses" && !permissions.enterResult && !permissions.validate && !permissions.editTests) {
      setScreen("dashboard");
    }
  }, [screen, permissions.editSettings, permissions.editStaff, permissions.enterResult, permissions.validate, permissions.editTests]);

  const ScreenCmp = {
    dashboard: <Dashboard user={user} lab={activeLab} roles={staffRoles} primaryRole={displayRole} permissions={permissions} />,
    analyses:  <Analyses roles={staffRoles} permissions={permissions} />,
    tests:     <Tests permissions={permissions} />,
    staff:     <Staff permissions={permissions} />,
    map:       <NursesMap lab={activeLab} />,
    settings:  <Settings permissions={permissions} lab={activeLab} />,
  }[screen];

  return (
    <div className="app">
      <Sidebar
        active={screen}
        onNavigate={setScreen}
        permissions={permissions}
        lab={activeLab}
        counts={counts}
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
