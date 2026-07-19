import { Resend } from "resend";
import { inviteTtlDays } from "./auth";
import type { Reservation } from "./types";
import {
  emailBodyText,
  emailHeading,
  emailSubject,
  getContactFromEnv,
  type EmailStatus,
} from "./templates";

const BRAND = "#25bdad";
const PLUM = "#524552";

function baseUrl(): string {
  return process.env.APP_BASE_URL || "https://scheduler.innospacetirana.com";
}

// The logo must load from a publicly reachable URL: email clients (Gmail etc.)
// can't fetch a localhost APP_BASE_URL, so it defaults to the live domain rather
// than baseUrl(). Override with EMAIL_LOGO_URL if the asset moves.
function emailLogoUrl(): string {
  return (
    process.env.EMAIL_LOGO_URL ||
    "https://scheduler.innospacetirana.com/email-logo.png"
  );
}

function client(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("[email] RESEND_API_KEY not set: skipping email.");
    return null;
  }
  return new Resend(apiKey);
}

function from(): string {
  return process.env.EMAIL_FROM || "onboarding@resend.dev";
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
}): string {
  const { accent, heading, bodyHtml } = opts;
  return `
  <div style="background:#f4f6f8;padding:28px 12px;font-family:'IBM Plex Sans',system-ui,Segoe UI,Arial,sans-serif">
    <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e5e7eb">
      <div style="padding:22px 28px;border-bottom:1px solid #eee">
        <img src="${emailLogoUrl()}" alt="Innospace Tirana" height="30" style="height:30px;width:auto;display:block" />
      </div>
      <div style="height:4px;background:${accent}"></div>
      <div style="padding:28px">
        <h1 style="margin:0 0 16px;color:${accent};font-size:22px">${heading}</h1>
        ${bodyHtml}
      </div>
      <div style="padding:16px 28px;background:#fafafa;border-top:1px solid #eee;color:#a59ba5;font-size:12px">
        Innospace Tirana · <a href="https://innospacetirana.com" style="color:${BRAND};text-decoration:none">innospacetirana.com</a>
      </div>
    </div>
  </div>`;
}

/**
 * Send a confirmation (on booking) or cancellation (from the dashboard) email
 * to the member who booked. customBody (dashboard edit) overrides the template.
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

  const body = (
    customBody ?? emailBodyText(reservation, status, getContactFromEnv())
  ).trim();

  await resend.emails.send({
    from: from(),
    to: [reservation.email],
    subject: emailSubject(status, reservation),
    html: shell({
      accent:
        status === "confirmed"
          ? BRAND
          : status === "pending"
            ? "#b45309"
            : "#b91c1c",
      heading: emailHeading(status),
      bodyHtml: textToHtml(body),
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

  const link = `${baseUrl()}/activate?token=${encodeURIComponent(token)}`;
  const intro = textToHtml(
    [
      "Hi there,",
      "",
      "You've been invited to book meeting booths at InnoSpace Tirana. To finish setting up your account, choose your name and a password using the button below.",
    ].join("\n"),
  );
  const button = `
    <p style="margin:22px 0">
      <a href="${link}" style="display:inline-block;background:${BRAND};color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;font-size:14px">Set up my account</a>
    </p>
    <p style="margin:0 0 14px;color:${PLUM};font-size:13px;line-height:1.6">Or paste this link into your browser:<br/><a href="${link}" style="color:${BRAND}">${link}</a></p>
    <p style="margin:0;color:#a59ba5;font-size:12px">This link expires in ${inviteTtlDays()} days. If you weren't expecting this, you can ignore this email.</p>`;

  await resend.emails.send({
    from: from(),
    to: [email],
    subject: "You're invited to Innospace Tirana Scheduler",
    html: shell({
      accent: BRAND,
      heading: "Set up your account",
      bodyHtml: intro + button,
    }),
  });
}
