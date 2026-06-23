import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, tokenStore } from "../api/client";
import type { User } from "../types";

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  // Only "loading" if there's a stored token to verify on mount.
  const [loading, setLoading] = useState(() => Boolean(tokenStore.get()));

  useEffect(() => {
    // OAuth callback returns the browser to /?token=<jwt>; capture and strip it.
    const url = new URL(window.location.href);
    const urlToken = url.searchParams.get("token");
    if (urlToken) {
      tokenStore.set(urlToken);
      url.searchParams.delete("token");
      url.searchParams.delete("oauth_error");
      window.history.replaceState({}, "", url.pathname + url.search + url.hash);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(true);
    }
    if (!tokenStore.get()) return;
    // Async session restore; setState runs in the promise callbacks below.
    api
      .me()
      .then((u) => {
        setUser(u);
        void api.fetchMediaToken();
      })
      .catch(() => tokenStore.clear())
      .finally(() => setLoading(false));
  }, []);

  const finishAuth = async (token: string) => {
    tokenStore.set(token);
    setUser(await api.me());
    await api.fetchMediaToken();
  };

  const value: AuthState = {
    user,
    loading,
    login: async (email, password) => finishAuth((await api.login(email, password)).token),
    register: async (email, password) => finishAuth((await api.register(email, password)).token),
    logout: () => {
      tokenStore.clear();
      setUser(null);
    },
  };

  return <AuthContext value={value}>{children}</AuthContext>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
