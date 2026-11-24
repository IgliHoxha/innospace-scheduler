import { noteBoardWrite } from "./availability-url";

/** Cancels as the emailed link does: why it failed, empty when it worked. */
export async function cancelByToken(token: string): Promise<string> {
  try {
    const res = await fetch("/api/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
    };
    if (res.ok && json.ok) {
      noteBoardWrite();
      return "";
    }
    return json.error || "Could not cancel that reservation.";
  } catch {
    return "Could not reach the server. Please try again.";
  }
}
