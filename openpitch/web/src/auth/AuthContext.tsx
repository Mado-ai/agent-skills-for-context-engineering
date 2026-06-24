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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Session lives in an HttpOnly cookie (not readable from JS), so we always
    // ask the server who we are; same-origin fetch sends the cookie.
    api
      .me()
      .then((u) => {
        setUser(u);
        void api.fetchMediaToken();
      })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const finishAuth = async () => {
    // The login/register/oauth responses set the HttpOnly cookie server-side;
    // we just refresh identity from it.
    setUser(await api.me());
    await api.fetchMediaToken();
  };

  const value: AuthState = {
    user,
    loading,
    login: async (email, password) => { await api.login(email, password); await finishAuth(); },
    register: async (email, password) => { await api.register(email, password); await finishAuth(); },
    logout: () => {
      void api.logout();
      tokenStore.clear(); // clear any legacy localStorage token
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
