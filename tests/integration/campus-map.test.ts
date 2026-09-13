import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MapNodeKind } from '@prisma/client';
import { testDb } from '../helpers/db';
import { buildCampusPlan, DEFAULT_ORIGIN_CODE, DESTINATION_MAP_NODES } from '@/lib/map/campus-plan';
import { loadCampusMap, routeBetween } from '@/lib/map/campus';

/**
 * The map survives the round trip through Postgres.
 *
 * The unit tests prove the graph is sound in memory; this proves nothing is
 * lost writing it down and reading it back - coordinates surviving as floats,
 * edges keeping their endpoints, and a destination row resolving to the room a
 * visitor was told to go to.
 */

const FIXTURE_DESTINATIONS = ['MAPTEST', 'MAPTEST2'];

async function clearMap(): Promise<void> {
  await testDb.destination.deleteMany({ where: { code: { in: FIXTURE_DESTINATIONS } } });
  await testDb.destination.updateMany({ data: { mapNodeId: null } });
  await testDb.mapEdge.deleteMany();
  await testDb.mapNode.deleteMany();
  await testDb.mapLevel.deleteMany();
}

beforeAll(async () => {
  await clearMap();

  const plan = buildCampusPlan();
  await testDb.mapLevel.createMany({ data: plan.levels });
  const levelIds = new Map(
    (await testDb.mapLevel.findMany({ select: { id: true, code: true } })).map((l) => [l.code, l.id]),
  );

  await testDb.mapNode.createMany({
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
    (await testDb.mapNode.findMany({ select: { id: true, code: true } })).map((n) => [n.code, n.id]),
  );
  await testDb.mapEdge.createMany({
    data: plan.edges.map((edge) => ({
      fromId: nodeIds.get(edge.fromCode)!,
      toId: nodeIds.get(edge.toCode)!,
      kind: edge.kind,
      weight: edge.weight,
    })),
  });
});

afterAll(async () => {
  await clearMap();
});

describe('school map persistence', () => {
  it('stores every level, node and edge the plan describes', async () => {
    const plan = buildCampusPlan();
    expect(await testDb.mapLevel.count()).toBe(plan.levels.length);
    expect(await testDb.mapNode.count()).toBe(plan.nodes.length);
    expect(await testDb.mapEdge.count()).toBe(plan.edges.length);
  });

  it('routes from the database with the same answer as the plan', async () => {
    const map = await loadCampusMap();
    const route = routeBetween(map, DEFAULT_ORIGIN_CODE, 'L1.A.PENGETUA', 'en');

    expect(route).not.toBeNull();
    expect(route!.metres).toBeGreaterThan(0);
    expect(route!.steps[0]!.kind).toBe('start');
    expect(route!.steps.at(-1)!.kind).toBe('arrive');
    expect(route!.steps.at(-1)!.place).toBe("Principal's office");
    expect(route!.segments.map((segment) => segment.levelCode)).toEqual(['G', 'L1']);
  });

  it('offers only rooms a visitor could be sent to', async () => {
    const map = await loadCampusMap();
    const navigable = map.rooms.filter((room) => room.isNavigable).map((room) => room.code);

    // Switch rooms and stores are drawn, because the plan has them, but nobody
    // is ever routed to one.
    expect(navigable).not.toContain('G.A.SUIS_A');
    expect(navigable).not.toContain('L1.B.STOR_PEJABAT');
    expect(navigable).toContain('L1.A.PENGETUA');
    expect(navigable).toContain('G.KANTIN');
  });

  it('draws corridors without drawing a line through any room', async () => {
    const map = await loadCampusMap();
    expect(map.walkways.length).toBeGreaterThan(0);

    // Stair towers are excluded: a walkway is supposed to run into a staircase,
    // and one legitimately terminates at its centre.
    const roomCentres = new Set(
      map.rooms
        .filter((room) => room.kind === MapNodeKind.ROOM)
        .map((room) => `${room.x},${room.y}`),
    );
    for (const walkway of map.walkways) {
      expect(roomCentres.has(`${walkway.x1},${walkway.y1}`)).toBe(false);
      expect(roomCentres.has(`${walkway.x2},${walkway.y2}`)).toBe(false);
    }
  });

  it('resolves a seeded destination to the room the visitor was told to find', async () => {
    const nodeCode = DESTINATION_MAP_NODES.LIBRARY!;
    const node = await testDb.mapNode.findUnique({ where: { code: nodeCode } });
    expect(node).not.toBeNull();
    expect(node!.kind).toBe(MapNodeKind.ROOM);

    const destination = await testDb.destination.create({
      data: {
        code: 'MAPTEST',
        nameEn: 'Library / Resource Centre',
        nameMs: 'Bejana Ilmu (PSS)',
        mapNodeId: node!.id,
      },
      include: { mapNode: { select: { code: true } } },
    });

    expect(destination.mapNode?.code).toBe(nodeCode);

    const map = await loadCampusMap();
    const route = routeBetween(map, DEFAULT_ORIGIN_CODE, destination.mapNode!.code, 'ms');
    expect(route).not.toBeNull();
    expect(route!.steps.at(-1)!.place).toBe('Bejana Ilmu (PSS)');
  });

  it('keeps a destination usable after its room is taken off the map', async () => {
    // An administrator redrawing the plan must not break check-in. The
    // destination survives with a null binding and simply stops being routable.
    const node = await testDb.mapNode.findUnique({
      where: { code: DESTINATION_MAP_NODES.HALL! },
      select: { id: true },
    });

    const destination = await testDb.destination.create({
      data: { code: 'MAPTEST2', nameEn: 'Hall', nameMs: 'Dewan', mapNodeId: node!.id },
    });

    await testDb.mapNode.delete({ where: { id: node!.id } });

    const after = await testDb.destination.findUnique({ where: { id: destination.id } });
    expect(after).not.toBeNull();
    expect(after!.mapNodeId).toBeNull();
  });
});
