"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isActiveStatus, MAX_EMAIL_BODY } from "@/lib/types";
import type {
  Booth,
  ContactInfo,
  CountedReservationPage,
  Reservation,
  ReservationFilter,
  ReservationPage,
  ReservationStatus,
} from "@/lib/types";
import {
  PAGE_SIZE,
  INITIAL_FILTER,
  pageCount,
  pageList,
} from "@/lib/pagination";
import { SiteFooter } from "@/components/SiteFooter";
import { Topbar } from "@/components/Topbar";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useTooltip } from "@/components/ui/tooltip";
import { CheckIcon, CrossIcon, TrashIcon } from "@/components/ui/icons";
import {
  boothLabel,
  boothNameIn,
  emailBodyText,
  emailSubject,
  timeText,
  dateOfReservation,
  type BoothNamer,
} from "@/lib/templates";
import { formatDMYShort, formatDateTime } from "@/lib/datetime";

const FILTERS: {
  key: ReservationFilter;
  label: string;
  stat: string;
}[] = [
  { key: "all", label: "All", stat: "Total" },
  { key: "pending", label: "Awaiting approval", stat: "Awaiting" },
  { key: "confirmed", label: "Confirmed", stat: "Confirmed" },
  { key: "cancelled", label: "Cancelled", stat: "Cancelled" },
  { key: "deleted", label: "Deleted", stat: "Deleted" },
];

type PendingStatus = Exclude<ReservationStatus, "pending">;

interface PendingAction {
  id: string;
  name: string;
  email: string;
  status: PendingStatus;
  body: string;
}

const ACTION_COPY: Record<
  PendingStatus,
  { title: string; lead: string; verb: string }
> = {
  confirmed: {
    title: "Approve reservation?",
    lead: "Approve",
    verb: "approve",
  },
  cancelled: { title: "Cancel reservation?", lead: "Cancel", verb: "cancel" },
  deleted: { title: "Delete reservation?", lead: "Delete", verb: "delete" },
};

const cancelActionLabel = (status: ReservationStatus) =>
  status === "pending" ? "Reject reservation" : "Cancel reservation";

export default function DashboardClient({
  initialData,
  username,
  contact,
  booths,
}: {
  initialData: CountedReservationPage;
  username: string;
  contact: ContactInfo;
  booths: Booth[];
}) {
  // Names from props, never env: that lookup would throw in a client bundle.
  const boothName = (id: string | undefined) => boothNameIn(booths, id);

  const { tooltip, tip } = useTooltip();
  const [data, setData] = useState<CountedReservationPage>(initialData);
  const [filter, setFilter] = useState<ReservationFilter>(INITIAL_FILTER);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmPurge, setConfirmPurge] = useState(false);
  // Per-reservation edited cancellation email bodies (id -> body).
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<PendingAction | null>(null);

  const reservations = data.reservations;
  const counts = data.counts;
  const total = data.total;
  const totalPages = pageCount(total, PAGE_SIZE);

  function draftFor(r: Reservation): string {
    return drafts[r.id] ?? emailBodyText(r, "cancelled", contact, boothName);
  }

  function ask(r: Reservation, status: PendingStatus) {
    setPending({
      id: r.id,
      name: r.fullName || "",
      email: r.email || "",
      status,
      body: status === "cancelled" ? draftFor(r) : "",
    });
  }

  const reqId = useRef(0);
  // `withCounts` only after a write: paging cannot move the tallies.
  const loadPage = useCallback(
    async (withCounts = false) => {
      const id = ++reqId.current;
      setLoading(true);
      const params = new URLSearchParams({
        status: filter,
        q: debouncedQuery,
        page: String(page),
        pageSize: String(PAGE_SIZE),
        counts: withCounts ? "1" : "0",
      });
      try {
        const res = await fetch(`/api/reservations?${params.toString()}`);
        const json = (await res.json()) as ReservationPage & { ok: boolean };
        if (id !== reqId.current) return;
        if (!json.ok) return;
        const tp = pageCount(json.total, PAGE_SIZE);
        if (page > tp) {
          setPage(tp);
          return;
        }
        // A countless response must not blank the boxes: the last set stands.
        setData((prev) => ({ ...json, counts: json.counts ?? prev.counts }));
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    },
    [filter, debouncedQuery, page],
  );

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
    status: PendingStatus,
    emailBody?: string,
  ) {
    await fetch(`/api/reservations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, emailBody }),
    });
    loadPage(true);
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
    loadPage(true);
  }

  useEffect(() => {
    setSelected(new Set());
  }, [filter, debouncedQuery, page]);

  return (
    <>
      <Topbar username={username} />

      <div className="container">
        <div className="page-head">
          <span className="eyebrow">Innospace Tirana</span>
          <h1 className="page-title">Reservations</h1>
          <p className="page-subtitle">
            Review booth reservations, approve or cancel, and send the guest
            their email - all in one place.
          </p>
        </div>
        <div className="stats">
          {FILTERS.map((f) => (
            <Stat
              key={f.key}
              num={f.key === "all" ? counts.total : counts[f.key]}
              label={f.stat}
              active={filter === f.key}
              onClick={() => setFilter(f.key)}
            />
          ))}
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
              {loading ? "Loading…" : "No reservations to show."}
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
                  <th>Reserved at</th>
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
                          aria-label={`Select reservation ${r.fullName || r.id}`}
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
                    <td>{boothLabel(r, boothName)}</td>
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
                        boothName={boothName}
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
                            {...tooltip("Approve reservation")}
                            aria-label="Approve reservation"
                            onClick={() => ask(r, "confirmed")}
                          >
                            <CheckIcon />
                          </button>
                        )}
                        <button
                          className="icon-btn cross"
                          {...tooltip(cancelActionLabel(r.status))}
                          aria-label={cancelActionLabel(r.status)}
                          disabled={!isActiveStatus(r.status)}
                          onClick={() => ask(r, "cancelled")}
                        >
                          <CrossIcon />
                        </button>
                        <button
                          className="icon-btn trash"
                          {...tooltip("Delete reservation")}
                          aria-label="Delete reservation"
                          disabled={r.status === "deleted"}
                          onClick={() => ask(r, "deleted")}
                        >
                          <TrashIcon />
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
        <ConfirmDialog
          title="Delete permanently?"
          onClose={() => setConfirmPurge(false)}
          onConfirm={deleteForever}
          confirmLabel="Yes, delete permanently"
        >
          <p>
            This will permanently remove{" "}
            <strong>
              {selected.size} reservation{selected.size === 1 ? "" : "s"}
            </strong>{" "}
            from the database. This cannot be undone.
          </p>
        </ConfirmDialog>
      )}

      {pending && (
        <ConfirmDialog
          title={ACTION_COPY[pending.status].title}
          variant={pending.status === "confirmed" ? "primary" : "danger"}
          onClose={() => setPending(null)}
          onConfirm={() => {
            setStatus(
              pending.id,
              pending.status,
              pending.status === "confirmed" ? undefined : pending.body,
            );
            setPending(null);
          }}
          confirmLabel={<>Yes, {ACTION_COPY[pending.status].verb}</>}
        >
          <p>
            {ACTION_COPY[pending.status].lead} the reservation
            {pending.name ? (
              <>
                {" "}
                for <strong>{pending.name}</strong>
              </>
            ) : null}
            ?
            {pending.status === "deleted"
              ? " It will be hidden from the list (no email is sent)."
              : !pending.email
                ? " (No email on file - nothing will be sent.)"
                : pending.status === "confirmed"
                  ? ` A confirmation email will be sent to ${pending.email}.`
                  : ` The cancellation email (as shown in the Email column) will be sent to ${pending.email}.`}
          </p>
        </ConfirmDialog>
      )}
      <SiteFooter />
      {tip}
    </>
  );
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
        {first}-{lastRow} of {total}
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
  active: boolean;
  onClick: () => void;
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

function EmailPreview({
  reservation,
  draft,
  contact,
  boothName,
  onChange,
}: {
  reservation: Reservation;
  draft: string | undefined;
  contact: ContactInfo;
  boothName: BoothNamer;
  onChange: (value: string) => void;
}) {
  if (reservation.status === "deleted") {
    return <span className="muted">-</span>;
  }

  const sent = reservation.status === "cancelled";
  const value =
    draft ?? emailBodyText(reservation, "cancelled", contact, boothName);
  return (
    <div className="email-preview">
      <div className="email-sent cancelled">
        {sent ? "Cancellation sent" : "Cancellation email"}
      </div>
      <div className="email-subject">
        Subject: {emailSubject("cancelled", contact, boothName, reservation)}
      </div>
      <textarea
        className="email-text"
        rows={7}
        value={value}
        readOnly={sent}
        onChange={sent ? undefined : (e) => onChange(e.target.value)}
        // The route rejects a longer body, so stop it here, not on send.
        maxLength={sent ? undefined : MAX_EMAIL_BODY}
        aria-label={
          sent ? "cancellation email body (sent)" : "cancellation email body"
        }
      />
    </div>
  );
}
