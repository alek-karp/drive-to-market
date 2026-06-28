/** Static debug livery pattern — impossible to miss when testing the render pipeline. */
export const DEBUG_PATTERN_PNG = "/textures/debug-livery-pattern.png";
export const DEBUG_PATTERN_SVG = "/textures/debug-livery-pattern.svg";

export function renderDebugPatternSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="2048" height="2048" viewBox="0 0 2048 2048">
  <defs>
    <pattern id="debug-checker" width="256" height="256" patternUnits="userSpaceOnUse">
      <rect width="128" height="128" fill="#FF00FF"/>
      <rect x="128" width="128" height="128" fill="#00FF66"/>
      <rect y="128" width="128" height="128" fill="#00FF66"/>
      <rect x="128" y="128" width="128" height="128" fill="#FF00FF"/>
    </pattern>
  </defs>
  <rect width="2048" height="2048" fill="url(#debug-checker)"/>
  <rect width="2048" height="2048" fill="none" stroke="#000000" stroke-width="48"/>
  <text x="128" y="320" font-family="Helvetica, Arial, sans-serif" font-size="180" font-weight="900" fill="#000000">DEBUG PATTERN</text>
</svg>`;
}

/** Set HARDCODED_PATTERN=true to swap in the UV-grid debug checkerboard. */
export function useHardcodedPattern(): boolean {
  return process.env.HARDCODED_PATTERN === "true";
}

export function isDebugPatternUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  return url === DEBUG_PATTERN_PNG || url.endsWith("/debug-livery-pattern.png");
}
