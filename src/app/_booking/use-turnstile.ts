import { useCallback, useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    // Injected by Cloudflare's Turnstile script when the booking widget is on.
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string;
          action?: string;
          appearance?: "always" | "execute" | "interaction-only";
          theme?: "light" | "dark" | "auto";
          callback?: (token: string) => void;
          "error-callback"?: () => void;
          "expired-callback"?: () => void;
          "timeout-callback"?: () => void;
          "before-interactive-callback"?: () => void;
          "after-interactive-callback"?: () => void;
        },
      ) => string;
      reset: (widget?: string) => void;
      remove: (widget?: string) => void;
    };
  }
}

/** The bot check's widget and token; inert while `siteKey` is unset. */
export function useTurnstile(siteKey: string | undefined) {
  const [token, setToken] = useState("");
  // Turnstile reserves its box, so the slot stays collapsed until challenged.
  const [challenging, setChallenging] = useState(false);
  const slotRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!siteKey) return;
    let cancelled = false;
    let id: string | null = null;

    // The script is lazy, so poll for it rather than racing its load event.
    const render = () => {
      if (cancelled) return;
      const ts = window.turnstile;
      if (!ts || !slotRef.current) {
        window.setTimeout(render, 200);
        return;
      }
      id = ts.render(slotRef.current, {
        sitekey: siteKey,
        action: "turnstile-spin-v2",
        appearance: "interaction-only",
        theme: "light",
        callback: (t) => {
          setToken(t);
          setChallenging(false);
        },
        // A token that errored, expired or timed out is no longer spendable.
        "error-callback": () => setToken(""),
        "expired-callback": () => setToken(""),
        "timeout-callback": () => setToken(""),
        // The only reliable "I am about to show something" signal there is.
        "before-interactive-callback": () => setChallenging(true),
        "after-interactive-callback": () => setChallenging(false),
      });
      widgetIdRef.current = id;
    };
    render();

    return () => {
      cancelled = true;
      try {
        if (id && window.turnstile) window.turnstile.remove(id);
      } catch {
        /* widget already gone */
      }
      widgetIdRef.current = null;
      setToken("");
    };
  }, [siteKey]);

  /** A token is single-use, so a retry or second booking needs a fresh one. */
  const spend = useCallback(() => {
    setToken("");
    window.turnstile?.reset(widgetIdRef.current ?? undefined);
  }, []);

  /** Shows the widget rather than refuse a token nobody could earn. */
  const challenge = useCallback(() => setChallenging(true), []);

  return { token, challenging, slotRef, spend, challenge };
}
