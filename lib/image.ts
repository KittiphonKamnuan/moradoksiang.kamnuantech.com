/** Photos are shown at most ~200px wide; 1024px is plenty and keeps uploads small. */
export const MAX_PHOTO_PX = 1024;

export function fitWithin(width: number, height: number, max = MAX_PHOTO_PX) {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}
