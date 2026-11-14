# Tile generation prompt

Instructions for an AI session to produce the tile art for the island world. Read `CLAUDE.md` first. You are the **art/UI owner**: only edit `src/ui/tiles/`, `public/assets/`, and the test page below. Do not edit `src/layout/`, `src/data/` or `src/render/`. If something in the contracts must change, report it and stop.

## Goal

Create a complete, consistent set of **procedurally generated isometric tile textures** (no external art, no image generators) so the whole pipeline looks good with zero downloaded assets. Real art packs may replace them later, so everything is accessed through one function and can be swapped without touching the renderer.

## Approach

- Draw with the HTML Canvas 2D API (`OffscreenCanvas` where available, else a `<canvas>` element). No new dependencies.
- Generate every texture once at startup, then wrap each canvas as a PixiJS v8 `Texture` and cache by key.
- Pixel-art look: no anti-aliased edges, no smoothing. Fill shapes with crisp 1px scanlines or `fillRect` runs, rather than `ctx.fill()` on an angled path. Set textures to nearest-neighbour scaling.
- All randomness comes from the seeded PRNG in `src/layout/rng.ts` (import it, do not edit it). Never use `Math.random()`.

## Public API (the only thing other folders may import)

`src/ui/tiles/index.ts` exports:

```ts
export const TILE_W = 64;   // diamond width
export const TILE_H = 32;   // diamond height (always TILE_W / 2)

export interface TileSprite { texture: Texture; anchorX: number; anchorY: number; }

// ground layer and object layer are separate
export function getGround(type: TileType, variant: number): TileSprite;
export function getObject(type: TileType, variant: number): TileSprite | null;
export function getCoastOverlays(mask: number, innerCorners?: number): TileSprite[];
export function variantCount(type: TileType): number;   // how many variants exist
```

Anchors are in 0..1 of the texture. For a **ground** sprite the anchor puts the diamond's centre on the tile's screen position. For an **object** sprite the anchor is the bottom-centre of the diamond footprint (`anchorX = 0.5`, `anchorY` = footprint bottom / texture height), so the base sits on the tile and the rest rises above it.

If `variant` is out of range, wrap it with modulo. Never throw.

## Geometry

- Ground diamond: **64 × 32 px**, 2:1. Corners touch the middle of each side of the box: top (32,0), right (63,16), bottom (32,31), left (0,16). Write one `fillDiamond(ctx, colour)` helper and one `fillDiamondEdge(ctx, edge, colour, thickness)` helper and reuse them.
- Raised land has a visible side wall: grass tiles may be drawn on a 64 × 40 canvas with an 8 px side wall (left face darker, right face darkest) under the diamond. If you do this, set the anchor so the **top diamond** is still centred on the tile position.
- Objects use 64-wide canvases, up to 64–96 tall (see sizes below).
- Projection used by the renderer: `sx = (x - y) * 32`, `sy = (x + y) * 16`. Grid +x is screen down-right, +y is screen down-left, -y is up-right, -x is up-left.

## Palette

Put everything in `src/ui/tiles/palette.ts`. Suggested starting values (tune by eye; keep it warm and cohesive):

| Name | Hex | Use |
|---|---|---|
| `waterShallow` | `#4fb6d9` | shallow ocean |
| `waterDeep` | `#2a6fa8` | deep ocean |
| `waterHighlight` | `#a8e3f2` | wave glints |
| `grassTop` | `#7cc062` | island top |
| `grassDark` | `#5a9e48` | grass noise, shading |
| `grassSideL` / `grassSideR` | `#8a6a43` / `#6f5436` | land side walls |
| `sand` | `#e8d59a` | beach/coast edge |
| `sandDark` | `#cdb878` | beach shading |
| `wood` | `#8b5a2b` | houses, docks |
| `roofRed` / `roofOrange` | `#c24a3a` / `#e0813a` | roofs |
| `wall` | `#efe2c6` | house walls |
| `leaf` / `leafDark` | `#3f8f3a` / `#2c6b2c` | trees |
| `trunk` | `#6b4423` | tree trunks |
| `coralA` / `coralB` / `coralC` | `#f06c8a` / `#f2a65a` / `#9b6bd6` | coral |

Lighting rule for the whole set: light comes from the top-left. Top faces use the base colour, left faces ~15% darker, right faces ~30% darker.

## Tiles to produce

### Ground (diamond)

| Type | Variants | Notes |
|---|---|---|
| `ocean` | 3 | 0 = shallow, 1 = deep, 2 = shallow with a few wave glint pixels. Subtle 2-tone dither noise so large oceans do not look flat. |
| `island` | 3 | Grass with sparse darker flecks. Variants differ in fleck placement only, so edges still join seamlessly. |
| `coast` | 1 base | Grass diamond; coast is drawn with overlays (below), not separate textures. |
| `coral` | 3 | Shallow-water diamond with a pinkish tint where coral grows. |
| `port` | 1 | Coast ground plus a wooden dock (see Objects). |

Ground tiles must be **seamless**: adjacent tiles must not show seams or gaps. Fill the full diamond with no transparent pixels inside it.

### Coast overlays (autotiling)

The coast mask is a 4-bit value; each bit means "ocean on that side":

```
bit 1 : ocean at (x, y-1)  -> screen up-right edge
bit 2 : ocean at (x+1, y)  -> screen down-right edge
bit 4 : ocean at (x, y+1)  -> screen down-left edge
bit 8 : ocean at (x-1, y)  -> screen up-left edge
```

Draw **4 edge overlays** (a sand strip about 4 px thick along that diamond edge, with a 1 px darker outline on the water side) and **4 outer-corner overlays** (small sand wedges at the diamond corner where two adjacent edge bits are both set). `getCoastOverlays(mask)` returns the right overlays to draw on top of the grass ground: one edge per set bit, plus a corner for each pair of adjacent set bits. `mask === 0` returns `[]`.

Optional second pass if time allows: `innerCorners` is a 4-bit mask of diagonal-ocean neighbours (bit 1 = up, 2 = right, 4 = down, 8 = left corner of the diamond) and returns small inner-corner sand pieces.

### Objects (drawn on top of grass ground)

All have a 64-wide canvas; the base sits on the diamond.

| Type | Variants | Canvas | Description |
|---|---|---|---|
| `tree` | 4 | 64 × 64 | Round, pine, bushy and small variants. Trunk base on tile centre. About 1.5 tiles tall. |
| `house` | 4 | 64 × 64 | Small cottage: cream walls, left face lighter than right, pitched roof in red or orange. Different roof colours and a door or window per variant. About 1 tile tall. |
| `village` | 3 | 64 × 80 | Cluster of 2–3 houses with a small path, bigger than a single house. |
| `coral` | 3 | 64 × 48 | Branching and fan coral in 2–3 colours rising from the water. |
| `port` | 1 | 64 × 64 | Wooden dock on the water side with a small boat or mooring post. |

## Test page (required)

Create `tiles.html` (served by Vite at `/tiles.html`) and `src/ui/tiles/debug.ts` showing, on a dark neutral background:

1. Every ground tile and every object, labelled with type and variant, in a grid.
2. All 16 coast masks (0–15), each a 3×3 patch: a centre grass tile with the right overlays, surrounded by ocean.
3. A seamless test: a 12 × 12 patch of ocean, and a 12 × 12 patch of island, to confirm no seams.
4. A composed mini island: ocean around a 6 × 6 island with correct coasts, a few trees, one village and one house.

Draw the page with PixiJS using the same `getGround` / `getObject` / `getCoastOverlays` functions and the same iso projection as the renderer, so what you see is what the game will show.

## Quality bar

- Looks cohesive: one palette, one light direction, one outline style (thin 1 px darker edge on objects, none on ground).
- Readable at 1x zoom and at 0.5x. Check both.
- Variants are visibly different but obviously the same family.
- Zero seams between ground tiles; zero stray transparent pixels inside a diamond.
- Deterministic: running twice produces identical textures.

## Tests

Add vitest tests in `src/ui/tiles/tiles.test.ts` for the pure logic (not pixels):

- `getCoastOverlays(0)` is empty; each single bit returns exactly one edge; two adjacent bits return two edges plus one corner; mask 15 returns 4 edges and 4 corners.
- `variantCount` matches the table above; out-of-range variants wrap.
- Texture generation is deterministic for the same seed.

## Done when

- `npm run build` and `npm test` pass.
- `npm run dev`, then open `/tiles.html`: take a screenshot, look at it, and fix anything wrong (seams, flipped coast edges, misanchored objects, muddy colours) before finishing. Compare the mini island against the 16-mask grid to confirm the coast bits are the right way round.
- Report the public API as built, and any contract problems you found. Do not commit.
