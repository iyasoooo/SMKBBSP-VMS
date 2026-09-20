import { DestinationZone, MapNodeCategory, MapNodeKind } from '@prisma/client';
import type { Db } from '@/lib/db/prisma';
import { buildCampusPlan, DESTINATION_MAP_NODES } from '@/lib/map/campus-plan';

/**
 * Write the school map into the database.
 *
 * This is REFERENCE data, not demonstration data, and the distinction decides
 * where it may run. The demo seed refuses to touch a production database on
 * purpose - it invents visitors and appointments. The map invents nothing: it
 * is the school's own floor plan, and a deployment without it has a wayfinding
 * page with nothing to draw. So this module carries no `NODE_ENV` guard and is
 * safe to run against production, which is what `npm run map:sync` does at
 * deploy time.
 *
 * Everything here is idempotent. Running it twice leaves the same rows.
 */

export interface MapSyncResult {
  levels: number;
  nodes: number;
  edges: number;
  bound: number;
  derived: number;
}

/**
 * Rooms nobody is ever directed to. Mirrors the filter in `lib/map/campus.ts`,
 * which is the authority: a room the map refuses to route to must not appear in
 * the visitor's list either.
 */
const NON_DESTINATION_PATTERN = /^(SUIS|PAM|STOR|PERSEDIAAN)/;

/**
 * Rewritten wholesale rather than merged. The plan in `lib/map/campus-plan.ts`
 * is the authority for what the building looks like, and a partial update would
 * leave a renamed room orphaned in the graph with no way to notice. Destinations
 * are re-bound immediately afterwards, which is the only reason it is safe to
 * drop the nodes they point at.
 */
async function writePlan(db: Db): Promise<{ levels: number; nodes: number; edges: number }> {
  const plan = buildCampusPlan();

  await db.mapEdge.deleteMany();
  await db.mapNode.deleteMany();
  await db.mapLevel.deleteMany();

  await db.mapLevel.createMany({ data: plan.levels });
  const levelIds = new Map(
    (await db.mapLevel.findMany({ select: { id: true, code: true } })).map((l) => [l.code, l.id]),
  );

  await db.mapNode.createMany({
    data: plan.nodes.map((node) => ({
      levelId: levelIds.get(node.levelCode)!,
      code: node.code,
      kind: node.kind,
      category: node.category,
      nameEn: node.nameEn,
      nameMs: node.nameMs,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      block: node.block,
    })),
  });

  const nodeIds = new Map(
    (await db.mapNode.findMany({ select: { id: true, code: true } })).map((n) => [n.code, n.id]),
  );

  await db.mapEdge.createMany({
    data: plan.edges.map((edge) => ({
      fromId: nodeIds.get(edge.fromCode)!,
      toId: nodeIds.get(edge.toCode)!,
      kind: edge.kind,
      weight: edge.weight,
    })),
  });

  return { levels: plan.levels.length, nodes: plan.nodes.length, edges: plan.edges.length };
}

/**
 * Point each curated destination at the room it means on the plan.
 *
 * A destination with no binding still works everywhere else in the system; it
 * simply cannot be routed to, and the map offers the visitor a search instead.
 */
async function bindCuratedDestinations(db: Db, warn: (message: string) => void): Promise<number> {
  let bound = 0;
  for (const [destinationCode, nodeCode] of Object.entries(DESTINATION_MAP_NODES)) {
    const node = await db.mapNode.findUnique({ where: { code: nodeCode }, select: { id: true } });
    if (!node) {
      warn(`destination ${destinationCode} points at unknown map node ${nodeCode}`);
      continue;
    }
    const updated = await db.destination.updateMany({
      where: { code: destinationCode },
      data: { mapNodeId: node.id },
    });
    bound += updated.count;
  }
  return bound;
}

/**
 * Give every navigable room on the plan a destination row.
 *
 * The hand-written list covers the places a visitor usually asks for, but the
 * school has far more they might actually be sent to, and a parent meeting a
 * teacher in a specific classroom could not say so. Deriving the rest from the
 * map is what makes the picker complete without anyone maintaining a second
 * list by hand.
 *
 * Curated rows are left completely alone. They are matched by their bound map
 * node, so a hand-written instruction or a deliberate `COMMON` zone is never
 * overwritten by a generated one.
 */
async function deriveDestinations(db: Db): Promise<number> {
  const [rooms, curated] = await Promise.all([
    db.mapNode.findMany({
      where: { kind: { not: MapNodeKind.JUNCTION }, nameEn: { not: null }, nameMs: { not: null } },
      select: {
        id: true,
        code: true,
        kind: true,
        category: true,
        nameEn: true,
        nameMs: true,
        block: true,
        level: { select: { nameEn: true, nameMs: true } },
      },
    }),
    /*
     * Active rows only. A retired destination still occupies its map node, and
     * treating that as "covered" quietly removes a real place from the list.
     */
    db.destination.findMany({ where: { isActive: true }, select: { mapNodeId: true } }),
  ]);

  const alreadyBound = new Set(curated.map((row) => row.mapNodeId).filter(Boolean));
  let created = 0;

  for (const room of rooms) {
    const bareCode = room.code.split('.').pop() ?? room.code;
    const navigable =
      room.kind !== MapNodeKind.STAIR &&
      room.category !== MapNodeCategory.CIRCULATION &&
      !NON_DESTINATION_PATTERN.test(bareCode);

    if (!navigable || alreadyBound.has(room.id)) continue;

    /*
     * The map node code is reused as the destination code. It is already unique
     * and stable, so re-running this updates the same row instead of
     * accumulating duplicates, and an administrator reading the destinations
     * table can see exactly which room a row came from.
     */
    const spec = {
      code: `MAP:${room.code}`,
      nameEn: room.nameEn!,
      nameMs: room.nameMs!,
      // Where it is, rather than how to get there: the school map gives real
      // directions, and inventing prose for every room would be worse than
      // saying plainly which block and level to head for.
      instructionsEn: `${room.level.nameEn}${room.block ? `, Block ${room.block}` : ''}.`,
      instructionsMs: `${room.level.nameMs}${room.block ? `, Blok ${room.block}` : ''}.`,
      zone: DestinationZone.HOST_ONLY,
      isActive: true,
      mapNodeId: room.id,
    };

    await db.destination.upsert({ where: { code: spec.code }, create: spec, update: spec });
    created += 1;
  }

  return created;
}

/**
 * Bring the database's copy of the school map up to date with the plan.
 *
 * Order matters: the plan is written first, curated destinations are re-bound
 * to their rooms next, and only then are the remaining rooms derived - so a
 * curated row already pointing at a room is recognised and never duplicated by
 * a generated one.
 */
export async function syncSchoolMap(
  db: Db,
  warn: (message: string) => void = () => {},
): Promise<MapSyncResult> {
  const counts = await writePlan(db);
  const bound = await bindCuratedDestinations(db, warn);
  const derived = await deriveDestinations(db);
  return { ...counts, bound, derived };
}
