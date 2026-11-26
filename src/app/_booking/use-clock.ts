import { useEffect, useState } from "react";
import { localMinutes } from "@/lib/datetime";

/** The wall clock in whole minutes, re-read each minute and whenever the tab comes back. */
export function useClockMinutes(): number {
  const [now, setNow] = useState(() => localMinutes(Date.now()));
  useEffect(() => {
    let timer = 0;
    const read = () => {
      setNow(localMinutes(Date.now()));
      // Re-armed from the clock itself, so a throttled timer cannot drift off the minute.
      timer = window.setTimeout(read, 60_000 - (Date.now() % 60_000) + 50);
    };
    // A phone suspends timers behind a lock screen, so coming back reads at once.
    const onShow = () => {
      window.clearTimeout(timer);
      read();
    };
    read();
    document.addEventListener("visibilitychange", onShow);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, []);
  return now;
}
