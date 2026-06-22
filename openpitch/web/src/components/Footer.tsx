import { Link } from "react-router-dom";

export default function Footer() {
  return (
    <footer className="mt-auto border-t border-line px-6 py-8 text-sm text-slate-500">
      <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-3 sm:flex-row">
        <span>⚽ Play Metrics — AI soccer capture & analytics</span>
        <nav className="flex gap-4">
          <Link to="/features" className="hover:text-slate-300">
            Features
          </Link>
          <Link to="/pricing" className="hover:text-slate-300">
            Pricing
          </Link>
          <Link to="/" className="hover:text-slate-300">
            Sign in
          </Link>
        </nav>
      </div>
      <p className="mx-auto mt-4 max-w-5xl text-xs text-slate-600">
        Prototype — self-hosted. Not affiliated with any commercial provider.
      </p>
    </footer>
  );
}
