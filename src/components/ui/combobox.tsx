"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDownIcon } from "@/components/ui/icons";
import { searchOptions, type PickerOption } from "@/lib/picker";

/** The innospace-hub dropdown, ported so both apps pick from a list the same way. */
export function Combobox({
  id,
  options,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  options: readonly PickerOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = `${id}-list`;

  const selected = options.find((o) => o.value === value) ?? null;

  const rows = useMemo(
    () => (open ? searchOptions(options, query) : []),
    [open, options, query],
  );

  function openList() {
    if (open) return;
    setQuery("");
    setOpen(true);
    setActive(
      Math.max(
        0,
        options.findIndex((o) => o.value === value),
      ),
    );
  }

  function close() {
    setOpen(false);
    setQuery("");
  }

  function choose(option: PickerOption) {
    onChange(option.value);
    close();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) return openList();
      if (!rows.length) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((at) => (at + step + rows.length) % rows.length);
    } else if (e.key === "Enter") {
      // Closed, the key belongs to the form: only steal it to take a match.
      if (!open) return;
      e.preventDefault();
      if (rows.length) choose(rows[active]);
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      close();
    } else if (e.key === "Tab" && open) {
      close();
    }
  }

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.children[active]?.scrollIntoView?.({ block: "nearest" });
  }, [open, active]);

  return (
    <div className="combo" ref={rootRef}>
      <input
        id={id}
        name={id}
        className="combo-input"
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          open && rows.length ? `${listId}-${active}` : undefined
        }
        autoComplete="off"
        placeholder={placeholder}
        value={open ? query : (selected?.label ?? "")}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        onClick={openList}
      />
      <ChevronDownIcon />

      {/* Always there, so aria-controls names a real element even while closed. */}
      <ul
        className="combo-list"
        id={listId}
        role="listbox"
        ref={listRef}
        hidden={!open}
      >
        {rows.map((row, i) => (
          <li
            key={row.value}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={row.value === value}
            className={`combo-option${i === active ? " is-active" : ""}`}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => setActive(i)}
            onClick={() => choose(row)}
          >
            {row.label}
          </li>
        ))}
        {open && !rows.length && (
          <li className="combo-empty">Nothing matches that.</li>
        )}
      </ul>
    </div>
  );
}
