"use client";

import {
  mailtoLink,
  slotEnquiry,
  slotEnquirySubject,
  whatsappLink,
} from "@/lib/contact-links";
import { MailIcon, WhatsAppIcon } from "@/components/ui/icons";

// Markup only: DayTimeline keeps the state and decides when each one is open.

export function CancelDialog({
  boothName,
  dateLabel,
  from,
  to,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  boothName: string;
  dateLabel: string;
  from: string;
  to: string;
  busy: boolean;
  error: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="modal-overlay"
      onClick={() => !busy && onClose()}
      role="presentation"
    >
      <div
        className="modal ask-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Cancel this reservation"
      >
        <button
          type="button"
          className="modal-close"
          onClick={onClose}
          disabled={busy}
          aria-label="Close"
        >
          ×
        </button>
        <h2>Cancel this reservation?</h2>
        <p className="modal-sub">
          <strong>{boothName}</strong>
          <br />
          {dateLabel}
          <br />
          {from} - {to}
        </p>
        {error && <p className="error">{error}</p>}
        <div className="ask-actions">
          <button
            type="button"
            className="btn ghost"
            onClick={onClose}
            disabled={busy}
          >
            Keep it
          </button>
          <button
            type="button"
            className="btn danger"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Cancelling…" : "Yes, cancel it"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function AskDialog({
  boothName,
  dateLabel,
  from,
  to,
  contact,
  onClose,
}: {
  boothName: string;
  dateLabel: string;
  from: string;
  to: string;
  contact: { phone: string; email: string };
  onClose: () => void;
}) {
  const message = slotEnquiry(boothName, dateLabel, from, to);
  const subject = slotEnquirySubject(boothName, dateLabel, from, to);
  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div
        className="modal ask-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Get in touch about this booking"
      >
        <button
          type="button"
          className="modal-close"
          onClick={onClose}
          aria-label="Close"
        >
          ×
        </button>
        <h2>Get in touch</h2>
        <p className="modal-sub">
          Choose how you&apos;d like to reach us about {boothName} on{" "}
          {dateLabel}, {from} - {to}:
        </p>
        <div className="ask-actions">
          <a
            className="btn"
            href={mailtoLink(contact.email, subject, message)}
            onClick={onClose}
          >
            <MailIcon /> Email
          </a>
          <a
            className="btn whatsapp"
            href={whatsappLink(contact.phone, message)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onClose}
          >
            <WhatsAppIcon /> WhatsApp
          </a>
        </div>
      </div>
    </div>
  );
}
