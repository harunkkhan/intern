"use client";

import { useState } from "react";
import { doSignOut } from "@/app/actions";
import Logo from "@/components/Logo";

export type View =
  | "dashboard"
  | "analytics"
  | "behavioral"
  | "postings"
  | "alerts"
  | "settings";

export default function Sidebar({
  view,
  onNavigate,
}: {
  view: View;
  onNavigate: (view: View) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-neutral-200 bg-white px-4 py-3 md:hidden dark:border-neutral-800 dark:bg-neutral-900">
        <Logo className="pl-1 text-xl text-neutral-900 dark:text-neutral-100" />
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          title="Open menu"
          aria-label="Open menu"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
        >
          <MenuIcon />
        </button>
      </header>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <aside className="absolute left-0 top-0 flex h-full w-64 max-w-[80%] flex-col border-r border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
            <div className="flex items-center justify-between px-3 py-4">
              <Logo className="pl-1 text-2xl text-neutral-900 dark:text-neutral-100" />
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                title="Close menu"
                aria-label="Close menu"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
              >
                <CloseIcon />
              </button>
            </div>
            <Nav
              view={view}
              collapsed={false}
              onNavigate={(v) => {
                onNavigate(v);
                setMobileOpen(false);
              }}
            />
            <SignOut collapsed={false} />
          </aside>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside
        className={`sticky top-0 hidden h-screen shrink-0 flex-col border-r border-neutral-200 bg-white transition-[width] duration-200 md:flex dark:border-neutral-800 dark:bg-neutral-900 ${
          collapsed ? "w-14" : "w-60"
        }`}
      >
        <div
          className={`flex items-center px-3 py-4 ${
            collapsed ? "justify-center" : "justify-between"
          }`}
        >
          {collapsed ? (
            <div className="group relative flex h-8 w-full items-center justify-center">
              <Logo className="text-2xl text-neutral-900 transition group-hover:opacity-0 dark:text-neutral-100" />
              <button
                type="button"
                onClick={() => setCollapsed(false)}
                title="Expand sidebar"
                aria-label="Expand sidebar"
                className="absolute inset-0 flex items-center justify-center rounded-lg text-neutral-500 opacity-0 transition hover:bg-neutral-100 hover:text-neutral-900 group-hover:opacity-100 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
              >
                <PanelIcon />
              </button>
            </div>
          ) : (
            <>
              <Logo className="pl-1 text-2xl text-neutral-900 dark:text-neutral-100" />
              <button
                type="button"
                onClick={() => setCollapsed(true)}
                title="Collapse sidebar"
                aria-label="Collapse sidebar"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
              >
                <PanelIcon />
              </button>
            </>
          )}
        </div>

        <Nav view={view} collapsed={collapsed} onNavigate={onNavigate} />

        <SignOut collapsed={collapsed} />
      </aside>
    </>
  );
}

function Nav({
  view,
  collapsed,
  onNavigate,
}: {
  view: View;
  collapsed: boolean;
  onNavigate: (view: View) => void;
}) {
  return (
    <nav className="flex flex-col gap-1 px-3">
      <NavItem
        label="Dashboard"
        active={view === "dashboard"}
        collapsed={collapsed}
        onClick={() => onNavigate("dashboard")}
        icon={<DashboardIcon />}
      />
      <NavItem
        label="Analytics"
        active={view === "analytics"}
        collapsed={collapsed}
        onClick={() => onNavigate("analytics")}
        icon={<AnalyticsIcon />}
      />
      <NavItem
        label="Behavioral"
        active={view === "behavioral"}
        collapsed={collapsed}
        onClick={() => onNavigate("behavioral")}
        icon={<BehavioralIcon />}
      />
      <NavItem
        label="Postings"
        active={view === "postings"}
        collapsed={collapsed}
        onClick={() => onNavigate("postings")}
        icon={<PostingsIcon />}
      />
      <NavItem
        label="Alerts"
        active={view === "alerts"}
        collapsed={collapsed}
        onClick={() => onNavigate("alerts")}
        icon={<BellIcon />}
      />
      <NavItem
        label="Settings"
        active={view === "settings"}
        collapsed={collapsed}
        onClick={() => onNavigate("settings")}
        icon={<SettingsIcon />}
      />
    </nav>
  );
}

function SignOut({ collapsed }: { collapsed: boolean }) {
  return (
    <div className="mt-auto border-t border-neutral-200 p-3 dark:border-neutral-800">
      <form action={doSignOut}>
        <button
          type="submit"
          title="Sign out"
          className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100 ${
            collapsed ? "justify-center" : ""
          }`}
        >
          <LogoutIcon />
          {!collapsed && "Sign out"}
        </button>
      </form>
    </div>
  );
}

function NavItem({
  label,
  active,
  collapsed,
  onClick,
  icon,
}: {
  label: string;
  active: boolean;
  collapsed: boolean;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
        collapsed ? "justify-center" : ""
      } ${
        active
          ? "bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
          : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
      }`}
    >
      {icon}
      {!collapsed && label}
    </button>
  );
}

function MenuIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

function DashboardIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </svg>
  );
}

function AnalyticsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <path d="M3 3v16a2 2 0 0 0 2 2h16" />
      <path d="M7 16v-5M12 16V8M17 16v-3" />
    </svg>
  );
}

function BehavioralIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <path d="M9.1 8.5a2.9 2.9 0 0 1 5.6 1c0 2-2.9 2.9-2.9 2.9" />
      <path d="M12 15.5h.01" />
    </svg>
  );
}

function PostingsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <path d="M15 22H5a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h11l5 5v5" />
      <path d="M15 2v5h5" />
      <path d="M8 12h5M8 16h3" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <path d="M10.268 21a2 2 0 0 0 3.464 0" />
      <path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function PanelIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <rect x="3" y="3" width="20" height="20" rx="2" />
      <path d="M9 3v18" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5M21 12H9" />
    </svg>
  );
}
