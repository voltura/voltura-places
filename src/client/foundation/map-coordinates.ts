// Use the shortest longitude arc; stored coordinates and outbound links stay unchanged.
export function longitudeArcStart(values: number[]) {
  if (!values.length) return -180;
  const sorted = [...values].sort((a, b) => a - b);
  let start = sorted[0],
    gap = -1;
  for (let i = 0; i < sorted.length; i++) {
    const next = sorted[(i + 1) % sorted.length];
    const distance = (i + 1 === sorted.length ? next + 360 : next) - sorted[i];
    if (distance > gap) {
      gap = distance;
      start = next;
    }
  }
  return start;
}
export const wrapLongitude = (longitude: number, start: number) =>
  longitude < start ? longitude + 360 : longitude;
