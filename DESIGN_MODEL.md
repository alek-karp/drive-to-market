# Visual Design Model

The car design pipeline runs in four stages. Each stage produces one piece of the final render. Keep them separate — mixing them into one generated texture creates visual clutter and makes the system harder to control.

---

## Stage 1 — Brand Extraction

Input: website URL  
Output: `BrandProfile`

Scrape the site and extract:
- Primary and secondary colors
- Logo / wordmark
- Tone and personality
- Industry / category

---

## Stage 2 — Base Color

Input: `BrandProfile`  
Output: `baseColor` (hex or CSS color) + optional `metalness` / `roughness`

Set the body material color directly — no texture needed. This is a material property, not an image.

---

## Stage 3 — Pattern

Input: `BrandProfile`  
Output: `PatternType` + generated `pattern.svg`

Grok writes a seamless SVG livery texture sized 2048×2048. It is saved as `pattern.svg`, rasterized to `pattern.png` for WebGL, and tiles across the whole car body.

Pattern sits on top of the base color as a tonal overlay — it sets the vibe, not the message.

---

## Stage 4 — Ad Placements

Input: `BrandProfile`  
Output: one image per anchor slot

Generate ad creatives for fixed positions on the car:

- `hood`
- `leftFrontDoor`
- `rightFrontDoor`
- `leftRearDoor`
- `rightRearDoor`
- `trunk`

Each placement is an independent image applied to a named `ad_anchor_*` mesh. Slots can be left empty.

---

## Renderer

Applies the three layers in order:

1. Set `car_paint` material color from `baseColor`
2. Apply pattern texture to body meshes
3. Apply ad images to `ad_anchor_*` meshes by name
