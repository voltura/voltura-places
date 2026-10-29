import { gps } from "exifr";
export type PhotoPosition = { latitude: number; longitude: number };
export async function photoPosition(file: Blob): Promise<PhotoPosition | null> {
  try {
    const value = await gps(new Uint8Array(await file.arrayBuffer()));
    return value &&
      Number.isFinite(value.latitude) &&
      Number.isFinite(value.longitude) &&
      Math.abs(value.latitude) <= 90 &&
      Math.abs(value.longitude) <= 180
      ? { latitude: value.latitude, longitude: value.longitude }
      : null;
  } catch {
    return null;
  }
}
