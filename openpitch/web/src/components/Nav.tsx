import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export default function Nav() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <nav className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-ink-2 px-6 py-3.5">
      <Link to="/" className="text-lg font-bold">
        ⚽ Play<span className="text-pitch">Metrics</span>
      </Link>
      <div className="flex items-center gap-4 text-sm">
        {!user && (
          <>
            <Link to="/features" className="hidden text-slate-300 hover:text-white sm:block">
              Features
            </Link>
            <Link to="/pricing" className="hidden text-slate-300 hover:text-white sm:block">
              Pricing
            </Link>
          </>
        )}
        {user ? (
          <>
            <Link to="/dashboard" className="text-slate-300 hover:text-white">
              Dashboard
            </Link>
            <span className="hidden text-slate-400 sm:inline">
              {user.email}
              {user.is_admin && " · admin"}
            </span>
            <button
              onClick={() => {
                logout();
                navigate("/");
              }}
              className="rounded-lg px-3 py-1.5 text-slate-300 hover:bg-line"
            >
              Log out
            </button>
          </>
        ) : (
          <Link to="/" className="rounded-lg bg-line px-4 py-2 text-white">
            Sign in
          </Link>
        )}
      </div>
    </nav>
  );
}
