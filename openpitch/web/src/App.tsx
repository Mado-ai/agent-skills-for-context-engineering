import { lazy, Suspense } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import Nav from "./components/Nav";
import Footer from "./components/Footer";
import ProtectedRoute from "./components/ProtectedRoute";
import Landing from "./pages/Landing";

// Code-split heavier / less-visited routes so the landing page stays light.
// The Dashboard pulls in Recharts, so it gets its own chunk.
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Features = lazy(() => import("./pages/Features"));
const Hardware = lazy(() => import("./pages/Hardware"));
const Pricing = lazy(() => import("./pages/Pricing"));
const About = lazy(() => import("./pages/About"));
const Orgs = lazy(() => import("./pages/Orgs"));
const OrgDetail = lazy(() => import("./pages/OrgDetail"));
const Sites = lazy(() => import("./pages/Sites"));
const SiteDetail = lazy(() => import("./pages/SiteDetail"));
const Teams = lazy(() => import("./pages/Teams"));
const TeamProfile = lazy(() => import("./pages/TeamProfile"));
const PlayerProfile = lazy(() => import("./pages/PlayerProfile"));
const PublicProfile = lazy(() => import("./pages/PublicProfile"));
const Compare = lazy(() => import("./pages/Compare"));
const Report = lazy(() => import("./pages/Report"));

function Loading() {
  return <div className="p-10 text-center text-slate-400">Loading…</div>;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <div className="flex min-h-full flex-col">
          <Nav />
          <main className="flex-1">
            <Suspense fallback={<Loading />}>
              <Routes>
                <Route path="/" element={<Landing />} />
                <Route path="/features" element={<Features />} />
                <Route path="/hardware" element={<Hardware />} />
                <Route path="/pricing" element={<Pricing />} />
                <Route path="/about" element={<About />} />
                <Route path="/share/team/:token" element={<PublicProfile kind="team" />} />
                <Route path="/share/player/:token" element={<PublicProfile kind="player" />} />
                <Route
                  path="/dashboard"
                  element={
                    <ProtectedRoute>
                      <Dashboard />
                    </ProtectedRoute>
                  }
                />
                <Route path="/orgs" element={<ProtectedRoute><Orgs /></ProtectedRoute>} />
                <Route path="/orgs/:id" element={<ProtectedRoute><OrgDetail /></ProtectedRoute>} />
                <Route path="/sites" element={<ProtectedRoute><Sites /></ProtectedRoute>} />
                <Route path="/sites/:id" element={<ProtectedRoute><SiteDetail /></ProtectedRoute>} />
                <Route path="/teams" element={<ProtectedRoute><Teams /></ProtectedRoute>} />
                <Route path="/compare" element={<ProtectedRoute><Compare /></ProtectedRoute>} />
                <Route path="/teams/:id" element={<ProtectedRoute><TeamProfile /></ProtectedRoute>} />
                <Route path="/players/:id" element={<ProtectedRoute><PlayerProfile /></ProtectedRoute>} />
                <Route path="/report/player/:id" element={<ProtectedRoute><Report kind="player" /></ProtectedRoute>} />
                <Route path="/report/team/:id" element={<ProtectedRoute><Report kind="team" /></ProtectedRoute>} />
              </Routes>
            </Suspense>
          </main>
          <Footer />
        </div>
      </AuthProvider>
    </BrowserRouter>
  );
}
