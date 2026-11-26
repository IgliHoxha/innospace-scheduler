import type { Metadata } from "next";
import { IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

// Same typeface as innospacetirana.com
const ibmPlexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-ibm-plex-sans",
  display: "swap",
  // No preload link: it warns "preloaded but not used" for no visible gain.
  preload: false,
});

export const metadata: Metadata = {
  title: "Innospace Scheduler",
  description: "Meeting-booth scheduler for Innospace Tirana.",
  robots: { index: false, follow: false },
  icons: { icon: "/favicon.png", apple: "/favicon.png" },
  // Chrome's translator reads this one; the attribute on <html> covers Safari and the rest.
  other: { google: "notranslate" },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // A page translator swaps text React later replaces, which crashes the whole screen.
    <html
      lang="en"
      translate="no"
      className={`${ibmPlexSans.variable} notranslate`}
    >
      <body>{children}</body>
    </html>
  );
}
