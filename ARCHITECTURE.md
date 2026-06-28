# Architecture

This file tracks the current system shape and architecture decisions. Keep it concise and update it when the architecture changes.

## Current State

- Next.js 16 app using the App Router, React 19, Bun scripts, Biome, Tailwind CSS, shadcn-style UI primitives, and Three.js through `@react-three/fiber`.
- Convex backend (`convex/`) stores seed logos and car model `.glb` files in Convex File Storage; metadata lives in the `assets` table (`orgId`, `type`, `storageId`, `filename`, etc.). Seed with `bun run seed:assets` (optional `LOGOS_DIR` when logos are not in `public/Logos/`).
- Main user workflow lives in `app/page.tsx`: submit a website URL, extract a brand profile, generate wrap concepts, optionally generate a Grok ad, compose textures, then preview the selected design on a 3D car.
- Browser-only 3D rendering is isolated behind a dynamic client import of `components/CarViewer.tsx`.
- Shared domain types live in `lib/types.ts`; route handlers validate request bodies before calling library modules.

## Design Model

The pipeline follows `DESIGN_MODEL.md`. Stages 1–3 are implemented; stage 4 is planned.

| Stage | Input | Output | Status |
|-------|-------|--------|--------|
| 1 — Brand Extraction | website URL | `BrandProfile` (colors, logo, tone, category) | ✅ done |
| 2 — Base Color | `BrandProfile` | `BaseCoat` (`color` + `metalness` + `roughness`) | ✅ done |
| 3 — Pattern | `BrandProfile` | `PatternType` + AI-generated `pattern.svg`, rasterized to `pattern.png` for WebGL | ✅ done |
| 4 — Ad Placements | `BrandProfile` | one image per `ad_anchor_*` slot | planned |

## Request Flow

1. `POST /api/process-url` — Stage 1: normalizes the submitted URL and calls Exa via Convex (`brand:extractFromUrl`) to produce a `BrandProfile`, with `lib/scrapeWebsite.ts` as fallback when Exa/Convex is unavailable.
2. `POST /api/base-color` — Stage 2: accepts a `BrandProfile` and calls `lib/baseColor.ts` to produce a `BaseCoat` (color + metalness + roughness). Also called internally by `/api/generate-ad` to populate `WrapDesign.metalness`/`roughness`.
3. `POST /api/pattern` — Stage 3: accepts a `BrandProfile` and optional `designId`, calls `lib/pattern.ts` to build a seeded procedural SVG livery pattern (motif type, spacing, and phase from `lib/patternSeed.ts`). Grok SVG generation is opt-in via `XAI_PATTERN=true`. Compose shifts phase per body panel.
4. `POST /api/generate-ad` normalizes the brand profile and calls `lib/generateAd.ts` for the Grok-generated ad design, including the Stage 3 pattern, one short LLM-generated trunk CTA stored on `graphics.trunkCta`, and optional brand avatar. This path is non-fatal in the UI.
5. `POST /api/compose-textures` validates a `WrapDesign` and calls `lib/composeTextures.ts` to generate per-part PNG textures (livery pattern tile as canvas, decals/lockups on top) plus first-class hood logo and trunk CTA graphic URLs. The hood logo graphic uses the scraped `BrandProfile.logoUrl` image when available; it stays transparent when no usable logo image is available.
6. The client stores the resulting brand, designs, selected design, and status locally in `app/page.tsx`.

## Boundaries

- `app/api/**/route.ts`: HTTP request parsing, validation, status codes, and JSON responses.
- `lib/*`: scraping, prompt construction, image generation/composition, normalization, and domain logic.
- `components/*`: interactive UI, 3D viewer, design picker, and visual presentation.
- `components/ui/*`: reusable UI primitives; keep application-specific behavior out of this folder.
- `public/*`: static assets and generated/readable files that must be served by the app.
- `convex/*`: database schema, asset upload mutations/queries, and `brand:extractFromUrl` (Exa-backed brand extraction). Default org id: `drive-to-market` (`convex/constants.ts`). Requires `EXA_API_KEY` in Convex env.

## Convex Assets

Per the asset architecture doc, files are stored in Convex File Storage; the database holds metadata only.

| Type | Source (seed) | Convex query |
|------|---------------|----------------|
| `logo` | `public/Logos/` or `LOGOS_DIR` | `assets:listLogos` |
| `car_model` | `public/models/tesla.glb` (default) | `assets:getTeslaModelUrl` |

Upload flow: `generateUploadUrl` → POST bytes → `createAsset`. The 3D viewer resolves `tesla.glb` via `assets:getTeslaModelUrl` and falls back to `/models/tesla.glb` when Convex is unavailable or the asset is missing. Seed models default to `tesla.glb` only (`MODEL_FILES` env overrides).


Two Tesla GLBs live in `public/models/`:

| File | Mode | How ads are applied |
|------|------|---------------------|
| `tesla.glb` | Wrap mode | Body painted with an AI-generated SVG livery pattern (Stage 3) that tiles across the whole body in tonal variations of the brand primary; the AI ad is projected onto fixed panels as Three.js decals (see below). Legacy procedural concepts still UV-map composed textures per spatial part. |
| `teslanew.glb` | Ad boards | Same body wrap **plus** textures applied to named `ad_anchor_*` plane meshes pre-positioned on each car surface (hood, left/right front doors, left/right back doors, trunk) |

### Ad decals (AI Ad designs)

`components/CarModel.tsx` (`applyAdDecals` / `buildDecal`) places graphics with `DecalGeometry` instead of stretching one texture across the body UVs. For each slot in `AD_DECAL_SLOTS` (left/right doors, left/right rear quarters, hood, trunk) it raycasts from outside the car to find a real surface point, then builds a decal clipped to a box whose footprint matches that slot's graphic aspect. Side/rear-quarter slots use the generated ad's 2:1 aspect and `graphics.decalUrl`; the hood slot uses a square first-class transparent `graphics.hoodUrl` generated from the scraped brand logo image; the trunk/rear slot uses a horizontal transparent `graphics.trunkUrl` that renders the LLM-generated `graphics.trunkCta`. Hood/trunk slots fall back to the ad only if their dedicated URL is missing. The box clip keeps artwork undistorted, conforms it to body curvature, and stops it bleeding onto glass/wheels. Slots are defined geometrically (normalized position + body extents), so they survive the scene's centering/scaling. Each decal is built in its target mesh's local frame — the mesh's world matrix is zeroed during construction, mirroring drei's `<Decal>` — then added as a child so the scene transform re-applies. Stock `accents` meshes, including the source model's manufacturer badges, are hidden while a generated design is active so they do not compete with the wrap graphics.

Wrap paint targets `Material_2125765635`, Datsun `paint`, and large exterior `black_base` panels. The Tesla GLB ships with collapsed or missing UVs on key paint meshes; `lib/meshUvs.ts` box-projects UVs at load time so livery patterns can tile across the body. The opaque `black_reflection` windshield shell (volume ≥ 10) is hidden while a wrap is active so paint shows through; interior cabin meshes are never hidden. AI ads render as projected decals; the livery pattern tiles on paint materials.

The model registry lives in `lib/carModel.ts` (`CAR_MODELS`, `CarModelId`). The viewer shows a mode switcher; the selected model path is passed to `CarModel` as a prop. Both models share the same material names so the category/paint system works for both.

## External Dependencies

- Grok image generation uses `XAI_API_KEY`; the UI falls back to procedural designs when this integration is unavailable.
- `sharp` is used for image composition.
- Three.js assets and paintable part names must stay aligned with `PaintablePart` in `lib/types.ts`.

## Decisions

- Keep route handlers thin and push reusable behavior into `lib`.
- Keep AI generation failures recoverable when a deterministic fallback can keep the demo usable.
- Keep 3D/canvas code client-only to avoid server-rendering browser APIs.
