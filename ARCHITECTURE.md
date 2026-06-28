# Architecture

This file tracks the current system shape and architecture decisions. Keep it concise and update it when the architecture changes.

## Current State

- Next.js 16 app using the App Router, React 19, Bun scripts, Biome, Tailwind CSS, shadcn-style UI primitives, and Three.js through `@react-three/fiber`.
- Main user workflow lives in `app/page.tsx`: submit a website URL, extract a brand profile, generate wrap concepts, optionally generate a Grok ad, compose textures, then preview the selected design on a 3D car.
- Browser-only 3D rendering is isolated behind a dynamic client import of `components/CarViewer.tsx`.
- Shared domain types live in `lib/types.ts`; route handlers validate request bodies before calling library modules.

## Design Model

The pipeline follows `DESIGN_MODEL.md`. Stages 1–2 are implemented; stages 3–4 are planned.

| Stage | Input | Output | Status |
|-------|-------|--------|--------|
| 1 — Brand Extraction | website URL | `BrandProfile` (colors, logo, tone, category) | ✅ done |
| 2 — Base Color | `BrandProfile` | `BaseCoat` (`color` + `metalness` + `roughness`) | ✅ done |
| 3 — Pattern | `BrandProfile` | `PatternType` + generated pattern texture | planned |
| 4 — Ad Placements | `BrandProfile` | one image per `ad_anchor_*` slot | planned |

## Request Flow

1. `POST /api/process-url` — Stage 1: normalizes the submitted URL and calls `lib/scrapeWebsite.ts` to produce a `BrandProfile`.
2. `POST /api/base-color` — Stage 2: accepts a `BrandProfile` and calls `lib/baseColor.ts` to produce a `BaseCoat` (color + metalness + roughness). Also called internally by `/api/generate-design` and `/api/generate-ad` to populate `WrapDesign.metalness`/`roughness`.
3. `POST /api/generate-design` normalizes the brand profile and calls `lib/generateWrapGraphics.ts` for deterministic wrap concepts.
4. `POST /api/generate-ad` normalizes the brand profile and calls `lib/generateAd.ts` for the Grok-generated ad design, including one short LLM-generated trunk CTA stored on `graphics.trunkCta`. This path is non-fatal in the UI.
5. `POST /api/compose-textures` validates a `WrapDesign` and calls `lib/composeTextures.ts` to generate per-part PNG textures plus first-class hood logo and trunk CTA graphic URLs. The hood logo graphic uses the scraped `BrandProfile.logoUrl` image when available; it stays transparent when no usable logo image is available.
6. The client stores the resulting brand, designs, selected design, and status locally in `app/page.tsx`.

## Boundaries

- `app/api/**/route.ts`: HTTP request parsing, validation, status codes, and JSON responses.
- `lib/*`: scraping, prompt construction, image generation/composition, normalization, and domain logic.
- `components/*`: interactive UI, 3D viewer, design picker, and visual presentation.
- `components/ui/*`: reusable UI primitives; keep application-specific behavior out of this folder.
- `public/*`: static assets and generated/readable files that must be served by the app.

## Models

Two Tesla GLBs live in `public/models/`:

| File | Mode | How ads are applied |
|------|------|---------------------|
| `tesla.glb` | Wrap mode | Body painted with the brand base coat; the AI ad is projected onto fixed panels as Three.js decals (see below). Legacy procedural concepts still UV-map composed textures per spatial part. |
| `teslanew.glb` | Ad boards | Same body wrap **plus** textures applied to named `ad_anchor_*` plane meshes pre-positioned on each car surface (hood, left/right front doors, left/right back doors, trunk) |

### Ad decals (AI Ad designs)

`components/CarModel.tsx` (`applyAdDecals` / `buildDecal`) places graphics with `DecalGeometry` instead of stretching one texture across the body UVs. For each slot in `AD_DECAL_SLOTS` (left/right doors, left/right rear quarters, hood, trunk) it raycasts from outside the car to find a real surface point, then builds a decal clipped to a box whose footprint matches that slot's graphic aspect. Side/rear-quarter slots use the generated ad's 2:1 aspect and `graphics.decalUrl`; the hood slot uses a square first-class transparent `graphics.hoodUrl` generated from the scraped brand logo image; the trunk/rear slot uses a horizontal transparent `graphics.trunkUrl` that renders the LLM-generated `graphics.trunkCta`. Hood/trunk slots fall back to the ad only if their dedicated URL is missing. The box clip keeps artwork undistorted, conforms it to body curvature, and stops it bleeding onto glass/wheels. Slots are defined geometrically (normalized position + body extents), so they survive the scene's centering/scaling. Each decal is built in its target mesh's local frame — the mesh's world matrix is zeroed during construction, mirroring drei's `<Decal>` — then added as a child so the scene transform re-applies. Stock `accents` meshes, including the source model's manufacturer badges, are hidden while a generated design is active so they do not compete with the wrap graphics.

The model registry lives in `lib/carModel.ts` (`CAR_MODELS`, `CarModelId`). The viewer shows a mode switcher; the selected model path is passed to `CarModel` as a prop. Both models share the same material names so the category/paint system works for both.

## External Dependencies

- Grok image generation uses `XAI_API_KEY`; the UI falls back to procedural designs when this integration is unavailable.
- `sharp` is used for image composition.
- Three.js assets and paintable part names must stay aligned with `PaintablePart` in `lib/types.ts`.

## Decisions

- Keep route handlers thin and push reusable behavior into `lib`.
- Keep AI generation failures recoverable when a deterministic fallback can keep the demo usable.
- Keep 3D/canvas code client-only to avoid server-rendering browser APIs.
