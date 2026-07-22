import { Resend } from "resend";
import { COLORS } from "../../tailwind.config";
import { inviteTtlDays } from "./auth";
import { boothName } from "./booths";
import { getContactFromEnv, optionalEnv, requireEnv } from "./env-app";
import type { Reservation } from "./types";
import {
  emailBodyText,
  emailHeading,
  emailSubject,
  signOff,
  type EmailStatus,
} from "./templates";

export { getContactFromEnv };

const BRAND = COLORS.brand;
const PLUM = COLORS.plum;

// Base URL for email links (invite/activation); required, or links break.
function baseUrl(): string {
  return requireEnv("APP_BASE_URL");
}

// Logo is an app asset (public/email-logo.png) served under APP_BASE_URL. In dev
// that's localhost (unfetchable by mail clients), but dev normally skips sending.
function emailLogoUrl(): string {
  return `${baseUrl().replace(/\/$/, "")}/email-logo.png`;
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

// Plain-text body -> safe HTML: escape, keep line breaks, linkify URLs.
function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((para) => {
      const safe = escapeHtml(para)
        .replace(/\n/g, "<br/>")
        .replace(
          /(https?:\/\/[^\s<]+)/g,
          `<a href="$1" style="color:${BRAND}">$1</a>`,
        );
      return `<p style="margin:0 0 14px;color:${PLUM};font-size:14px;line-height:1.6">${safe}</p>`;
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
  const logo = emailLogoUrl();
  const header = `<div style="padding:22px 28px;border-bottom:1px solid ${COLORS.divider}">
        <img src="${logo}" alt="${org}" height="30" style="height:30px;width:auto;display:block" />
      </div>`;
  return `
  <div style="background:${COLORS.accentBg};padding:28px 12px;font-family:'IBM Plex Sans',system-ui,Segoe UI,Arial,sans-serif">
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

/**
 * Send a confirmation (on reservation) or cancellation (from the dashboard) email
 * to the member who reserved. customBody (dashboard edit) overrides the template.
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
      bodyHtml: textToHtml(body),
      org: contact.org,
      url: contact.url,
    }),
  });
}

/**
 * Email a new member their invite link. They click it to set their own name +
 * password and activate the account.
 */
export async function sendInviteEmail(
  email: string,
  token: string,
): Promise<void> {
  const resend = client();
  if (!resend) return;

  const contact = getContactFromEnv();
  const org = contact.org;
  const link = `${baseUrl()}/activate?token=${encodeURIComponent(token)}`;
  const intro = textToHtml(
    [
      "Hi there,",
      "",
      `You've been invited to reserve meeting booths at ${org}. To finish setting up your account, choose your name and a password using the button below.`,
    ].join("\n"),
  );
  const button = `
    <p style="margin:22px 0">
      <a href="${link}" style="display:inline-block;background:${BRAND};color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;font-size:14px">Set up my account</a>
    </p>
    <p style="margin:0 0 14px;color:${PLUM};font-size:13px;line-height:1.6">Or paste this link into your browser:<br/><a href="${link}" style="color:${BRAND}">${link}</a></p>`;
  // Same sign-off as every other email, then the expiry note as fine print.
  const closing = textToHtml(signOff(contact).join("\n"));
  const finePrint = `<p style="margin:0;color:${COLORS.footerText};font-size:12px">This link expires in ${inviteTtlDays()} days. If you weren't expecting this, you can ignore this email.</p>`;

  await resend.emails.send({
    from: from(),
    to: [email],
    subject: `You're invited to ${org} Scheduler`,
    html: shell({
      accent: BRAND,
      heading: "Set up your account",
      bodyHtml: intro + button + closing + finePrint,
      org,
      url: contact.url,
    }),
  });
}
