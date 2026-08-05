// Posts bookings to Slack. Server-only: it reads a secret webhook URL.
import { optionalEnv } from "./env-app";
import type { EmailStatus } from "./templates";
import { boothLabel, dateText, timeText } from "./templates";
import type { BoothNamer } from "./templates";
import type { Reservation } from "./types";

/** "skipped" is no webhook configured; only "failed" means Slack refused it. */
export type SlackOutcome = "sent" | "skipped" | "failed";

// A hung POST would hold the booking's own response open behind it.
const TIMEOUT_MS = 5000;

// The icon says which state the booth is in before a word is read.
const ICON_BOOKED = ":calendar:";
const ICON_WAITING = ":hourglass_flowing_sand:";
// Not :x:, which is drawn edge to edge and looms beside the other two.
const ICON_CANCELLED = ":small_red_triangle_down:";

/** Who ended it: a guest dropping a slot and an admin pulling one differ. */
export type CancelledBy = "guest" | "admin";

/** What happened: an approval lands on "confirmed" too, so status cannot say. */
export type SlackEvent = EmailStatus | "approved";

// One place for icon and wording, so they cannot describe different events.
function headline(
  event: SlackEvent,
  actor?: string,
): { icon: string; title: string; lead: string } {
  if (event === "cancelled")
    return {
      icon: ICON_CANCELLED,
      title: `Reservation cancelled by ${actor ?? "the guest"}`,
      lead: "Cancelled",
    };
  if (event === "pending")
    return {
      icon: ICON_WAITING,
      title: "Reservation awaiting approval",
      lead: "Awaiting approval",
    };
  // Only the dashboard can approve, so crediting an actor says nothing.
  if (event === "approved")
    return {
      icon: ICON_BOOKED,
      title: "Reservation approved",
      lead: "Approved",
    };
  return {
    icon: ICON_BOOKED,
    title: "New reservation",
    lead: "New reservation",
  };
}

// The three characters Slack reads as markup, so a name cannot forge a link.
function escapeSlack(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// The admin is one shared login, so its role is the whole identity.
function actorLabel(r: Reservation, by?: CancelledBy): string {
  if (by === "admin") return "the admin";
  const name = r.fullName?.trim();
  return name ? `${escapeSlack(name)} (guest)` : "the guest";
}

/** The one-line summary a notification and the channel list show. */
export function slackReservationText(
  r: Reservation,
  event: SlackEvent,
  boothName: BoothNamer,
): string {
  const who = r.fullName?.trim() || r.email || "someone";
  return `${headline(event).lead}: ${boothLabel(r, boothName)} · ${dateText(r)} · ${timeText(r)} (${who})`;
}

/** The channel body, plus `text` for the notification. */
export function slackReservationMessage(
  r: Reservation,
  event: SlackEvent,
  boothName: BoothNamer,
  by?: CancelledBy,
): { text: string; blocks: unknown[] } {
  const { icon, title } = headline(event, actorLabel(r, by));
  // Unlabelled: labels double the height and say nothing a date does not.
  const lines = [
    `${icon} *${title}*`,
    `${escapeSlack(boothLabel(r, boothName))} · ${escapeSlack(dateText(r))} · ${escapeSlack(timeText(r))}`,
    `${escapeSlack(r.fullName?.trim() || "-")} · ${escapeSlack(r.email || "-")}`,
  ];
  if (r.note?.trim()) lines.push(`_${escapeSlack(r.note.trim())}_`);
  return {
    text: slackReservationText(r, event, boothName),
    blocks: [
      {
        // Context, not section: Slack renders it smaller than message text.
        type: "context",
        elements: [{ type: "mrkdwn", text: lines.join("\n") }],
      },
    ],
  };
}

/** Announce a booking. Never throws: a notice must not cost anyone their slot. */
export async function postReservationToSlack(
  r: Reservation,
  event: SlackEvent,
  boothName: BoothNamer,
  by?: CancelledBy,
): Promise<SlackOutcome> {
  const url = optionalEnv("SLACK_WEBHOOK_URL");
  if (!url) return "skipped";

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(slackReservationMessage(r, event, boothName, by)),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error("[slack] webhook refused the post:", res.status);
      return "failed";
    }
    return "sent";
  } catch (err) {
    console.error("[slack] post failed:", err);
    return "failed";
  }
}
