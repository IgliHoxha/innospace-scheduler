import type { Config } from "tailwindcss";

// Single source of truth for the app palette. Consumed by the Tailwind theme
// below and by the email templates (email.ts), which need raw hex for inline
// styles because email HTML can't use Tailwind classes.
export const COLORS = {
  brand: "#25bdad",
  plum: "#524552",
  border: "#e5e7eb",
  background: "#ffffff",
  mutedForeground: "#8a7f8a",
  accentBg: "#f4f6f8",
  // Email header-bar accents per status (the UI badges mirror these in globals.css).
  statusPending: "#b45309",
  statusCancelled: "#b91c1c",
  // Email body copy: a neutral ink, not `plum`. Clients that dark-mode invert
  // flip lightness but keep hue, so a plum-tinted grey comes back pink, while a
  // zero-saturation grey comes back white. Saturated brand colours (brand, the
  // status accents) survive inversion untouched and stay as they are.
  emailText: "#000000",
  // Fine print sitting inside the body (link expiry notes). Neutral for the same
  // inversion reason as emailText, and darker than footerText because 12px body
  // copy needs the contrast; footerText stays as-is for the footer chrome.
  emailMuted: "#767676",
  // Email-only chrome (dividers/footer); not mapped into the Tailwind theme.
  divider: "#eee",
  footerBg: "#fafafa",
  footerText: "#a59ba5",
} as const;

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  // Preflight (Tailwind's global reset) is OFF on purpose: the app is styled by
  // hand in globals.css, and preflight would strip those defaults app-wide.
  corePlugins: { preflight: false },
  theme: {
    extend: {
      // Mapped to the app's own palette so the shadcn Input matches it, and in
      // hex so nothing collides with the app's var(--border) etc.
      colors: {
        border: COLORS.border,
        input: COLORS.border,
        ring: COLORS.brand,
        background: COLORS.background,
        foreground: COLORS.plum,
        muted: { foreground: COLORS.mutedForeground },
        accent: { DEFAULT: COLORS.accentBg, foreground: COLORS.plum },
      },
    },
  },
  plugins: [],
};

export default config;
