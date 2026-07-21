"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Reservation, ReservationStatus } from "@/lib/types";
import type { ReservationPage } from "@/lib/db";
import { PAGE_SIZE, INITIAL_FILTER } from "@/lib/pagination";
import { SiteFooter } from "@/components/SiteFooter";
import {
  boothLabel,
  emailBodyText,
  emailSubject,
  timeText,
  dateOfReservation,
} from "@/lib/templates";
import type { ContactInfo } from "@/lib/types";
import { formatDMYShort, formatDateTime } from "@/lib/date-format";

const FILTERS: { key: "all" | ReservationStatus; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pending", label: "Awaiting approval" },
  { key: "confirmed", label: "Confirmed" },
  { key: "cancelled", label: "Cancelled" },
  { key: "deleted", label: "Deleted" },
];

export default function DashboardClient({
  initialData,
  username,
  contact,
}: {
  initialData: ReservationPage;
  username: string;
  contact: ContactInfo;
}) {
  const router = useRouter();
  const [data, setData] = useState<ReservationPage>(initialData);
  const [filter, setFilter] = useState<"all" | ReservationStatus>(
    INITIAL_FILTER,
  );
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmPurge, setConfirmPurge] = useState(false);
  // Per-reservation edited cancellation email bodies (id -> body).
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<{
    id: string;
    name: string;
    email: string;
    status: Exclude<ReservationStatus, "pending">;
    body: string;
  } | null>(null);

  const reservations = data.reservations;
  const counts = data.counts;
  const total = data.total;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function draftFor(r: Reservation): string {
    return drafts[r.id] ?? emailBodyText(r, "cancelled", contact);
  }

  const reqId = useRef(0);
  const loadPage = useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true);
    const params = new URLSearchParams({
      status: filter,
      q: debouncedQuery,
      page: String(page),
      pageSize: String(PAGE_SIZE),
    });
    try {
      const res = await fetch(`/api/reservations?${params.toString()}`);
      const json = (await res.json()) as ReservationPage & { ok: boolean };
      if (id !== reqId.current) return;
      if (!json.ok) return;
      const tp = Math.max(1, Math.ceil(json.total / PAGE_SIZE));
      if (page > tp) {
        setPage(tp);
        return;
      }
      setData(json);
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [filter, debouncedQuery, page]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    setPage(1);
  }, [filter, debouncedQuery]);

  const didMount = useRef(false);
  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      return;
    }
    loadPage();
  }, [loadPage]);

  async function setStatus(
    id: string,
    status: ReservationStatus,
    emailBody?: string,
  ) {
    await fetch(`/api/reservations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, emailBody }),
    });
    loadPage();
  }

  async function logout() {
    await fetch("/api/login", { method: "DELETE" });
    router.replace("/login");
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allVisibleSelected =
    reservations.length > 0 && reservations.every((r) => selected.has(r.id));

  function toggleSelectAll() {
    setSelected(
      allVisibleSelected ? new Set() : new Set(reservations.map((r) => r.id)),
    );
  }

  async function deleteForever() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setSelected(new Set());
    setConfirmPurge(false);
    await fetch("/api/reservations", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    loadPage();
  }

  useEffect(() => {
    setSelected(new Set());
  }, [filter, debouncedQuery, page]);

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
            <a className="nav-link" href="/users">
              Users
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
        <div className="page-head">
          <div>
            <span className="eyebrow">Innospace Tirana</span>
            <h1 className="page-title">Bookings</h1>
          </div>
          <a className="btn" href="/users">
            + Add / manage members
          </a>
        </div>
        <div className="stats">
          <Stat
            num={counts.total}
            label="Total"
            active={filter === "all"}
            onClick={() => setFilter("all")}
          />
          <Stat
            num={counts.pending}
            label="Awaiting"
            active={filter === "pending"}
            onClick={() => setFilter("pending")}
          />
          <Stat
            num={counts.confirmed}
            label="Confirmed"
            active={filter === "confirmed"}
            onClick={() => setFilter("confirmed")}
          />
          <Stat
            num={counts.cancelled}
            label="Cancelled"
            active={filter === "cancelled"}
            onClick={() => setFilter("cancelled")}
          />
          <Stat
            num={counts.deleted}
            label="Deleted"
            active={filter === "deleted"}
            onClick={() => setFilter("deleted")}
          />
        </div>

        <div className="toolbar">
          <input
            id="search"
            name="search"
            type="search"
            placeholder="Search name, email, booth, note…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {FILTERS.map((f) => (
            <button
              key={f.key}
              className={`chip ${filter === f.key ? "active" : ""}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>

        {filter === "deleted" && reservations.length > 0 && (
          <div className="bulk-bar">
            <label className="bulk-select">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={toggleSelectAll}
              />
              Select all
            </label>
            <span className="bulk-count">{selected.size} selected</span>
            <button
              className="btn danger"
              disabled={selected.size === 0}
              onClick={() => setConfirmPurge(true)}
            >
              Delete permanently
            </button>
          </div>
        )}

        <div className="card" aria-busy={loading}>
          {reservations.length === 0 ? (
            <div className="empty">
              {loading ? "Loading…" : "No bookings to show."}
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  {filter === "deleted" && (
                    <th>
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={toggleSelectAll}
                        aria-label="Select all"
                      />
                    </th>
                  )}
                  <th>Booked at</th>
                  <th>Member</th>
                  <th>Booth</th>
                  <th>Date</th>
                  <th>Time</th>
                  <th>Note</th>
                  <th>Status</th>
                  <th>Email</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {reservations.map((r) => (
                  <tr key={r.id}>
                    {filter === "deleted" && (
                      <td>
                        <input
                          type="checkbox"
                          checked={selected.has(r.id)}
                          onChange={() => toggleSelected(r.id)}
                          aria-label={`Select booking ${r.fullName || r.id}`}
                        />
                      </td>
                    )}
                    <td>
                      <WhenCell iso={r.createdAt} />
                    </td>
                    <td className="who">
                      <strong>{r.fullName || "-"}</strong>
                      {r.email && (
                        <small>
                          <a href={`mailto:${r.email}`}>{r.email}</a>
                        </small>
                      )}
                    </td>
                    <td>{boothLabel(r)}</td>
                    <td className="dates">
                      {formatDMYShort(dateOfReservation(r))}
                    </td>
                    <td className="dates">{timeText(r)}</td>
                    <td style={{ maxWidth: 200 }}>{r.note || "-"}</td>
                    <td>
                      <span className={`badge ${r.status}`}>{r.status}</span>
                    </td>
                    <td>
                      <EmailPreview
                        reservation={r}
                        draft={drafts[r.id]}
                        contact={contact}
                        onChange={(value) =>
                          setDrafts((d) => ({ ...d, [r.id]: value }))
                        }
                      />
                    </td>
                    <td>
                      <div className="actions">
                        {r.status === "pending" && (
                          <button
                            className="icon-btn tick"
                            title="Approve booking"
                            aria-label="Approve booking"
                            onClick={() =>
                              setPending({
                                id: r.id,
                                name: r.fullName || "",
                                email: r.email || "",
                                status: "confirmed",
                                body: "",
                              })
                            }
                          >
                            ✓
                          </button>
                        )}
                        <button
                          className="icon-btn cross"
                          title={
                            r.status === "pending"
                              ? "Reject booking"
                              : "Cancel booking"
                          }
                          aria-label={
                            r.status === "pending"
                              ? "Reject booking"
                              : "Cancel booking"
                          }
                          disabled={
                            r.status !== "confirmed" && r.status !== "pending"
                          }
                          onClick={() =>
                            setPending({
                              id: r.id,
                              name: r.fullName || "",
                              email: r.email || "",
                              status: "cancelled",
                              body: draftFor(r),
                            })
                          }
                        >
                          ✕
                        </button>
                        <button
                          className="icon-btn trash"
                          title="Delete booking"
                          aria-label="Delete booking"
                          disabled={r.status === "deleted"}
                          onClick={() =>
                            setPending({
                              id: r.id,
                              name: r.fullName || "",
                              email: r.email || "",
                              status: "deleted",
                              body: "",
                            })
                          }
                        >
                          🗑
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {total > 0 && (
          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            pageSize={PAGE_SIZE}
            shown={reservations.length}
            loading={loading}
            onPage={setPage}
          />
        )}
      </div>

      {confirmPurge && (
        <div
          className="modal-overlay"
          onClick={() => setConfirmPurge(false)}
          role="presentation"
        >
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <h2>Delete permanently?</h2>
            <p>
              This will permanently remove{" "}
              <strong>
                {selected.size} booking{selected.size === 1 ? "" : "s"}
              </strong>{" "}
              from the database. This cannot be undone.
            </p>
            <div className="modal-actions">
              <button
                className="btn ghost"
                onClick={() => setConfirmPurge(false)}
              >
                No
              </button>
              <button className="btn danger" onClick={deleteForever}>
                Yes, delete permanently
              </button>
            </div>
          </div>
        </div>
      )}

      {pending && (
        <div
          className="modal-overlay"
          onClick={() => setPending(null)}
          role="presentation"
        >
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <h2>
              {pending.status === "confirmed"
                ? "Approve booking?"
                : pending.status === "cancelled"
                  ? "Cancel booking?"
                  : "Delete booking?"}
            </h2>
            <p>
              {pending.status === "confirmed"
                ? "Approve"
                : pending.status === "cancelled"
                  ? "Cancel"
                  : "Delete"}{" "}
              the booking
              {pending.name ? (
                <>
                  {" "}
                  for <strong>{pending.name}</strong>
                </>
              ) : null}
              ?
              {pending.status === "deleted"
                ? " It will be hidden from the list (no email is sent)."
                : pending.status === "confirmed"
                  ? pending.email
                    ? ` A confirmation email will be sent to ${pending.email}.`
                    : " (No email on file - nothing will be sent.)"
                  : pending.email
                    ? ` The cancellation email (as shown in the Email column) will be sent to ${pending.email}.`
                    : " (No email on file - nothing will be sent.)"}
            </p>
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setPending(null)}>
                No
              </button>
              <button
                className={
                  pending.status === "confirmed" ? "btn" : "btn danger"
                }
                onClick={() => {
                  setStatus(
                    pending.id,
                    pending.status,
                    pending.status === "confirmed" ? undefined : pending.body,
                  );
                  setPending(null);
                }}
              >
                Yes,{" "}
                {pending.status === "confirmed"
                  ? "approve"
                  : pending.status === "cancelled"
                    ? "cancel"
                    : "delete"}
              </button>
            </div>
          </div>
        </div>
      )}
      <SiteFooter />
    </>
  );
}

// Compact list of page numbers with ellipses, e.g. 1 … 4 5 [6] 7 8 … 20.
function pageList(page: number, totalPages: number): (number | "…")[] {
  const out: (number | "…")[] = [];
  const push = (n: number) => out.push(n);
  const window = 1;
  const last = totalPages;
  for (let p = 1; p <= last; p++) {
    if (p === 1 || p === last || (p >= page - window && p <= page + window)) {
      push(p);
    } else if (out[out.length - 1] !== "…") {
      out.push("…");
    }
  }
  return out;
}

function Pagination({
  page,
  totalPages,
  total,
  pageSize,
  shown,
  loading,
  onPage,
}: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  shown: number;
  loading: boolean;
  onPage: (p: number) => void;
}) {
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastRow = (page - 1) * pageSize + shown;
  return (
    <div className="pagination">
      <span className="pagination-info">
        {first}–{lastRow} of {total}
        {loading ? " · loading…" : ""}
      </span>
      {totalPages > 1 && (
        <div className="pagination-controls">
          <button
            className="page-btn"
            disabled={page <= 1}
            onClick={() => onPage(page - 1)}
            aria-label="Previous page"
          >
            ‹ Prev
          </button>
          {pageList(page, totalPages).map((p, i) =>
            p === "…" ? (
              <span key={`gap-${i}`} className="page-gap">
                …
              </span>
            ) : (
              <button
                key={p}
                className={`page-btn ${p === page ? "active" : ""}`}
                aria-current={p === page ? "page" : undefined}
                onClick={() => onPage(p)}
              >
                {p}
              </button>
            ),
          )}
          <button
            className="page-btn"
            disabled={page >= totalPages}
            onClick={() => onPage(page + 1)}
            aria-label="Next page"
          >
            Next ›
          </button>
        </div>
      )}
    </div>
  );
}

function Stat({
  num,
  label,
  active,
  onClick,
}: {
  num: number;
  label: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className={`stat ${active ? "active" : ""}`}
      onClick={onClick}
    >
      <div className="num">{num}</div>
      <div className="label">{label}</div>
    </button>
  );
}

// Client-only timestamp render to avoid a server/client hydration mismatch.
function WhenCell({ iso }: { iso: string }) {
  const [text, setText] = useState("");
  useEffect(() => {
    setText(formatDateTime(iso));
  }, [iso]);
  return (
    <span className="dates" suppressHydrationWarning>
      {text || "-"}
    </span>
  );
}

/** Per-row editable cancellation email (only relevant while confirmed). */
function EmailPreview({
  reservation,
  draft,
  contact,
  onChange,
}: {
  reservation: Reservation;
  draft: string | undefined;
  contact: ContactInfo;
  onChange: (value: string) => void;
}) {
  if (reservation.status === "deleted") {
    return <span className="muted">-</span>;
  }

  if (reservation.status === "cancelled") {
    const value = draft ?? emailBodyText(reservation, "cancelled", contact);
    return (
      <div className="email-preview">
        <div className="email-sent cancelled">Cancellation sent</div>
        <div className="email-subject">
          Subject: {emailSubject("cancelled", contact, reservation)}
        </div>
        <textarea
          className="email-text"
          rows={7}
          value={value}
          readOnly
          aria-label="cancellation email body (sent)"
        />
      </div>
    );
  }

  const value = draft ?? emailBodyText(reservation, "cancelled", contact);
  return (
    <div className="email-preview">
      <div className="email-sent cancelled">Cancellation email</div>
      <div className="email-subject">
        Subject: {emailSubject("cancelled", contact, reservation)}
      </div>
      <textarea
        className="email-text"
        rows={7}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="cancellation email body"
      />
    </div>
  );
}
