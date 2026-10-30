import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  type RouterHistory,
} from "@tanstack/react-router";
import { AuthPage } from "./features/auth/AuthPage";
import { Workspace } from "./features/auth/Workspace";
import { useAuth } from "./lib/auth";
import { Welcome } from "./Welcome";

function Layout() {
  const { session } = useAuth();
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="site-header">
        <Link className="brand" to="/" aria-label="Retro home">
          <svg className="brand-mark" viewBox="0 0 40 40" aria-hidden="true">
            <rect width="40" height="40" rx="12" fill="currentColor" />
            <path
              d="M12 12h16v12l-4 4H12zM24 28v-4h4M16 17h8M16 21h5"
              fill="none"
              stroke="var(--ink)"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span>
            retro<span className="brand-dot">.</span>
          </span>
        </Link>
        <span className="header-caption">A space for the Nhost team</span>
        <nav aria-label="Main navigation">
          <Link className="quiet-link" to="/" hash="how-it-works">
            The approach <span aria-hidden="true">↗</span>
          </Link>
          <Link className="quiet-link" to={session ? "/workspace" : "/auth"}>
            {session ? "Your workspace" : "Sign in"}
          </Link>
        </nav>
      </header>
      <Outlet />
      <footer className="site-footer">
        <span>Made for the Nhost team.</span>
        <span>One conversation at a time.</span>
      </footer>
    </div>
  );
}

function NotFound() {
  return (
    <main id="main-content" className="not-found" tabIndex={-1}>
      <p className="eyebrow">A small detour</p>
      <h1>This page isn’t here.</h1>
      <p>Let’s take you back to a familiar place.</p>
      <Link className="primary-link" to="/">
        Back to welcome <span aria-hidden="true">↗</span>
      </Link>
    </main>
  );
}

const rootRoute = createRootRoute({ component: Layout, notFoundComponent: NotFound });
const welcomeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: Welcome,
});
const authRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/auth",
  component: AuthPage,
});
const workspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/workspace",
  component: Workspace,
});
const routeTree = rootRoute.addChildren([welcomeRoute, authRoute, workspaceRoute]);

export function createAppRouter(history?: RouterHistory) {
  return createRouter({
    routeTree,
    history,
    defaultPreload: "intent",
    scrollRestoration: true,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
