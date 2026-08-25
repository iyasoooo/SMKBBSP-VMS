# School Map

Interactive campus wayfinding for SMKBBSP VisitorPass. A visitor standing at the
guard house taps a destination (for example Kantin) and the screen draws the walking
path from where they are to where they are going.

Status: proposed. Not part of `docs/spec/PROJECT_SPEC.md` yet. Treat this as a scope
addition and add it to the spec before building it.

## Recommended toolchain (all free, all offline)

The short answer: **do not use a mapping service.** Google Maps, Mapbox and OpenStreetMap
routing all fail here for the same reason - they know public roads, not the footpaths
between Blok A and the canteen. They also need API keys, network access and (for Google
and Mapbox) a billing account, which the project's "no paid-service requirements" boundary
forbids.

A school campus is small and fixed. That makes the correct tool a hand-drawn SVG plus a
tiny graph of walkable points, with the shortest path computed in TypeScript.

| Need | Tool | Licence | Why |
| --- | --- | --- | --- |
| Draw the campus map | **Inkscape** (or Figma free tier) | GPL / free tier | Vector SVG, gives every building an `id` you can target from code. Trace over a satellite screenshot or the school's fire-evacuation plan, then delete the screenshot layer. |
| Shrink the export | **svgo** | MIT | Inkscape SVGs are bloated; svgo cuts them ~70% and keeps the ids. |
| Shortest path | **graphology** + **graphology-shortest-path** | MIT | Dijkstra over your node graph in ~10 lines. A hand-written A* (~60 lines) is also fine and is easier to defend in a viva - pick one and be consistent. |
| Pan and zoom on the guard tablet | **react-zoom-pan-pinch** | MIT | Pinch-zoom, double-tap, wheel. No canvas, keeps the SVG in the DOM so it stays accessible. |
| Animate the route line | none - plain SVG | - | `stroke-dasharray` + `stroke-dashoffset` gives the "drawing" effect in CSS alone. |

Nothing above needs a server, a key, or a network call, so the map still works if the
school's internet drops - which matters for a guard-house kiosk.

### Only if the map gets very large

If the campus SVG becomes too heavy to render at once, swap the renderer for **Leaflet**
with `CRS.Simple` and an `ImageOverlay` (BSD-2, no tile server, no account). Keep the same
node graph and feed Leaflet a `Polyline` of the result. Do not reach for this first; it is
a heavier dependency than the problem currently needs.

### Rejected

- **Google Maps Platform** - needs billing, has no interior campus paths.
- **Mapbox / Mapbox Indoor** - token + paid tier past the free quota.
- **OSRM / OpenRouteService** - routes cars and roads; there is no data for school walkways.
- **Situm, Mapwize, Pointr** - commercial indoor positioning, plus they imply beacons and
  live tracking, which the project excludes.

## How it fits this codebase

### Data model

Three additions to `prisma/schema.prisma`:

```prisma
model MapNode {
  id     String  @id @default(cuid())
  code   String  @unique          // "GUARD_HOUSE", "JUNCTION_3"
  label  String?                  // shown only for named places
  x      Float                    // SVG viewBox coordinates, not lat/lng
  y      Float
  floor  Int     @default(0)

  edgesFrom   MapEdge[]     @relation("from")
  edgesTo     MapEdge[]     @relation("to")
  destination Destination?
}

model MapEdge {
  id       String  @id @default(cuid())
  fromId   String
  toId     String
  from     MapNode @relation("from", fields: [fromId], references: [id])
  to       MapNode @relation("to", fields: [toId], references: [id])
  weight   Float                  // metres, or pixel distance
  isStairs Boolean @default(false)

  @@unique([fromId, toId])
}
```

Then on the existing `Destination` model add an optional `mapNodeId`, so the canteen
row already in the database becomes a point on the map. `Destination.instructionsEn` /
`instructionsMs` stay as they are - they become the written directions shown beside the
drawn path.

Edges are undirected in practice: store each corridor once and treat it as bidirectional
when building the graph, or seed both directions. Pick one and document it in the seed.

### Routing

Put the pathfinding in `lib/map/route.ts` as a pure function - business logic stays out
of React components, per the project engineering rules:

```ts
export function findRoute(graph: MapGraph, fromCode: string, toCode: string): RouteStep[]
```

That makes it directly unit-testable in Vitest: fixed graph in, expected node sequence out,
plus a case for an unreachable destination.

### Screens

1. **Guard-house kiosk** - a new `/map` route. Full-screen SVG, big destination buttons
   down one side, defaults "from" to the guard house node. This is the screen the user
   described. It needs 44px minimum touch targets and BM/EN labels like every other guard
   screen.
2. **Visitor pass page** - `app/v/[token]/page.tsx` already knows the visitor's
   destination, so it can render the same map pre-routed from the guard house. The visitor
   sees their walking route on their own phone after check-in.
3. **Admin editor** - `/admin/map`. Load the SVG, click to drop a node, drag to link two
   nodes into an edge, and bind a node to a destination. Without this, node coordinates
   have to be typed by hand, which is miserable. Weight can default to pixel distance
   between the two points.

### Accessibility

A drawn line alone is unusable with a screen reader and unreadable for anyone with low
vision on a bright outdoor kiosk. Always render the route twice: the SVG path, and an
ordered list of steps in text ("Keluar dari pondok pengawal, jalan lurus 40m, belok kiri
di Blok A"). The text list is generated from the node sequence plus each node's label.

## Build order

1. Draw the campus SVG in Inkscape, id every building, commit it to `public/map/campus.svg`.
2. Add `MapNode` / `MapEdge` / `Destination.mapNodeId`, migrate, seed a handful of nodes by hand.
3. Write `lib/map/route.ts` + Vitest tests. No UI yet.
4. Build the `/map` kiosk screen with `react-zoom-pan-pinch` and the animated path.
5. Build `/admin/map` so the nodes stop being hand-typed.
6. Add the route to the visitor pass page.
7. Playwright test: open `/map`, tap Kantin, assert the path element and the step list appear.

## Sourcing the actual layout

The school's fire-evacuation floor plan is the best source - it is already drawn to scale
and already shows walkways. Failing that, trace over a satellite screenshot in Inkscape and
delete the screenshot layer before committing, so no third-party imagery ships in the repo.

## Reference implementation: Pavilion Damansara Heights

Their wayfinding was inspected directly (August 2026). It is a **paid vendor product** -
Map72 (`map72.com`), a Malaysian indoor-mapping company whose client list includes Pavilion
KL, Pavilion Bukit Jalil, Pavilion Damansara Heights, Sunway Pyramid and The Exchange TRX.
The maps are hosted on their CMS at `indoorcms.com`. Pricing is quote-based enterprise;
it is not an option for this project.

The *technique*, however, is exactly the one proposed above, and it is worth copying.

**The picker.** The site is WordPress (Avada/Fusion theme). The "Wayfinding" button is a
modal titled "Where are you coming from?", built with Alpine.js and Tailwind (prefixed
`ts-`). It pulls the shop list from `admin-ajax.php?action=get_wayfinding_shop_list` with
search, category and precinct filters plus pagination. Picking a start and an end builds
`/map/?start=<slug>&end=<slug>`.

**The map.** `/map/` is only a shell; the map itself is an `<iframe>` pointing at
`paviliondh-data.indoorcms.com/mapengine/index.html?snode=1322&tnode=1320`. The slugs
have become numeric node ids - `snode` (source) and `tnode` (target). That is a node
graph, plainly. The engine is a static SvelteKit build.

**The rendering is plain inline SVG.** No canvas, no WebGL, no 3D:

```html
<svg id="stage" viewBox="0 0 1000 529">
  <g id="map">
    <g class="level" id="LL2" data-ordinal="2" data-is-parking="false" visibility="visible">
      <g class="layer" id="FOOTPRINT_2">   <path d="M334.5,273.1L337.3,265.8..."/>
      <g class="layer" id="ROOM_SMALL_2">  ...
      <g class="layer" id="TOILET_2">      ...
      <g class="layer" id="LIFT_2">        ...
      <g class="layer" id="ESCALATOR_2">   ...
```

One `<g class="level">` per floor with a `data-ordinal`; switching floors just toggles
`visibility`. Inside each level, semantic layers - footprint, rooms by size, toilets,
lifts, escalators, voids. The naming echoes IMDF (Apple's Indoor Mapping Data Format),
so the source was probably CAD or IMDF converted to SVG.

**The animated route is two stacked paths.**

```html
<g class="routes">
  <path d="M236.8,283.4L249.8,288.3L255.5,280.9L..." fill="none" stroke="#e0e0e0" stroke-width="4px" stroke-linecap="round"/>
  <path id="route" d="(same d)" stroke="#ed1c24" stroke-width="2px"/>   <!-- dasharray 20%, animation: 17s linear infinite draw -->
</g>
```

A grey 4px base line showing the whole route, and a red 2px line on top with
`stroke-dasharray: 20%` animated by a `draw` keyframe - the marching-ants effect that
makes the route look like it is being walked. The `d` attribute is nothing but `L`
segments between graph nodes; there is no curve smoothing at all. Add `walking.svg`,
`arrow.svg` and a `tap.gif` hint overlay and that is the entire visual.

**What this means for us.** The expensive part of Map72 is not the code - it is digitising
the floor plans and hosting a CMS to maintain them. A single school with roughly 20
destinations does not need that. Replicating the interaction is a weekend of work with the
free stack in this document; the base-plus-dashed-overlay path above should be copied
verbatim, because it is the detail that makes the feature feel finished.

One deliberate difference: they use an iframe to an external origin. We render the SVG
in-app instead, so the map keeps working offline at the guard house and stays inside our
own CSP and accessibility tree.

## Working prototype

`docs/prototypes/school-map-demo.html` is a single self-contained file - open it by
double-clicking, no server and no install. It implements the whole technique end to end
on a mock SMKBBSP campus: 11 destinations, a 23-node walkway graph, Dijkstra, the
base-plus-dashed animated SVG route, generated BM/EN turn-by-turn text, distance and
walking time, keyboard-operable buildings, and dark mode.

It is deliberately dependency-free so the pathfinding and the rendering can be read in
one sitting. The `findRoute` function in it is about 25 lines. When porting into the app,
that function moves to `lib/map/route.ts` unchanged, and `NODES` / `EDGES` / `BUILDINGS`
come from Postgres instead of being literals.
