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
  emailSubject,
  type EmailStatus,
} from "./templates";

export { getContactFromEnv };

const BRAND = COLORS.brand;
const INK = COLORS.emailText;

function baseUrl(): string {
  return requireEnv("APP_BASE_URL");
}

// Gmail rasterises SVG through its image proxy and can't recolour inside an
// image, so only the teal mark stays artwork and the wordmark is HTML text that
// dark-mode clients invert. The proxy caches per URL: bump on any artwork edit.
const LOGO_VERSION = "6";

function emailLogoUrl(): string {
  return `${baseUrl().replace(/\/$/, "")}/logo-mark.svg?v=${LOGO_VERSION}`;
}

// logo-mark.svg is 329x308, so a 32px-tall render is 34px wide. Mail clients that
// ignore CSS need the width attribute or they reserve the full intrinsic size.
const MARK_HEIGHT = 32;
const MARK_WIDTH = 34;

const FONT_STACK =
  "'IBM Plex Sans',system-ui,Segoe UI,Arial,sans-serif" as const;

// The wordmark is the fixed brand lockup, not the configurable BUSINESS_NAME.
// Flat inline spans, never a table: Gmail cut the rounded card in two at the
// table version of this.
function logoLockup(org: string): string {
  return `<img src="${emailLogoUrl()}" alt="${org}" width="${MARK_WIDTH}" height="${MARK_HEIGHT}" style="width:${MARK_WIDTH}px;height:${MARK_HEIGHT}px;vertical-align:middle;border:0" /><span style="display:inline-block;vertical-align:middle;padding-left:11px;font-family:${FONT_STACK}"><span style="display:block;font-size:23px;line-height:1;letter-spacing:-0.3px;color:${INK}"><span style="font-weight:700">inno</span><span style="font-weight:400">space</span></span><span style="display:block;font-size:9px;line-height:1;letter-spacing:2.1px;padding-top:4px;color:${BRAND}">TIRANA</span></span>`;
}

// Built on first send, not at import, so a keyless dev/test run never constructs
// one. The null isn't cached, so a key set later still takes effect.
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

// One pass, so the URL branch claims a URL carrying "@" or "+" instead of a later
// branch half-eating it. Each tail ends on a word character or digit to keep
// punctuation out; phones need a leading "+" so years and prices aren't linked.
const LINKABLE =
  /(https?:\/\/[^\s<]+)|([\w.+-]+@[\w-]+(?:\.[\w-]+)+)|(\+\d[\d\s().-]{7,}\d)/g;

// Plain text -> safe HTML. Addresses and phones are linked here rather than left
// bare: Gmail and iOS auto-link them in their own blue, clashing with the
// brand-coloured URLs alongside.
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

function shell(opts: {
  accent: string;
  heading: string;
  bodyHtml: string;
  org: string;
  url: string;
}): string {
  const { accent, heading, bodyHtml, org, url } = opts;
  // Footer website link; visible text drops the scheme and any trailing slash.
  const footerLink = ` · <a href="${url}" style="color:${BRAND};text-decoration:none">${url
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "")}</a>`;
  const header = `<div style="padding:22px 28px;border-bottom:1px solid ${COLORS.divider}">
        ${logoLockup(org)}
      </div>`;
  return `
  <div style="background:${COLORS.accentBg};padding:28px 12px;font-family:${FONT_STACK}">
    <div style="max-width:560px;margin:0 auto;background:${COLORS.background};border-radius:14px;overflow:hidden;border:1px solid ${COLORS.border}">
      ${header}
      <div style="height:4px;background:${accent}"></div>
      <div style="padding:28px">
        <h1 style="margin:0 0 16px;color:${accent};font-size:22px">${heading}</h1>
        ${bodyHtml}
      </div>
      <div style="padding:16px 28px;background:${COLORS.footerBg};border-top:1px solid ${COLORS.divider};color:${COLORS.footerText};font-size:12px">
        ${org}${footerLink}
      </div>
    </div>
  </div>`;
}

// Self-service cancel link. Booking needs no account, so this token is the only
// proof of ownership there is: it names one reservation and expires when that
// slot ends, since a passed booking can't be cancelled anyway.
function cancelButton(r: Reservation): string {
  if (!r.id || !r.endsAt) return "";
  const expiresAt = epochMsOf(r.endsAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return "";

  const token = createCancelToken(r.id, expiresAt);
  const link = `${baseUrl().replace(/\/$/, "")}/cancel?token=${encodeURIComponent(token)}`;
  // Sits below the sign-off, ruled off as utility chrome rather than letter copy.
  return `
    <div style="margin:26px 0 0;padding:18px 0 0;border-top:1px solid ${COLORS.divider}">
      <a href="${link}" style="display:inline-block;border:1px solid ${COLORS.border};color:${INK};text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;font-size:13px">Cancel this reservation</a>
      <p style="margin:10px 0 0;color:${COLORS.emailMuted};font-size:12px">Only you have this link, and it stops working once the reservation has passed.</p>
    </div>`;
}

/**
 * Send a confirmation (on reservation) or cancellation (from the dashboard) email
 * to whoever booked. customBody (dashboard edit) overrides the template.
 */
export async function sendReservationEmail(
  reservation: Reservation,
  status: EmailStatus,
  customBody?: string,
): Promise<void> {
  const resend = client();
  if (!resend) return;
  if (!reservation.email) {
    console.warn("[email] reservation has no email: skipping.");
    return;
  }

  const contact = getContactFromEnv();
  const body = (
    customBody ?? emailBodyText(reservation, status, contact, boothName)
  ).trim();

  await resend.emails.send({
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
    }),
  });
}
