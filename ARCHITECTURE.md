# Architecture

This file tracks the current system shape and architecture decisions. Keep it concise and update it when the architecture changes.

## Current State

- Next.js 16 app using the App Router, React 19, Bun scripts, Biome, Tailwind CSS, shadcn-style UI primitives, and Three.js through `@react-three/fiber`.
- Main user workflow lives in `app/page.tsx`: submit a website URL, extract a brand profile, generate wrap concepts, optionally generate a Grok ad, compose textures, then preview the selected design on a 3D car.
- Browser-only 3D rendering is isolated behind a dynamic client import of `components/CarViewer.tsx`.
- Shared domain types live in `lib/types.ts`; route handlers validate request bodies before calling library modules.

## Request Flow

1. `POST /api/process-url` normalizes the submitted URL and calls `lib/scrapeWebsite.ts` to produce a `BrandProfile`.
2. `POST /api/generate-design` normalizes the brand profile and calls `lib/generateWrapGraphics.ts` for deterministic wrap concepts.
3. `POST /api/generate-ad` normalizes the brand profile and calls `lib/generateAd.ts` for the Grok-generated ad design. This path is non-fatal in the UI.
4. `POST /api/compose-textures` validates a `WrapDesign` and calls `lib/composeTextures.ts` to generate per-part PNG textures.
5. The client stores the resulting brand, designs, selected design, and status locally in `app/page.tsx`.

## Boundaries

- `app/api/**/route.ts`: HTTP request parsing, validation, status codes, and JSON responses.
- `lib/*`: scraping, prompt construction, image generation/composition, normalization, and domain logic.
- `components/*`: interactive UI, 3D viewer, design picker, and visual presentation.
- `components/ui/*`: reusable UI primitives; keep application-specific behavior out of this folder.
- `public/*`: static assets and generated/readable files that must be served by the app.

## External Dependencies

- Grok image generation uses `XAI_API_KEY`; the UI falls back to procedural designs when this integration is unavailable.
- `sharp` is used for image composition.
- Three.js assets and paintable part names must stay aligned with `PaintablePart` in `lib/types.ts`.

## Decisions

- Keep route handlers thin and push reusable behavior into `lib`.
- Keep AI generation failures recoverable when a deterministic fallback can keep the demo usable.
- Keep 3D/canvas code client-only to avoid server-rendering browser APIs.
