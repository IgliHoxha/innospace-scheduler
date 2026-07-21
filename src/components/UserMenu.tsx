"use client";

import { useEffect, useState } from "react";

/** Sign out: clear the session cookie, then hard-navigate to /login so no client state survives. */
async function logout(): Promise<void> {
  await fetch("/api/login", { method: "DELETE" });
  window.location.replace("/login");
}

/** Topbar avatar button with a sign-out dropdown. Closes on any outside click or Escape. */
export function UserMenu({ username }: { username: string }) {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    const onKey = (e: KeyboardEvent) =>
      e.key === "Escape" && setMenuOpen(false);
    document.addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  return (
    <div className="user-menu">
      <button
        className="user-btn"
        onClick={(e) => {
          e.stopPropagation();
          setMenuOpen((o) => !o);
        }}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
      >
        <span className="avatar">{username.charAt(0).toUpperCase()}</span>
        <span className="user-name">{username}</span>
        <span className="caret">▾</span>
      </button>
      {menuOpen && (
        <div className="user-dropdown" role="menu">
          <div className="user-dropdown-head">
            Signed in as
            <strong>{username}</strong>
          </div>
          <button className="user-dropdown-item" onClick={logout}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
