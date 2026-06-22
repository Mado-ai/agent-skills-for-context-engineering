import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import AccountModal from "./AccountModal";

export default function Nav() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [accountOpen, setAccountOpen] = useState(false);

  return (
    <nav className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-ink-2 px-6 py-3.5">
      {accountOpen && user && (
        <AccountModal email={user.email} onClose={() => setAccountOpen(false)} />
      )}
      <Link to="/" className="text-lg font-bold">
        ⚽ Play<span className="text-pitch">Metrics</span>
      </Link>
      <div className="flex items-center gap-4 text-sm">
        {!user && (
          <>
            <Link to="/features" className="hidden text-slate-300 hover:text-white sm:block">
              Features
            </Link>
            <Link to="/hardware" className="hidden text-slate-300 hover:text-white sm:block">
              Hardware
            </Link>
            <Link to="/pricing" className="hidden text-slate-300 hover:text-white sm:block">
              Pricing
            </Link>
            <Link to="/about" className="hidden text-slate-300 hover:text-white sm:block">
              About
            </Link>
          </>
        )}
        {user ? (
          <>
            <Link to="/dashboard" className="text-slate-300 hover:text-white">
              Dashboard
            </Link>
            <Link to="/teams" className="text-slate-300 hover:text-white">
              Teams
            </Link>
            <button
              onClick={() => setAccountOpen(true)}
              className="hidden text-slate-400 hover:text-white sm:inline"
            >
              {user.email}
              {user.is_admin && " · admin"}
            </button>
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
