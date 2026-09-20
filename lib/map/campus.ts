import { cache } from 'react';
import { MapEdgeKind, MapNodeCategory, MapNodeKind } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import type { Locale } from '@/lib/constants';
import { MAP_METRES_PER_UNIT, PLAN_HEIGHT, PLAN_WIDTH } from '@/lib/map/campus-plan';
import { buildRouteGraph, describeRoute, findRoute, type DescribedRoute, type RouteGraph } from '@/lib/map/route';

/**
 * Reads the school map out of the database and answers routing questions.
 *
 * The whole map is about a thousand nodes and three thousand edges, which is
 * two small queries and well under a megabyte. Loading it whole and routing in
 * process is both simpler and faster than a recursive SQL traversal, and it
 * keeps the algorithm in a module that tests can drive without a database.
 *
 * `cache` deduplicates the load within one request: a page that renders the map
 * and the written directions asks for the graph twice and pays for it once.
 */

export interface CampusLevel {
  code: string;
  ordinal: number;
  nameEn: string;
  nameMs: string;
}

export interface CampusRoom {
  code: string;
  levelCode: string;
  /** A stair tower is drawn like a room but is circulation, not a destination. */
  kind: MapNodeKind;
  category: MapNodeCategory;
  nameEn: string;
  nameMs: string;
  block: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  isNavigable: boolean;
}

/** A drawable stretch of corridor or covered walkway. */
export interface CampusWalkway {
  levelCode: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface CampusMap {
  levels: CampusLevel[];
  rooms: CampusRoom[];
  walkways: CampusWalkway[];
  graph: RouteGraph;
  width: number;
  height: number;
}

/**
 * Rooms nobody is ever directed to, and that only clutter the search list.
 * They stay on the drawing - the plan would read wrong with holes in it - but
 * a visitor is never told to go to a switch room.
 */
const NON_DESTINATION_PATTERN = /^(SUIS|PAM|STOR|PERSEDIAAN)/;

export const loadCampusMap = cache(async (): Promise<CampusMap> => {
  const [levels, nodes, edges] = await Promise.all([
    prisma.mapLevel.findMany({ orderBy: { ordinal: 'asc' } }),
    prisma.mapNode.findMany({ include: { level: { select: { code: true, ordinal: true } } } }),
    prisma.mapEdge.findMany({
      select: {
        kind: true,
        weight: true,
        from: { select: { code: true } },
        to: { select: { code: true } },
      },
    }),
  ]);

  const graph = buildRouteGraph(
    nodes.map((node) => ({
      code: node.code,
      levelCode: node.level.code,
      levelOrdinal: node.level.ordinal,
      kind: node.kind,
      nameEn: node.nameEn,
      nameMs: node.nameMs,
      x: node.x,
      y: node.y,
    })),
    edges.map((edge) => ({
      fromCode: edge.from.code,
      toCode: edge.to.code,
      kind: edge.kind,
      weight: edge.weight,
    })),
  );

  // The walkable edges between junctions are the corridors themselves. Drawing
  // them is what turns a scatter of labelled boxes into a floor plan; edges that
  // touch a room are left out, because those are doorways and drawing them would
  // put a line through the middle of every room.
  const byCode = new Map(nodes.map((node) => [node.code, node]));
  const walkways: CampusWalkway[] = [];
  for (const edge of edges) {
    if (edge.kind === MapEdgeKind.STAIR) continue;
    const from = byCode.get(edge.from.code);
    const to = byCode.get(edge.to.code);
    if (!from || !to) continue;
    if (from.kind === MapNodeKind.ROOM || to.kind === MapNodeKind.ROOM) continue;
    if (from.levelId !== to.levelId) continue;
    walkways.push({ levelCode: from.level.code, x1: from.x, y1: from.y, x2: to.x, y2: to.y });
  }

  const rooms: CampusRoom[] = nodes
    .filter(
      (node) =>
        node.width !== null &&
        node.height !== null &&
        node.nameEn !== null &&
        node.nameMs !== null &&
        node.kind !== MapNodeKind.JUNCTION,
    )
    .map((node) => {
      const bareCode = node.code.split('.').pop() ?? node.code;
      return {
        code: node.code,
        levelCode: node.level.code,
        kind: node.kind,
        category: node.category,
        nameEn: node.nameEn!,
        nameMs: node.nameMs!,
        block: node.block,
        x: node.x,
        y: node.y,
        width: node.width!,
        height: node.height!,
        // A concourse is somewhere you walk through, not somewhere you go, so
        // circulation space is drawn and routed across but never offered.
        isNavigable:
          node.kind !== MapNodeKind.STAIR &&
          node.category !== MapNodeCategory.CIRCULATION &&
          !NON_DESTINATION_PATTERN.test(bareCode),
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));

  return {
    levels: levels.map(({ code, ordinal, nameEn, nameMs }) => ({ code, ordinal, nameEn, nameMs })),
    rooms,
    walkways,
    graph,
    width: PLAN_WIDTH,
    height: PLAN_HEIGHT,
  };
});

/**
 * Route between two places, described in the visitor's language.
 *
 * Returns null rather than throwing when either end is unknown or unreachable:
 * a stale bookmark or a destination an administrator has since unbound from the
 * map is a normal state for a public kiosk, and it renders as "pick a
 * destination", not as an error page.
 */
export function routeBetween(
  map: CampusMap,
  fromCode: string,
  toCode: string,
  locale: Locale,
): DescribedRoute | null {
  const route = findRoute(map.graph, fromCode, toCode);
  if (!route || route.path.length < 2) return null;
  return describeRoute(map.graph, route, locale, MAP_METRES_PER_UNIT);
}

/** The map node a visitor's destination row points at, if it has one. */
export async function mapNodeCodeForDestination(destinationId: string): Promise<string | null> {
  const destination = await prisma.destination.findUnique({
    where: { id: destinationId },
    select: { mapNode: { select: { code: true } } },
  });
  return destination?.mapNode?.code ?? null;
}
