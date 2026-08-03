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

// Base URL for email links (the cancel link); required, or links break.
function baseUrl(): string {
  return requireEnv("APP_BASE_URL");
}

// Gmail proxies every image through googleusercontent and rasterises SVG to PNG
// on its own servers (verified: the proxy responds content-type image/png). It
// can recolour HTML for dark mode but never the inside of an image, so a wordmark
// shipped as artwork is stuck on one fixed colour and loses either light or dark.
//
// So only the teal mark stays an image (teal reads on both backgrounds) and the
// wordmark is HTML text: a dark-mode client then inverts it exactly as it does
// the body copy, black on a white card and white on a dark shell.
//
// Served under APP_BASE_URL. In dev that's localhost (unfetchable by mail
// clients), but dev normally skips sending.
//
// The proxy caches per source URL, so an edit to the file alone never reaches a
// recipient already sent the old one. Bump this whenever the artwork changes.
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

// The wordmark text is the brand lockup, not the configurable BUSINESS_NAME, for
// the same reason the mark is fixed artwork: both are the logo.
//
// Built from inline spans rather than a table or nested divs. Gmail cut the card
// container in two at the table version of this, and the header sits inside a
// bordered, rounded wrapper that renders badly when split, so keep the markup
// here as flat as the plain <img> it replaced.
function logoLockup(org: string): string {
  return `<img src="${emailLogoUrl()}" alt="${org}" width="${MARK_WIDTH}" height="${MARK_HEIGHT}" style="width:${MARK_WIDTH}px;height:${MARK_HEIGHT}px;vertical-align:middle;border:0" /><span style="display:inline-block;vertical-align:middle;padding-left:11px;font-family:${FONT_STACK}"><span style="display:block;font-size:23px;line-height:1;letter-spacing:-0.3px;color:${INK}"><span style="font-weight:700">inno</span><span style="font-weight:400">space</span></span><span style="display:block;font-size:9px;line-height:1;letter-spacing:2.1px;padding-top:4px;color:${BRAND}">TIRANA</span></span>`;
}

// Lazy singleton: one Resend client for the process, built on first send (not at
// import, so tests/dev with no key never construct it). RESEND_API_KEY is an
// optional feature-flag: unset skips email. A null isn't cached, so a later key works.
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

// URLs, bare email addresses and international phone numbers, matched in one pass
// so the URL branch claims a URL carrying an "@" or a "+" rather than letting the
// later branches half-eat it. The address branch needs a word character after
// every dot and the phone branch must end on a digit, so trailing sentence
// punctuation stays outside the link. Phones require a leading "+" so years,
// prices and street numbers are never mistaken for one.
const LINKABLE =
  /(https?:\/\/[^\s<]+)|([\w.+-]+@[\w-]+(?:\.[\w-]+)+)|(\+\d[\d\s().-]{7,}\d)/g;

// Plain-text body -> safe HTML: escape, keep line breaks, linkify URLs, email
// addresses and phone numbers. The last two must be linked here rather than left
// bare: Gmail and iOS auto-link them and paint them their own default blue, which
// clashes with the brand-coloured URLs alongside.
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
