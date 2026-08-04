"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

interface Spot {
  text: string;
  x: number;
  top: number;
}

// Portalled and fixed: the timeline bar and the dashboard card both clip their overflow.
function TooltipBubble({ text, x, top }: Spot) {
  const ref = useRef<HTMLDivElement>(null);
  const [left, setLeft] = useState(x);

  // Measured, so a block at either end of the timeline can't push the bubble off screen.
  useLayoutEffect(() => {
    const half = (ref.current?.offsetWidth ?? 0) / 2 + 8;
    setLeft(Math.min(Math.max(x, half), window.innerWidth - half));
  }, [x, text]);

  return createPortal(
    <div
      ref={ref}
      role="tooltip"
      // The trigger keeps its own aria-label, so announcing this too would say it twice.
      aria-hidden="true"
      className="pointer-events-none fixed z-[45] -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-[11px] font-semibold leading-tight text-background shadow-lg"
      style={{ left, top: top - 8 }}
    >
      {text}
      <span
        className="absolute top-full h-2 w-2 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-foreground"
        // Follows the trigger rather than the bubble, which edge-clamping may have shifted.
        style={{ left: `calc(50% + ${x - left}px)` }}
      />
    </div>,
    document.body,
  );
}

/** Tooltips for triggers that can't wrap: spread `tooltip(text)` on each, render `tip` once. */
export function useTooltip() {
  const [spot, setSpot] = useState<Spot | null>(null);
  const hide = useCallback(() => setSpot(null), []);

  const show = useCallback((el: Element, text: string) => {
    const r = el.getBoundingClientRect();
    setSpot({ text, x: r.left + r.width / 2, top: r.top });
  }, []);

  // A fixed bubble can't follow its trigger, so scrolling or resizing drops it.
  useEffect(() => {
    if (!spot) return;
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [spot, hide]);

  const tooltip = useCallback(
    (text: string) => ({
      onPointerEnter: (e: React.PointerEvent) => show(e.currentTarget, text),
      onPointerLeave: hide,
      // Keyboard users get it too, and a click that opens a dialog dismisses it.
      onFocus: (e: React.FocusEvent) => show(e.currentTarget, text),
      onBlur: hide,
      onClick: hide,
    }),
    [show, hide],
  );

  return { tooltip, tip: spot ? <TooltipBubble {...spot} /> : null };
}
