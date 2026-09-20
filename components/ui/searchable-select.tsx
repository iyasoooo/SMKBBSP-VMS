'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { clsx } from 'clsx';

/**
 * A single-choice picker with a filter box.
 *
 * A native `<select>` stops being usable somewhere below a hundred options: the
 * school has eighty-nine places a visitor can be sent to, and finding "Bilik
 * Sains 2" in that list means scrolling a popup with no way to type at it. This
 * is the standard combobox pattern - a text input that filters, a listbox
 * underneath, and a hidden input so the surrounding form still submits an id.
 *
 * Accessibility is the reason this is hand-built rather than a filtered
 * `<select>`. It follows the ARIA combobox roles, keeps the highlighted option
 * in `aria-activedescendant` so a screen reader announces it while focus stays
 * in the text box, and is fully keyboard-operable: type to filter, arrows to
 * move, Enter to choose, Escape to abandon. Options are 44px tall for the same
 * reason every other control here is.
 */

export interface SearchableOption {
  value: string;
  label: string;
  /** Shown under the label - block, level, anything that disambiguates. */
  detail?: string;
  /** Extra words the filter should match but that are not displayed. */
  keywords?: string;
}

/**
 * Filter the rows for a query. Exported and pure so the matching rules can be
 * tested without a DOM - they are subtle enough that two separate bugs hid in
 * them, and both were only visible against the school's real room list.
 *
 * The rules, in order:
 *
 *  - No query returns everything, including the "no preference" row.
 *  - A query hides "no preference": it is a default, not a search result.
 *  - Each query word must match the *start of a word* in the row. Plain
 *    substring matching made short queries useless - "block b" matched every
 *    room in the school, because `b` occurs inside the word "Block" on all of
 *    them.
 *  - Each query word claims a *different* token, so the second word cannot be
 *    satisfied by the token the first already matched.
 *  - A single-letter word must match a whole token rather than a prefix.
 *    Prefix-matching one letter matches almost everything: `b` finds "Bilik",
 *    which begins nearly every Malay room name here.
 *
 * Longer words are matched first, so a specific word is not left without a
 * token after a short one has taken the only candidate.
 */
export function filterOptions(rows: SearchableOption[], query: string): SearchableOption[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return rows;

  const words = needle.split(/\s+/).sort((a, b) => b.length - a.length);

  return rows.filter((option) => {
    if (option.value === '') return false;

    const tokens = `${option.label} ${option.detail ?? ''} ${option.keywords ?? ''}`
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);

    const unused = [...tokens];
    return words.every((word) => {
      const index = unused.findIndex((token) =>
        word.length === 1 ? token === word : token.startsWith(word),
      );
      if (index === -1) return false;
      unused.splice(index, 1);
      return true;
    });
  });
}

export interface SearchableSelectProps {
  id: string;
  name: string;
  options: SearchableOption[];
  value: string;
  onChange: (value: string) => void;
  /** Offered as the first row, for "no preference". Omit to require a choice. */
  emptyOption?: string;
  placeholder?: string;
  required?: boolean;
  hasError?: boolean;
  describedBy?: string;
}

export function SearchableSelect({
  id,
  name,
  options,
  value,
  onChange,
  emptyOption,
  placeholder = 'Type to search',
  required,
  hasError,
  describedBy,
}: SearchableSelectProps) {
  const listboxId = `${useId()}-listbox`;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selected = options.find((option) => option.value === value) ?? null;

  /*
   * Rows, filtered. The optional "no preference" row is modelled as a real
   * option with an empty value so that arrowing and Enter treat it like any
   * other; special-casing it produced a row that could be seen but not chosen
   * from the keyboard.
   */
  const rows = useMemo(() => {
    const all: SearchableOption[] = emptyOption
      ? [{ value: '', label: emptyOption }, ...options]
      : options;
    return filterOptions(all, query);
  }, [options, emptyOption, query]);


  // Keep the highlight inside the list as it shrinks under the filter.
  useEffect(() => {
    setHighlight((current) => (current >= rows.length ? Math.max(0, rows.length - 1) : current));
  }, [rows.length]);

  // Close when the pointer goes elsewhere. Focus-out alone is not enough: a
  // click that lands on the page background moves focus nowhere at all.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  // Scroll the highlighted row into view, but only within the list.
  useEffect(() => {
    if (!open) return;
    listRef.current?.children[highlight]?.scrollIntoView({ block: 'nearest' });
  }, [highlight, open]);

  function choose(option: SearchableOption) {
    onChange(option.value);
    setQuery('');
    setOpen(false);
    inputRef.current?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setHighlight((current) => {
        if (rows.length === 0) return 0;
        return (current + step + rows.length) % rows.length;
      });
      return;
    }

    if (event.key === 'Home' && open) {
      event.preventDefault();
      setHighlight(0);
      return;
    }
    if (event.key === 'End' && open) {
      event.preventDefault();
      setHighlight(Math.max(0, rows.length - 1));
      return;
    }

    if (event.key === 'Enter') {
      // Only swallow Enter when it is choosing something; otherwise it must
      // still submit the form.
      if (open && rows[highlight]) {
        event.preventDefault();
        choose(rows[highlight]);
      }
      return;
    }

    if (event.key === 'Escape' && open) {
      event.preventDefault();
      setQuery('');
      setOpen(false);
      return;
    }

    if (event.key === 'Tab' && open) setOpen(false);
  }

  // What the box reads while it is not being typed into.
  const display = open ? query : (selected?.label ?? '');

  return (
    <div ref={rootRef} className="relative">
      {/* The value the form actually submits. The visible box is a filter. */}
      <input type="hidden" name={name} value={value} />

      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={open && rows[highlight] ? `${listboxId}-${highlight}` : undefined}
        aria-describedby={describedBy}
        /*
         * `required` is deliberately not set on this box. It holds the filter
         * text, not the value, so an empty box with a chosen option would fail
         * native validation and block a perfectly complete form. The server
         * validates the hidden field, which is the one that carries meaning.
         */
        aria-required={required || undefined}
        autoComplete="off"
        value={display}
        placeholder={selected && !open ? undefined : placeholder}
        onChange={(event) => {
          setQuery(event.target.value);
          setHighlight(0);
          if (!open) setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className={clsx(
          'h-11 w-full rounded-lg border bg-[var(--surface-card)] px-3 text-sm',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]',
          hasError ? 'border-[var(--danger)]' : 'border-[var(--line-strong)]',
        )}
      />

      {/* Announced to a screen reader as the list narrows. */}
      <span aria-live="polite" className="sr-only">
        {open ? `${rows.length} ${rows.length === 1 ? 'place' : 'places'} available` : ''}
      </span>

      {open ? (
        <ul
          ref={listRef}
          id={listboxId}
          role="listbox"
          className={clsx(
            'absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border',
            'border-[var(--line-strong)] bg-[var(--surface-card)] py-1 shadow-lg',
          )}
        >
          {rows.length === 0 ? (
            <li className="px-3 py-3 text-sm text-muted">No place matches that search.</li>
          ) : (
            rows.map((option, index) => {
              const isSelected = option.value === value;
              return (
                <li
                  key={option.value || '__none__'}
                  id={`${listboxId}-${index}`}
                  role="option"
                  aria-selected={isSelected}
                  // Pointer down rather than click: click fires after blur, by
                  // which time the list has already closed under the cursor.
                  onPointerDown={(event) => {
                    event.preventDefault();
                    choose(option);
                  }}
                  onMouseEnter={() => setHighlight(index)}
                  className={clsx(
                    'flex min-h-[var(--spacing-touch)] cursor-pointer flex-col justify-center px-3 py-2',
                    index === highlight && 'bg-[var(--accent-soft)]',
                    isSelected && 'font-medium',
                  )}
                >
                  <span className="text-sm">{option.label}</span>
                  {option.detail ? (
                    <span className="text-xs text-muted">{option.detail}</span>
                  ) : null}
                </li>
              );
            })
          )}
        </ul>
      ) : null}
    </div>
  );
}
