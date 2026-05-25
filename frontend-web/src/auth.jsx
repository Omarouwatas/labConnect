import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { fetchMe, fetchMyLabs, logout as apiLogout, tokens, labScope, staffLogin, googleLogin as apiGoogleLogin } from "./api";
import { STAFF_ROLES_FOR_WEB, primaryRole } from "./constants";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [labs, setLabs] = useState([]);
  const [activeLab, setActiveLabState] = useState(null);
  const [loading, setLoading] = useState(true);

  // Les rôles staff de l'utilisateur (union, jamais filtrés à un seul).
  const staffRoles = (user?.roles || []).filter((r) => STAFF_ROLES_FOR_WEB.includes(r));
  // Rôle "primaire" — sert UNIQUEMENT à choisir une icône / un libellé.
  // Les permissions sont toujours l'UNION via `permissionsFor(staffRoles)`.
  const displayRole = primaryRole(staffRoles);

  const setActiveLab = useCallback((lab) => {
    setActiveLabState(lab);
    labScope.set(lab?.uuid || null);
  }, []);

  const hydrate = useCallback(async () => {
    if (!tokens.access) {
      setUser(null); setLabs([]); setActiveLabState(null);
      setLoading(false);
      return;
    }
    // me + labs sont indépendants : on les charge en parallèle.
    // fetchMyLabs peut échouer (ex. patient sans labos) sans invalider la session.
    const [meRes, labsRes] = await Promise.allSettled([fetchMe(), fetchMyLabs()]);
    if (meRes.status === "rejected") {
      tokens.clear();
      setUser(null); setLabs([]); setActiveLabState(null);
      setLoading(false);
      return;
    }
    setUser(meRes.value);
    const arr = labsRes.status === "fulfilled" ? labsRes.value : [];
    setLabs(arr);
    const stored = labScope.uuid;
    const next = arr.find((l) => l.uuid === stored) || arr[0] || null;
    setActiveLabState(next);
    labScope.set(next?.uuid || null);
    setLoading(false);
  }, []);

  useEffect(() => { hydrate(); }, [hydrate]);

  const login = useCallback(async (email, password) => {
    await staffLogin(email, password);
    setLoading(true);
    await hydrate();
  }, [hydrate]);

  const googleLogin = useCallback(async (idToken) => {
    await apiGoogleLogin(idToken);
    setLoading(true);
    await hydrate();
  }, [hydrate]);

  const logout = useCallback(async () => {
    await apiLogout();
    labScope.set(null);
    setUser(null); setLabs([]); setActiveLabState(null);
  }, []);

  return (
    <AuthCtx.Provider value={{
      user,
      labs, activeLab, setActiveLab,
      lab: activeLab, // legacy alias
      // Rôles : union systématique, jamais filtrée par un sélecteur
      roles: staffRoles,
      primaryRole: displayRole,
      // Legacy aliases — pour les écrans qui n'ont pas encore migré
      activeRole: displayRole,
      setActiveRole: () => { /* noop : on ne restreint plus les permissions */ },
      loading, login, googleLogin, logout,
      reload: hydrate,
    }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
