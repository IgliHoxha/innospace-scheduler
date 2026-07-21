"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  getArrowByType,
  getDateByType,
  setDateByType,
} from "@/lib/time-picker-utils";
import type { TimePickerType } from "@/lib/time-picker-utils";

export interface TimePickerInputProps extends Omit<
  React.ComponentProps<"input">,
  "value" | "onChange"
> {
  picker: TimePickerType;
  date: Date;
  setDate: (date: Date) => void;
  onRightFocus?: () => void;
  onLeftFocus?: () => void;
}

/**
 * One typed time field (hours or minutes). Types straight over the two digits,
 * arrow up/down steps the value, arrow left/right hands focus to the sibling.
 */
const TimePickerInput = React.forwardRef<
  HTMLInputElement,
  TimePickerInputProps
>(
  (
    {
      className,
      type = "tel",
      id,
      name,
      date,
      setDate,
      picker,
      onLeftFocus,
      onRightFocus,
      onKeyDown,
      ...props
    },
    ref,
  ) => {
    // Two-digit buffer: the first keypress fills the tens, the second the units.
    const [flag, setFlag] = React.useState(false);

    React.useEffect(() => {
      if (!flag) return;
      const t = setTimeout(() => setFlag(false), 2000);
      return () => clearTimeout(t);
    }, [flag]);

    const shown = React.useMemo(
      () => getDateByType(date, picker),
      [date, picker],
    );

    const nextValue = (key: string) =>
      flag ? shown.slice(1, 2) + key : `0${key}`;

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Tab") return;
      e.preventDefault();
      if (e.key === "ArrowRight") onRightFocus?.();
      if (e.key === "ArrowLeft") onLeftFocus?.();
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        const step = e.key === "ArrowUp" ? 1 : -1;
        if (flag) setFlag(false);
        setDate(
          setDateByType(
            new Date(date),
            getArrowByType(shown, step, picker),
            picker,
          ),
        );
      }
      if (e.key >= "0" && e.key <= "9") {
        if (flag) onRightFocus?.();
        setFlag((f) => !f);
        setDate(setDateByType(new Date(date), nextValue(e.key), picker));
      }
    };

    return (
      <Input
        ref={ref}
        id={id ?? picker}
        name={name ?? picker}
        className={cn(
          "h-11 w-[46px] px-1 py-0 text-center font-mono text-base leading-none tabular-nums caret-transparent focus:bg-accent focus:text-accent-foreground [&::-webkit-inner-spin-button]:appearance-none",
          className,
        )}
        value={shown}
        type={type}
        inputMode="decimal"
        onChange={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          onKeyDown?.(e);
          handleKeyDown(e);
        }}
        {...props}
      />
    );
  },
);
TimePickerInput.displayName = "TimePickerInput";

export { TimePickerInput };
