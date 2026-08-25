import { useEffect, useRef, type ReactNode } from "react";
import { SERVICE_RELEASE } from "../../server/version";
import type { SessionUser } from "../types";

export type ViewId =
  | "command"
  | "projects"
  | "roadmap"
  | "memory"
  | "migration"
  | "connections"
  | "settings";

const NAVIGATION: ReadonlyArray<{ id: ViewId; label: string; number: string }> = [
  { id: "command", label: "Command Centre", number: "01" },
  { id: "projects", label: "Projects", number: "02" },
  { id: "roadmap", label: "Roadmap", number: "03" },
  { id: "memory", label: "Library", number: "04" },
  { id: "migration", label: "Migration", number: "05" },
  { id: "connections", label: "Connections", number: "06" },
  { id: "settings", label: "Settings", number: "07" },
];

interface AppShellProps {
  activeView: ViewId;
  user: SessionUser;
  children: ReactNode;
  onNavigate: (view: ViewId) => void;
  onLogout: () => void;
}

export function AppShell({ activeView, user, children, onNavigate, onLogout }: AppShellProps) {
  const navigationRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!window.matchMedia?.("(max-width: 900px)").matches) return;
    navigationRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [activeView]);
  return (
    <div className="app-shell">
      <a className="skip-link" href="#cloud-memory-main">Skip to main content</a>
      <aside className="sidebar">
        <button className="wordmark" type="button" onClick={() => onNavigate("command")}>
          <span className="wordmark__mark" aria-hidden="true">CM</span>
          <span><strong>Cloud Memory</strong><small>Signal Room / {SERVICE_RELEASE}</small></span>
        </button>

        <nav aria-label="Primary navigation" ref={navigationRef}>
          {NAVIGATION.map((item) => (
            <button
              className={activeView === item.id ? "nav-item is-active" : "nav-item"}
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              aria-current={activeView === item.id ? "page" : undefined}
            >
              <span>{item.number}</span>{item.label}
            </button>
          ))}
        </nav>

        <div className="sidebar__identity">
          {user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : <span className="avatar-fallback">{user.login.slice(0, 2).toUpperCase()}</span>}
          <span><strong>{user.name ?? user.login}</strong><small>@{user.login}</small></span>
          <button type="button" onClick={onLogout}>Sign out</button>
        </div>
      </aside>
      <main className="workspace" id="cloud-memory-main" tabIndex={-1}>{children}</main>
    </div>
  );
}
