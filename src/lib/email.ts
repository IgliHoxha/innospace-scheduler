import { Resend } from "resend";
import { COLORS } from "../../tailwind.config";
import { createCancelToken } from "./auth";
import { boothName } from "./booths";
import { epochMsOf } from "./datetime";
import { getContactFromEnv, optionalEnv, requireEnv } from "./env-app";
import type { Reservation } from "./types";
import {
  emailBodyText,
  emailHeading,
  emailPreheader,
  emailSubject,
  type EmailStatus,
} from "./templates";

export { getContactFromEnv };

const BRAND = COLORS.brand;
const INK = COLORS.emailText;

function baseUrl(): string {
  return requireEnv("APP_BASE_URL");
}

// Only the mark is artwork; the wordmark is HTML text so dark-mode clients can invert it.
const LOGO_VERSION = "6";

function emailLogoUrl(): string {
  return `${baseUrl().replace(/\/$/, "")}/logo-mark.svg?v=${LOGO_VERSION}`;
}

// 329x308 artwork, so 32px tall is 34px wide; clients ignoring CSS need the width attribute.
const MARK_HEIGHT = 32;
const MARK_WIDTH = 34;

const FONT_STACK =
  "'IBM Plex Sans',system-ui,Segoe UI,Arial,sans-serif" as const;

// The fixed brand lockup, not BUSINESS_NAME; flat spans, since Gmail cut the table version in two.
function logoLockup(org: string): string {
  return `<img src="${escapeHtml(emailLogoUrl())}" alt="${escapeHtml(org)}" width="${MARK_WIDTH}" height="${MARK_HEIGHT}" style="width:${MARK_WIDTH}px;height:${MARK_HEIGHT}px;vertical-align:middle;border:0" /><span style="display:inline-block;vertical-align:middle;padding-left:11px;font-family:${FONT_STACK}"><span style="display:block;font-size:23px;line-height:1;letter-spacing:-0.3px;color:${INK}"><span style="font-weight:700">inno</span><span style="font-weight:400">space</span></span><span style="display:block;font-size:9px;line-height:1;letter-spacing:2.1px;padding-top:4px;color:${BRAND}">TIRANA</span></span>`;
}

// Built on first send, not at import, so a keyless dev run never constructs one.
let _resend: Resend | null = null;
function client(): Resend | null {
  if (_resend) return _resend;
  const apiKey = optionalEnv("RESEND_API_KEY");
  if (!apiKey) {
    console.warn("[email] RESEND_API_KEY not set: skipping email.");
    return null;
  }
  _resend = new Resend(apiKey);
  return _resend;
}

function from(): string {
  return requireEnv("EMAIL_FROM");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// One pass, so the URL branch claims a URL carrying "@" or "+" before a later branch half-eats it.
const LINKABLE =
  /(https?:\/\/[^\s<]+)|([\w.+-]+@[\w-]+(?:\.[\w-]+)+)|(\+\d[\d\s().-]{7,}\d)/g;

// Plain text to safe HTML; addresses are linked here, or clients auto-link them in a clashing blue.
function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((para) => {
      const safe = escapeHtml(para)
        .replace(/\n/g, "<br/>")
        .replace(
          LINKABLE,
          (match, url?: string, mail?: string, phone?: string) => {
            const link = (href: string, label: string) =>
              `<a href="${href}" style="color:${BRAND}">${label}</a>`;
            if (url) return link(url, url);
            if (mail) return link(`mailto:${mail}`, mail);
            // tel: wants digits only; the visible text keeps its spacing.
            if (phone)
              return link(`tel:${phone.replace(/[^\d+]/g, "")}`, phone);
            return match;
          },
        );
      return `<p style="margin:0 0 14px;color:${INK};font-size:14px;line-height:1.6">${safe}</p>`;
    })
    .join("");
}

// Invisible filler, so a client stops scraping at the preheader instead of reading on into the logo.
const PREHEADER_PAD = "&#8199;&#65279;&#847;".repeat(30);

// Hidden every way a mail client might respect, since only snippet readers are meant to see it.
function preheaderHtml(text: string): string {
  return `<div style="display:none;font-size:0;line-height:0;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">${escapeHtml(text)}${PREHEADER_PAD}</div>`;
}

function shell(opts: {
  accent: string;
  heading: string;
  bodyHtml: string;
  org: string;
  url: string;
  preheader: string;
}): string {
  const { accent, heading, bodyHtml, org, url, preheader } = opts;
  // Footer website link; visible text drops the scheme and any trailing slash.
  const footerLink = ` · <a href="${escapeHtml(url)}" style="color:${BRAND};text-decoration:none">${escapeHtml(
    url.replace(/^https?:\/\//, "").replace(/\/$/, ""),
  )}</a>`;
  // No border of its own: the accent rule below already closes the header, and two lines read as one furred edge.
  const header = `<div style="padding:22px 28px">
        ${logoLockup(org)}
      </div>`;
  // Type zeroed as well as height: an empty div keeps a line box that would fatten a 2px rule.
  const accentRule = `<div style="height:2px;line-height:2px;font-size:0;background:${accent}">&nbsp;</div>`;
  return `
  ${preheaderHtml(preheader)}
  <div style="background:${COLORS.accentBg};padding:28px 12px;font-family:${FONT_STACK}">
    <div style="max-width:560px;margin:0 auto;background:${COLORS.background};border-radius:14px;overflow:hidden;border:1px solid ${COLORS.border}">
      ${header}
      ${accentRule}
      <div style="padding:28px">
        <h1 style="margin:0 0 16px;color:${accent};font-size:22px">${heading}</h1>
        ${bodyHtml}
      </div>
      <div style="padding:16px 28px;background:${COLORS.footerBg};border-top:1px solid ${COLORS.divider};color:${COLORS.footerText};font-size:12px">
        ${escapeHtml(org)}${footerLink}
      </div>
    </div>
  </div>`;
}

// The cancel token is the only proof of ownership: one reservation, expiring when that slot ends.
function cancelButton(r: Reservation): string {
  if (!r.id || !r.endsAt) return "";
  const expiresAt = epochMsOf(r.endsAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return "";

  const token = createCancelToken(r.id, expiresAt);
  const link = `${baseUrl().replace(/\/$/, "")}/cancel?token=${encodeURIComponent(token)}`;
  // Sits below the sign-off, ruled off as utility chrome rather than letter copy.
  return `
    <div style="margin:26px 0 0;padding:18px 0 0;border-top:1px solid ${COLORS.divider}">
      <a href="${escapeHtml(link)}" style="display:inline-block;border:1px solid ${COLORS.border};color:${INK};text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;font-size:13px">Cancel this reservation</a>
      <p style="margin:10px 0 0;color:${COLORS.emailMuted};font-size:12px">Only you have this link, and it stops working once the reservation has passed.</p>
    </div>`;
}

/** "skipped" is nothing attempted (no key or address); only "failed" means the address was refused. */
export type EmailOutcome = "sent" | "skipped" | "failed";

/** Send a confirmation or cancellation to whoever booked; customBody overrides the template. */
export async function sendReservationEmail(
  reservation: Reservation,
  status: EmailStatus,
  customBody?: string,
): Promise<EmailOutcome> {
  const resend = client();
  if (!resend) return "skipped";
  if (!reservation.email) {
    console.warn("[email] reservation has no email: skipping.");
    return "skipped";
  }

  const contact = getContactFromEnv();
  const body = (
    customBody ?? emailBodyText(reservation, status, contact, boothName)
  ).trim();

  // The SDK reports refusals in the resolved value rather than throwing, so inspect the result.
  let result: { error?: unknown } | undefined;
  try {
    result = await resend.emails.send({
      from: from(),
      to: [reservation.email],
      subject: emailSubject(status, contact, boothName, reservation),
      html: shell({
        accent:
          status === "confirmed"
            ? BRAND
            : status === "pending"
              ? COLORS.statusPending
              : COLORS.statusCancelled,
        heading: emailHeading(status),
        // No cancel link on a cancellation: there's nothing left to cancel.
        bodyHtml:
          textToHtml(body) +
          (status === "cancelled" ? "" : cancelButton(reservation)),
        org: contact.org,
        url: contact.url,
        // The details, not the edited body: a custom body could open with anything.
        preheader: emailPreheader(reservation, status, contact, boothName),
      }),
    });
  } catch (err) {
    console.error("[email] send threw:", err);
    return "failed";
  }

  if (result?.error) {
    console.error("[email] Resend refused the send:", result.error);
    return "failed";
  }
  return "sent";
}
