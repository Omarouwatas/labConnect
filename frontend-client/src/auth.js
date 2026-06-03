import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import * as api from "./api";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const hydrate = useCallback(async () => {
    const access = await api.tokens.getAccess();
    if (!access) { setUser(null); setLoading(false); return; }
    try {
      const me = await api.fetchMe();
      setUser(me);
    } catch {
      await api.tokens.clear();
      setUser(null);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { hydrate(); }, [hydrate]);

  const loginWithPhone = useCallback(async (phone, code) => {
    await api.otpVerify(phone, code, "login");
    setLoading(true);
    await hydrate();
  }, [hydrate]);

  const loginWithEmail = useCallback(async (email, password) => {
    await api.emailLogin(email, password);
    setLoading(true);
    await hydrate();
  }, [hydrate]);

  const loginWithGoogle = useCallback(async (idToken) => {
    const data = await api.googleLogin(idToken);
    setLoading(true);
    await hydrate();
    return data; // { created: bool, ... } pour rediriger vers SignUp si needed
  }, [hydrate]);

  const updateProfile = useCallback(async (patch) => {
    const updated = await api.updateProfile(patch);
    setUser(updated);
    return updated;
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    setUser(null);
  }, []);

  return (
    <AuthCtx.Provider value={{
      user, loading,
      loginWithPhone, loginWithEmail, loginWithGoogle,
      updateProfile, logout, reload: hydrate,
    }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be inside <AuthProvider>");
  return ctx;
}
