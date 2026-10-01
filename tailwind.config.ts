import type { Config } from "tailwindcss";

// Raw hex, shared with email.ts: email HTML can't use Tailwind classes.
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
  // Not plum: dark-mode inversion keeps hue, so a plum grey comes back pink.
  emailText: "#000000",
  // Body fine print: darker than footerText, as 12px copy needs the contrast.
  emailMuted: "#767676",
  // Email-only chrome (dividers/footer); not mapped into the Tailwind theme.
  divider: "#eee",
  footerBg: "#fafafa",
  footerText: "#a59ba5",
} as const;

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  // Off: the app is styled by hand in globals.css and a reset would strip that.
  corePlugins: { preflight: false },
  theme: {
    extend: {
      // App palette for the shadcn Input; hex so var(--border) can't collide.
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
