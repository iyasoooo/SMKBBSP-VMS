'use client';

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { MapNodeCategory } from '@prisma/client';
import type { CampusLevel, CampusRoom, CampusWalkway } from '@/lib/map/campus';
import type { MapDictionary } from '@/lib/i18n/map-dictionary';
import type { Locale } from '@/lib/constants';

/**
 * The map surface.
 *
 * Routing already happened on the server - this component receives the finished
 * path and only has to draw it. What it owns is the things a round trip would
 * make worse: which level is on screen, the search filter, and the zoom.
 *
 * Both ends of the journey live in the URL, and every way of setting them - the
 * list, the map itself - is a real link. So the page works with JavaScript off,
 * the back button undoes a wrong turn, and a guard can send a visitor the exact
 * route rather than describing it.
 */

export type PickTarget = 'from' | 'to';

export interface RouteView {
  segments: { levelCode: string; points: { x: number; y: number }[] }[];
  displayMetres: number;
  walkingMinutes: number;
  levelCodes: string[];
}

/** The written route, rendered on the server and handed over as sentences. */
export interface DirectionsView {
  summary: string | null;
  steps: string[];
  /** Why there are no steps, when the reason is not simply "nothing chosen". */
  notice?: string;
}

interface Props {
  levels: CampusLevel[];
  rooms: CampusRoom[];
  walkways: CampusWalkway[];
  route: RouteView | null;
  directions: DirectionsView;
  fromCode: string | null;
  toCode: string | null;
  pick: PickTarget;
  /** Screen-filling mode. Lives in the URL - see `viewHref` below. */
  maximised: boolean;
  locale: Locale;
  dictionary: MapDictionary;
  width: number;
  height: number;
}

const CATEGORY_FILL: Record<MapNodeCategory, string> = {
  CLASSROOM: 'var(--map-classroom)',
  SPECIAL_ROOM: 'var(--map-special)',
  ADMIN: 'var(--map-admin)',
  STAIR_BLOCK: 'var(--map-block)',
  SERVICE: 'var(--map-service)',
  CIRCULATION: 'var(--map-circulation)',
  OPEN_AREA: 'var(--map-open)',
  LANDSCAPE: 'var(--map-landscape)',
};

const LEGEND_ORDER: MapNodeCategory[] = [
  'CLASSROOM',
  'SPECIAL_ROOM',
  'ADMIN',
  'STAIR_BLOCK',
  'SERVICE',
  'CIRCULATION',
  'OPEN_AREA',
  'LANDSCAPE',
];

const MIN_SCALE = 1;
const MAX_SCALE = 6;

// ---------------------------------------------------------------------------
// Label fitting
// ---------------------------------------------------------------------------

/**
 * Average glyph width as a fraction of font size, for the semibold system sans
 * the map draws in. Measuring properly would mean a canvas per label; this is
 * close enough that the fitter errs towards smaller text rather than overflow.
 */
const GLYPH_RATIO = 0.56;
const LINE_SPACING = 1.12;

interface FittedLabel {
  fontSize: number;
  lines: string[];
}

/** Greedy word wrap. Returns null when a single word cannot fit the width. */
function wrapWords(text: string, maxChars: number): string[] | null {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (word.length > maxChars) return null;
    if (!current) {
      current = word;
    } else if (current.length + 1 + word.length <= maxChars) {
      current = `${current} ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : null;
}

/**
 * Largest font size at which the whole name fits inside the room.
 *
 * Names are wrapped rather than truncated: "Student prayer room" over three
 * lines is readable, "Student prayer r..." is a room the visitor cannot
 * identify. Only when even the smallest size will not hold the longest word is
 * anything cut, and then a single ellipsis says so.
 */
function fitLabel(text: string, boxWidth: number, boxHeight: number): FittedLabel | null {
  const usableWidth = boxWidth - 8;
  const usableHeight = boxHeight - 6;
  if (usableWidth < 24 || usableHeight < 12) return null;

  for (let fontSize = 21; fontSize >= 9; fontSize -= 1) {
    const maxChars = Math.floor(usableWidth / (fontSize * GLYPH_RATIO));
    if (maxChars < 2) continue;
    const lines = wrapWords(text, maxChars);
    if (!lines) continue;
    if (lines.length * fontSize * LINE_SPACING <= usableHeight) return { fontSize, lines };
  }

  // Nothing fits cleanly: shrink to the floor and cut the one line that is left.
  const fontSize = 9;
  const maxChars = Math.max(2, Math.floor(usableWidth / (fontSize * GLYPH_RATIO)));
  const maxLines = Math.max(1, Math.floor(usableHeight / (fontSize * LINE_SPACING)));
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const chunk = current ? `${current} ${word}` : word;
    if (chunk.length <= maxChars) {
      current = chunk;
      continue;
    }
    if (current) lines.push(current);
    current = word.length > maxChars ? `${word.slice(0, Math.max(1, maxChars - 1))}…` : word;
    if (lines.length >= maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines.length > 0 ? { fontSize, lines: lines.slice(0, maxLines) } : null;
}

// ---------------------------------------------------------------------------

export function CampusMapView({
  levels,
  rooms,
  walkways,
  route,
  directions,
  fromCode,
  toCode,
  pick,
  maximised,
  locale,
  dictionary: t,
  width,
  height,
}: Props) {
  const router = useRouter();
  const routeLevels = route?.levelCodes ?? [];
  const [activeLevel, setActiveLevel] = useState(
    () => routeLevels[0] ?? levels.find((level) => level.ordinal === 0)?.code ?? levels[0]?.code ?? '',
  );
  const [query, setQuery] = useState('');
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);
  const minimiseRef = useRef<HTMLAnchorElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  const nameOf = (room: CampusRoom) => (locale === 'ms' ? room.nameMs : room.nameEn);
  const roomByCode = useMemo(() => new Map(rooms.map((room) => [room.code, room])), [rooms]);

  const levelRooms = useMemo(
    () => rooms.filter((room) => room.levelCode === activeLevel),
    [rooms, activeLevel],
  );

  const levelWalkways = useMemo(
    () => walkways.filter((walkway) => walkway.levelCode === activeLevel),
    [walkways, activeLevel],
  );

  // Whichever end is not being picked is excluded, so a route can never start
  // and finish in the same room.
  const otherEnd = pick === 'from' ? toCode : fromCode;

  const searchResults = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = rooms.filter((room) => {
      if (!room.isNavigable || room.code === otherEnd) return false;
      if (!needle) return true;
      return `${room.nameEn} ${room.nameMs} ${room.block ?? ''} ${room.code}`
        .toLowerCase()
        .includes(needle);
    });
    // Alphabetical by the name actually on screen, so the order matches what
    // the visitor is reading rather than the internal codes.
    return matches.sort((a, b) =>
      nameOf(a).localeCompare(nameOf(b), locale === 'ms' ? 'ms' : 'en'),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rooms, query, otherEnd, locale]);

  const levelName = (code: string) => {
    const level = levels.find((entry) => entry.code === code);
    if (!level) return code;
    return locale === 'ms' ? level.nameMs : level.nameEn;
  };

  const activeSegment = route?.segments.find((segment) => segment.levelCode === activeLevel) ?? null;

  /**
   * The rectangle of plan the SVG shows.
   *
   * Normally the whole plan, so a staircase stays in the same place on screen
   * when the visitor changes level. Filling the screen is the one case worth
   * breaking that for: the upper floors only occupy the top half of the frame,
   * and keeping the empty half would waste the space the bigger view exists to
   * provide. Fitted to the level on show, the plan comes out roughly twice the
   * size on every floor above the ground.
   */
  const frame = useMemo(() => {
    const whole = { x: 0, y: 0, w: width, h: height };
    if (!maximised) return whole;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const cover = (x1: number, y1: number, x2: number, y2: number) => {
      minX = Math.min(minX, x1);
      minY = Math.min(minY, y1);
      maxX = Math.max(maxX, x2);
      maxY = Math.max(maxY, y2);
    };

    for (const room of levelRooms) {
      cover(
        room.x - room.width / 2,
        room.y - room.height / 2,
        room.x + room.width / 2,
        room.y + room.height / 2,
      );
    }
    for (const walkway of levelWalkways) {
      cover(
        Math.min(walkway.x1, walkway.x2),
        Math.min(walkway.y1, walkway.y2),
        Math.max(walkway.x1, walkway.x2),
        Math.max(walkway.y1, walkway.y2),
      );
    }
    for (const point of activeSegment?.points ?? []) {
      // The markers sit above their point, so the top needs the extra room.
      cover(point.x, point.y - 58, point.x, point.y);
    }

    if (!Number.isFinite(minX)) return whole;

    const padding = 36;
    return {
      x: minX - padding,
      y: minY - padding,
      w: maxX - minX + padding * 2,
      h: maxY - minY + padding * 2,
    };
  }, [maximised, levelRooms, levelWalkways, activeSegment, width, height]);
  const pathData = activeSegment
    ? activeSegment.points.map((point, index) => `${index ? 'L' : 'M'}${point.x},${point.y}`).join('')
    : null;

  // --- Links ----------------------------------------------------------------
  //
  // Screen-filling mode is a URL parameter rather than component state, and it
  // has to be: while the map fills the screen the destination list is hidden, so
  // tapping a room on the plan is the only way to choose one. Held in state, the
  // navigation that follows would throw the visitor straight back out of the
  // view they just asked for.

  const linkTo = (next: { from?: string | null; to?: string | null; pick: PickTarget }) => {
    const params = new URLSearchParams();
    if (next.from) params.set('from', next.from);
    if (next.to) params.set('to', next.to);
    params.set('pick', next.pick);
    if (maximised) params.set('view', 'full');
    return `/map?${params.toString()}`;
  };

  /** A link that sets whichever end is being picked, then offers the other. */
  const hrefFor = (roomCode: string) =>
    linkTo({
      from: pick === 'from' ? roomCode : fromCode,
      to: pick === 'to' ? roomCode : toCode,
      pick: pick === 'from' ? 'to' : 'from',
    });

  const hrefForPick = (target: PickTarget) => linkTo({ from: fromCode, to: toCode, pick: target });

  const clearHref = maximised ? '/map?pick=from&view=full' : '/map?pick=from';

  /** The maximise / minimise toggle, keeping both ends of the journey. */
  const viewHref = (() => {
    const params = new URLSearchParams();
    if (fromCode) params.set('from', fromCode);
    if (toCode) params.set('to', toCode);
    params.set('pick', pick);
    if (!maximised) params.set('view', 'full');
    return `/map?${params.toString()}`;
  })();

  const endLabel = (code: string | null) => {
    if (!code) return null;
    const room = roomByCode.get(code);
    return room ? nameOf(room) : null;
  };

  // --- Screen-filling mode --------------------------------------------------

  useEffect(() => {
    if (!maximised) return;

    // The plan covers the page, so the page behind it must not scroll, and
    // Escape has to be a way out - a visitor who cannot find the button still
    // has the key every other full-screen thing on the web responds to.
    //
    // Tab is kept inside the view for the same reason the mode exists: the
    // header and footer are still in the document behind an opaque panel, and a
    // keyboard or screen-reader user who tabbed into them would be operating
    // controls they cannot see. `aria-modal` says focus is contained; this is
    // what makes that true rather than a claim.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        router.push(viewHref);
        return;
      }
      if (event.key !== 'Tab') return;

      const root = dialogRef.current;
      if (!root) return;
      const focusable = root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;

      if (active instanceof Node && !root.contains(active)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown);
    minimiseRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [maximised, router, viewHref]);

  // --- Zoom and pan ---------------------------------------------------------

  const clamp = (scale: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

  const zoomBy = (factor: number) =>
    setView((current) => {
      const scale = clamp(current.scale * factor);
      // Snapping back to the origin at 1x stops the plan drifting off screen
      // after a pinch, which on a kiosk nobody knows how to recover from.
      if (scale === 1) return { scale: 1, x: 0, y: 0 };
      return { ...current, scale };
    });

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (view.scale === 1) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: view.x,
      originY: view.y,
      moved: false,
    };
  };

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const unitsPerPixel = frame.w / rect.width;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    // Only claim the pointer once it has actually travelled, so a tap on a room
    // still registers as a tap.
    if (!drag.moved && Math.hypot(dx, dy) > 4) {
      drag.moved = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    if (!drag.moved) return;
    setView((current) => ({
      ...current,
      x: drag.originX + dx * unitsPerPixel,
      y: drag.originY + dy * unitsPerPixel,
    }));
  };

  const endDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  };

  // --- Shared pieces --------------------------------------------------------

  const buttonClass =
    'min-h-11 rounded-lg border border-[var(--line-strong)] bg-[var(--surface-card)] px-3 text-sm font-medium text-[var(--text-body)] hover:bg-[var(--surface-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]';

  const pickTabClass = (active: boolean) =>
    `min-h-11 flex-1 rounded-lg border px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] ${
      active
        ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-text)]'
        : 'border-[var(--line-strong)] bg-[var(--surface-card)] text-[var(--text-body)] hover:bg-[var(--surface-muted)]'
    }`;

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap gap-1" role="group" aria-label={t.level}>
        {levels.map((level) => {
          const onRoute = routeLevels.includes(level.code);
          const active = level.code === activeLevel;
          return (
            <button
              key={level.code}
              type="button"
              onClick={() => setActiveLevel(level.code)}
              aria-pressed={active}
              className={`min-h-11 rounded-lg border px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] ${
                active
                  ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-text)]'
                  : 'border-[var(--line-strong)] bg-[var(--surface-card)] text-[var(--text-body)] hover:bg-[var(--surface-muted)]'
              }`}
            >
              {locale === 'ms' ? level.nameMs : level.nameEn}
              {onRoute && !active ? (
                <span aria-hidden className="ml-1 inline-block h-2 w-2 rounded-full bg-[var(--map-route)]" />
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="ml-auto flex gap-1">
        <button
          type="button"
          onClick={() => zoomBy(1 / 1.4)}
          className={`${buttonClass} min-w-11 text-lg font-semibold`}
          aria-label={t.zoomOut}
        >
          &minus;
        </button>
        <button
          type="button"
          onClick={() => zoomBy(1.4)}
          className={`${buttonClass} min-w-11 text-lg font-semibold`}
          aria-label={t.zoomIn}
        >
          +
        </button>
        {/* Labelled rather than icon-only: the visitors this helps most are the
            ones least likely to recognise an expand glyph. */}
        <Link
          ref={minimiseRef}
          href={viewHref}
          scroll={false}
          title={maximised ? undefined : t.maximiseHint}
          className={`${buttonClass} inline-flex items-center gap-2 ${
            maximised ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-text)]' : ''
          }`}
        >
          <span aria-hidden>{maximised ? '⤡' : '⤢'}</span>
          {maximised ? t.minimise : t.maximise}
        </Link>
      </div>
    </div>
  );

  const plan = (
    <svg
      viewBox={`${frame.x} ${frame.y} ${frame.w} ${frame.h}`}
      className={`block w-full touch-none ${maximised ? 'h-full' : 'h-auto'}`}
      style={{ cursor: view.scale > 1 ? 'grab' : 'default' }}
      aria-label={`${t.showingLevel} ${levelName(activeLevel)}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <g
        transform={`translate(${frame.x + frame.w / 2} ${frame.y + frame.h / 2}) scale(${view.scale}) translate(${-(frame.x + frame.w / 2) + view.x} ${-(frame.y + frame.h / 2) + view.y})`}
      >
        {/* Corridors and covered walkways, under everything else. */}
        {levelWalkways.map((walkway, index) => (
          <line
            key={index}
            x1={walkway.x1}
            y1={walkway.y1}
            x2={walkway.x2}
            y2={walkway.y2}
            stroke="var(--map-circulation)"
            strokeWidth={26}
            strokeLinecap="round"
          />
        ))}

        {/* Rooms. Each is a link that sets whichever end is being picked. */}
        {levelRooms.map((room) => {
          const isOrigin = room.code === fromCode;
          const isTarget = room.code === toCode;
          const marked = isOrigin || isTarget;
          const label = fitLabel(nameOf(room), room.width, room.height);

          return (
            <Link key={room.code} href={hrefFor(room.code)} scroll={false} aria-label={nameOf(room)}>
              <rect
                x={room.x - room.width / 2}
                y={room.y - room.height / 2}
                width={room.width}
                height={room.height}
                rx={6}
                fill={marked ? 'var(--map-route)' : CATEGORY_FILL[room.category]}
                stroke={marked ? 'var(--map-route)' : 'var(--map-outline)'}
                strokeWidth={marked ? 5 : 1.5}
              />
              {label ? (
                <text
                  x={room.x}
                  textAnchor="middle"
                  fontSize={label.fontSize}
                  fontWeight={600}
                  fill={marked ? '#ffffff' : 'var(--map-ink)'}
                  style={{ pointerEvents: 'none' }}
                >
                  {label.lines.map((line, index) => (
                    <tspan
                      key={index}
                      x={room.x}
                      y={
                        room.y -
                        ((label.lines.length - 1) * label.fontSize * LINE_SPACING) / 2 +
                        index * label.fontSize * LINE_SPACING +
                        label.fontSize * 0.34
                      }
                    >
                      {line}
                    </tspan>
                  ))}
                </text>
              ) : null}
            </Link>
          );
        })}

        {/* Route: flat base line, then the dashed line marching along it. */}
        {pathData ? (
          <g style={{ pointerEvents: 'none' }}>
            <path
              d={pathData}
              fill="none"
              stroke="var(--map-route-base)"
              strokeWidth={14}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              className="map-route-line"
              d={pathData}
              fill="none"
              stroke="var(--map-route)"
              strokeWidth={8}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="26 22"
            />
          </g>
        ) : null}

        {/* Start and end markers, drawn last so nothing covers them. */}
        {activeSegment && activeSegment.points.length > 0 ? (
          <>
            <Marker point={activeSegment.points[0]!} label="A" />
            <Marker point={activeSegment.points[activeSegment.points.length - 1]!} label="B" />
          </>
        ) : null}
      </g>
    </svg>
  );

  const routeElsewhere =
    route && routeLevels.length > 1 && !routeLevels.includes(activeLevel) ? (
      <p className="rounded-lg border border-[var(--line-soft)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text-muted)]">
        {t.routeOnAnotherLevel}
      </p>
    ) : null;

  /**
   * The written route. Not a fallback for the drawing - the drawing is the
   * fallback for this. A line on a plan is unreadable with a screen reader and
   * hard to follow on a bright kiosk outdoors.
   */
  const writtenDirections = (large: boolean) => (
    <>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)]">
        {t.directions}
      </h2>
      {directions.steps.length > 0 ? (
        <>
          {directions.summary ? (
            <p className={`mt-1 text-[var(--text-muted)] ${large ? 'text-sm' : 'text-sm'}`}>
              {directions.summary}
            </p>
          ) : null}
          <ol
            className={`mt-2 list-decimal space-y-1.5 pl-5 text-[var(--text-body)] ${
              large ? 'text-base' : 'text-sm'
            }`}
          >
            {directions.steps.map((step, index) => (
              <li key={index}>{step}</li>
            ))}
          </ol>
        </>
      ) : (
        <p className={`mt-2 text-[var(--text-muted)] ${large ? 'text-base' : 'text-sm'}`}>
          {directions.notice ?? t.needBothEnds}
        </p>
      )}
    </>
  );

  // --- Screen-filling layout ------------------------------------------------

  if (maximised) {
    return (
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t.title}
        className="fixed inset-0 z-50 flex flex-col bg-[var(--surface-page)]"
      >
        <div className="shrink-0 border-b border-[var(--line-soft)] bg-[var(--surface-card)] px-3 py-2">
          {toolbar}
        </div>

        {/* The plan takes every pixel left over; the directions keep a fixed
            share at the bottom so they never push it off the screen. */}
        <div className="min-h-0 flex-1 bg-[var(--map-paper)] p-2">{plan}</div>

        <div className="max-h-[34vh] shrink-0 overflow-y-auto border-t border-[var(--line-soft)] bg-[var(--surface-card)] px-4 py-3">
          {routeElsewhere ? <div className="mb-2">{routeElsewhere}</div> : null}
          {writtenDirections(true)}
        </div>
      </div>
    );
  }

  // --- Ordinary layout ------------------------------------------------------

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,23rem)_minmax(0,1fr)]">
        {/* -------------------------------------------------------------- */}
        {/* Journey ends                                                   */}
        {/* -------------------------------------------------------------- */}
        <div className="flex flex-col gap-3">
          <div className="flex gap-2" role="group" aria-label={t.whichEnd}>
            <Link href={hrefForPick('from')} aria-current={pick === 'from'} className={pickTabClass(pick === 'from')}>
              <span className="flex flex-col items-start justify-center py-1">
                <span className="text-[10px] uppercase tracking-wide opacity-80">{t.startingPoint}</span>
                <span className="text-sm leading-tight">{endLabel(fromCode) ?? t.notChosen}</span>
              </span>
            </Link>
            <Link href={hrefForPick('to')} aria-current={pick === 'to'} className={pickTabClass(pick === 'to')}>
              <span className="flex flex-col items-start justify-center py-1">
                <span className="text-[10px] uppercase tracking-wide opacity-80">{t.destination}</span>
                <span className="text-sm leading-tight">{endLabel(toCode) ?? t.notChosen}</span>
              </span>
            </Link>
          </div>

          <div>
            <label
              htmlFor="map-search"
              className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]"
            >
              {pick === 'from' ? t.chooseStart : t.chooseDestination}
            </label>
            <input
              id="map-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t.searchPlaceholder}
              className="min-h-11 w-full rounded-lg border border-[var(--line-strong)] bg-[var(--surface-card)] px-3 py-2 text-[var(--text-body)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
            />
          </div>

          <ul className="max-h-[24rem] overflow-y-auto rounded-lg border border-[var(--line-soft)] bg-[var(--surface-card)]">
            {searchResults.length === 0 ? (
              <li className="px-3 py-4 text-sm text-[var(--text-muted)]">{t.noMatches}</li>
            ) : (
              searchResults.map((room) => {
                const selected = room.code === (pick === 'from' ? fromCode : toCode);
                return (
                  <li key={room.code} className="border-b border-[var(--line-soft)] last:border-b-0">
                    <Link
                      href={hrefFor(room.code)}
                      aria-current={selected ? 'true' : undefined}
                      className={`flex min-h-11 items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-[var(--surface-muted)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--focus-ring)] ${
                        selected ? 'bg-[var(--accent-soft)] font-semibold' : ''
                      }`}
                    >
                      <span className="text-[var(--text-body)]">{nameOf(room)}</span>
                      <span className="shrink-0 text-xs text-[var(--text-muted)]">
                        {levelName(room.levelCode)}
                        {room.block ? ` · ${room.block}` : ''}
                      </span>
                    </Link>
                  </li>
                );
              })
            )}
          </ul>

          {fromCode || toCode ? (
            <Link
              href={clearHref}
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line-strong)] px-4 text-sm font-medium text-[var(--text-body)] hover:bg-[var(--surface-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
            >
              {t.clear}
            </Link>
          ) : null}
        </div>

        {/* -------------------------------------------------------------- */}
        {/* The plan                                                       */}
        {/* -------------------------------------------------------------- */}
        <div className="flex flex-col gap-3">
          {toolbar}

          <p className="text-sm text-[var(--text-muted)]">
            {pick === 'from' ? t.tapToSetStart : t.tapToSetDestination}
          </p>

          {routeElsewhere}

          <div className="overflow-hidden rounded-xl border border-[var(--line-soft)] bg-[var(--map-paper)]">
            {plan}
          </div>

          {/* Legend, in the same order as the printed plan. */}
          <div>
            <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              {t.legend}
            </h2>
            <ul className="flex flex-wrap gap-x-4 gap-y-1">
              {LEGEND_ORDER.map((category) => (
                <li key={category} className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                  <span
                    aria-hidden
                    className="inline-block h-3 w-3 rounded-sm border border-[var(--map-outline)]"
                    style={{ background: CATEGORY_FILL[category] }}
                  />
                  {t.categories[category]}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <section className="mt-6 rounded-xl border border-[var(--line-soft)] bg-[var(--surface-card)] p-4">
        {writtenDirections(false)}
      </section>
    </>
  );
}

function Marker({ point, label }: { point: { x: number; y: number }; label: string }) {
  return (
    <g style={{ pointerEvents: 'none' }}>
      <circle cx={point.x} cy={point.y - 34} r={20} fill="var(--map-route)" stroke="#ffffff" strokeWidth={4} />
      <text x={point.x} y={point.y - 27} textAnchor="middle" fontSize={22} fontWeight={700} fill="#ffffff">
        {label}
      </text>
    </g>
  );
}
