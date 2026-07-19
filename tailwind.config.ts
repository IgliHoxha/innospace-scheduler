import type { Config } from "tailwindcss";

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
        border: "#e5e7eb",
        input: "#e5e7eb",
        ring: "#25bdad",
        background: "#ffffff",
        foreground: "#524552",
        muted: { foreground: "#8a7f8a" },
        accent: { DEFAULT: "#f4f6f8", foreground: "#524552" },
      },
    },
  },
  plugins: [],
};

export default config;
