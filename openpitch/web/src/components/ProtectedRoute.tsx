import { Navigate } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "../auth/AuthContext";

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return <div className="p-10 text-center text-slate-400">Loading…</div>;
  }
  return user ? <>{children}</> : <Navigate to="/" replace />;
}
