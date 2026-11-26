"use client";

import { CrashScreen } from "@/components/CrashScreen";
import "./globals.css";

/** The last resort: it replaces the root layout, so it brings its own document and styles. */
export default function GlobalError() {
  return (
    <html lang="en" translate="no" className="notranslate">
      <body>
        <CrashScreen />
      </body>
    </html>
  );
}
