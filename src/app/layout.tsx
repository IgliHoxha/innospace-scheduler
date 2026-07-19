import type { Metadata } from "next";
import { IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

// Same typeface as innospacetirana.com
const ibmPlexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "600", "700"], // only the weights the UI actually uses
  variable: "--font-ibm-plex-sans",
  display: "swap",
  // Don't emit a <link rel="preload">: it triggers a "preloaded but not used"
  // console warning, and on an internal dashboard the swap-in is imperceptible.
  preload: false,
});

export const metadata: Metadata = {
  title: "Innospace Scheduler",
  description: "Meeting-booth scheduler for Innospace Tirana.",
  robots: { index: false, follow: false },
  icons: { icon: "/favicon.png", apple: "/favicon.png" },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={ibmPlexSans.variable}>
      <body>{children}</body>
    </html>
  );
}
