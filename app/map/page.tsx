import type { Metadata } from 'next';
import { z } from 'zod';
import { loadCampusMap, routeBetween } from '@/lib/map/campus';
import { DEFAULT_ORIGIN_CODE } from '@/lib/map/campus-plan';
import { getMapDictionary, renderRouteStep } from '@/lib/i18n/map-dictionary';
import { getLocale } from '@/lib/theme';
import { Alert, PageHeading } from '@/components/ui/surface';
import {
  CampusMapView,
  type DirectionsView,
  type PickTarget,
  type RouteView,
} from './campus-map-view';

export const metadata: Metadata = {
  title: 'School map',
  description: 'Find your way around SMK Bandar Baru Sri Petaling.',
};

export const dynamic = 'force-dynamic';

/**
 * Public campus wayfinding.
 *
 * The route is computed here, on the server, and the answer is a function of
 * the URL alone. That buys three things worth more than the round trip it
 * costs: the graph never reaches the browser, every route is a link somebody
 * can send to a visitor, and the page still works for a visitor whose phone has
 * blocked the script.
 *
 * The journey starts at the guard house unless the visitor says otherwise,
 * because that is where most of them are standing when they first need this.
 * It is a default, not an assumption: the starting point is a full picker, so
 * a parent already inside for an assembly changes it in one tap.
 *
 * No authentication and no personal data: this reads reference geometry and
 * nothing else, which is why it can sit on the public side of the middleware
 * beside the appointment request form.
 */

/** Node codes are `LEVEL.BLOCK.ROOM`; anything else never existed on the map. */
const nodeCode = z
  .string()
  .max(64)
  .regex(/^[A-Za-z0-9_.]+$/);

const searchSchema = z.object({
  from: nodeCode.optional(),
  to: nodeCode.optional(),
  pick: z.enum(['from', 'to']).optional(),
  /** Screen-filling mode: the plan and the directions, nothing else. */
  view: z.enum(['full']).optional(),
});

const first = (value: string | string[] | undefined): string | undefined =>
  typeof value === 'string' ? value : undefined;

export default async function CampusMapPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const locale = await getLocale();
  const t = getMapDictionary(locale);

  // A malformed query string is a bookmark that rotted, not an attack worth an
  // error page: fall back to an empty journey and let the visitor pick again.
  const parsed = searchSchema.safeParse({
    from: first(raw.from),
    to: first(raw.to),
    pick: first(raw.pick),
    view: first(raw.view),
  });
  const params = parsed.success ? parsed.data : {};

  const map = await loadCampusMap();

  const fromCode =
    params.from && map.graph.nodes.has(params.from) ? params.from : DEFAULT_ORIGIN_CODE;
  const toCode = params.to && map.graph.nodes.has(params.to) ? params.to : null;

  // The start is already filled in, so the destination is what to ask for next.
  const pick: PickTarget = params.pick ?? 'to';

  const described = fromCode && toCode ? routeBetween(map, fromCode, toCode, locale) : null;

  const levelNameOf = (code: string) => {
    const level = map.levels.find((entry) => entry.code === code);
    if (!level) return code;
    return locale === 'ms' ? level.nameMs : level.nameEn;
  };

  const maximised = params.view === 'full';

  /*
   * The directions are rendered here, as sentences, and handed to the view as
   * strings. The view decides where to put them - beneath the plan normally, in
   * a strip along the bottom when the map fills the screen - but it never has to
   * know how a step becomes a sentence.
   */
  const directions: DirectionsView = described
    ? {
        summary:
          `${t.distance}: ${described.displayMetres} m · ~${described.walkingMinutes} ${t.walkMinutes}` +
          (new Set(described.segments.map((segment) => segment.levelCode)).size > 1
            ? ` · ${t.levelsOnRoute}`
            : ''),
        steps: described.steps.map((step) =>
          renderRouteStep(locale, step, levelNameOf(step.toLevelCode ?? step.levelCode)),
        ),
      }
    : {
        summary: null,
        steps: [],
        // Both ends chosen but nothing connects them. Without this the panel
        // would ask for a destination the visitor has already given.
        notice: fromCode && toCode ? t.unreachable : undefined,
      };

  const routeView: RouteView | null = described
    ? {
        segments: described.segments,
        displayMetres: described.displayMetres,
        walkingMinutes: described.walkingMinutes,
        levelCodes: described.segments.map((segment) => segment.levelCode),
      }
    : null;

  /*
   * An empty map means the plan has never been written to this database -
   * migrations create the tables, `npm run map:sync` fills them. Say so
   * plainly rather than rendering a page with nothing on it: a visitor at the
   * gate needs to be told to ask someone, not left staring at a blank frame.
   */
  if (map.levels.length === 0) {
    return (
      <>
        <PageHeading title={t.title} />
        <Alert tone="warning">{t.mapUnavailable}</Alert>
      </>
    );
  }

  return (
    <>
      {/* Both are covered by the screen-filling view, so they are not rendered
          underneath it; the warning travels with the directions instead. */}
      {maximised ? null : <PageHeading title={t.title} description={t.subtitle} />}

      {!maximised && fromCode && toCode && !described ? (
        <div className="mb-4">
          <Alert tone="warning">{t.unreachable}</Alert>
        </div>
      ) : null}

      <CampusMapView
        levels={map.levels}
        rooms={map.rooms}
        walkways={map.walkways}
        route={routeView}
        directions={directions}
        fromCode={fromCode}
        toCode={toCode}
        pick={pick}
        maximised={maximised}
        locale={locale}
        dictionary={t}
        width={map.width}
        height={map.height}
      />

    </>
  );
}
