"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MAX_EMAIL, type User } from "@/lib/types";
import { SiteFooter } from "@/components/SiteFooter";

export default function UsersClient({
  initialUsers,
  username,
}: {
  initialUsers: User[];
  username: string;
}) {
  const router = useRouter();
  const [users, setUsers] = useState<User[]>(initialUsers);
  const [menuOpen, setMenuOpen] = useState(false);

  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<User | null>(null);

  async function refresh() {
    const res = await fetch("/api/users");
    const json = (await res.json()) as { ok: boolean; users?: User[] };
    if (json.ok && json.users) setUsers(json.users);
  }

  /** Invite by email (also used to resend a pending invite). */
  async function sendInvite(toEmail: string): Promise<boolean> {
    setError("");
    setNotice("");
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: toEmail }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      ok: boolean;
      error?: string;
    };
    if (res.ok && json.ok) {
      setNotice(`Invite sent to ${toEmail}.`);
      await refresh();
      return true;
    }
    setError(json.error || "Could not send the invite.");
    return false;
  }

  async function addUser(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      if (await sendInvite(email.trim())) setEmail("");
    } finally {
      setSaving(false);
    }
  }

  async function resend(u: User) {
    setResendingId(u.id);
    try {
      await sendInvite(u.email);
    } finally {
      setResendingId(null);
    }
  }

  async function remove(u: User) {
    setRemoveTarget(null);
    await fetch(`/api/users/${u.id}`, { method: "DELETE" });
    await refresh();
  }

  async function logout() {
    await fetch("/api/login", { method: "DELETE" });
    router.replace("/login");
  }

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
    <>
      <div className="topbar">
        <div className="topbar-inner">
          <a
            className="brand"
            href="/dashboard"
            aria-label="Scheduler dashboard"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="topbar-logo"
              src="/logo.svg"
              alt="Innospace Tirana"
            />
            <span className="brand-sub">Scheduler</span>
          </a>
          <div className="topbar-right">
            <a className="nav-link" href="/dashboard">
              Reservations
            </a>
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
                <span className="avatar">
                  {username.charAt(0).toUpperCase()}
                </span>
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
          </div>
        </div>
      </div>

      <div className="container">
        <h1 className="page-title">Members</h1>
        <p className="page-subtitle">
          Invite a member by email. They&apos;ll get a link to choose their own
          name and password, then sign in to reserve booths.
        </p>

        <form className="card add-user" onSubmit={addUser}>
          <div className="add-user-fields">
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="off"
              maxLength={MAX_EMAIL}
              required
            />
            <button className="btn" type="submit" disabled={saving}>
              {saving ? "Sending…" : "Send invite"}
            </button>
          </div>
          {error && <p className="error">{error}</p>}
          {notice && <p className="success">{notice}</p>}
        </form>

        <div className="card">
          {users.length === 0 ? (
            <div className="empty">No members yet. Add one above.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Status</th>
                  <th>Added</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      {u.name ? (
                        <strong>{u.name}</strong>
                      ) : (
                        <span className="muted">-</span>
                      )}
                    </td>
                    <td>
                      <a href={`mailto:${u.email}`}>{u.email}</a>
                    </td>
                    <td>
                      <span
                        className={`badge ${u.activated ? "confirmed" : "pending"}`}
                      >
                        {u.activated ? "Active" : "Invited"}
                      </span>
                    </td>
                    <td className="dates">
                      <WhenCell iso={u.createdAt} />
                    </td>
                    <td>
                      <div className="actions">
                        {!u.activated && (
                          <button
                            className="btn ghost sm"
                            disabled={resendingId === u.id}
                            onClick={() => resend(u)}
                          >
                            {resendingId === u.id ? "Sending…" : "Resend"}
                          </button>
                        )}
                        <button
                          className="btn ghost sm"
                          onClick={() => setRemoveTarget(u)}
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {removeTarget && (
        <div
          className="modal-overlay"
          onClick={() => setRemoveTarget(null)}
          role="presentation"
        >
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <h2>Remove member?</h2>
            <p>
              Remove <strong>{removeTarget.name || removeTarget.email}</strong>
              {removeTarget.name ? ` (${removeTarget.email})` : ""}?{" "}
              {removeTarget.activated
                ? "They will no longer be able to sign in. Their existing reservations are kept."
                : "Their pending invite will stop working."}
            </p>
            <div className="modal-actions">
              <button
                className="btn ghost"
                onClick={() => setRemoveTarget(null)}
              >
                No
              </button>
              <button
                className="btn danger"
                onClick={() => remove(removeTarget)}
              >
                Yes, remove
              </button>
            </div>
          </div>
        </div>
      )}
      <SiteFooter />
    </>
  );
}

function WhenCell({ iso }: { iso: string }) {
  const [text, setText] = useState("");
  useEffect(() => {
    const dt = new Date(iso);
    if (!Number.isNaN(dt.getTime())) {
      const pad = (n: number) => String(n).padStart(2, "0");
      setText(
        `${pad(dt.getDate())}/${pad(dt.getMonth() + 1)}/${String(dt.getFullYear()).slice(2)}`,
      );
    }
  }, [iso]);
  return <span suppressHydrationWarning>{text || "-"}</span>;
}
