import { SOURCE_PHOTO_BYTES } from "../../shared/photos";

export type PhotoPosition = { latitude: number; longitude: number };

// If the complete JPEG header is already available and has no APP1, no
// remaining image pixels can supply the EXIF fields requested by exifr.
function hasExiflessJpegHeader(prefix: Uint8Array) {
  if (prefix[0] !== 255 || prefix[1] !== 216) {
    return false;
  }
  let offset = 2;
  while (offset + 4 <= prefix.length && prefix[offset] === 255) {
    const marker = prefix[++offset];
    if (marker === 218) {
      return true;
    }
    if (marker === 225 || marker === 217 || marker === 0) {
      return false;
    }
    if (marker === 255) {
      continue;
    }
    const length = prefix[offset + 1] * 256 + prefix[offset + 2];
    if (length < 2) {
      return false;
    }
    offset += 1 + length;
  }

  return false;
}

export async function photoPosition(
  file: Blob,
  isCurrent = () => true,
): Promise<PhotoPosition | null> {
  try {
    if (!isCurrent() || !file.size || file.size > SOURCE_PHOTO_BYTES) {
      return null;
    }
    const { gps } = await import("exifr");
    // Most camera JPEGs put EXIF near the start. Large colour profiles and
    // other image containers can put GPS later, so retry with the full file.
    const prefixBytes = 64 * 1024;
    let value;
    if (file.size > prefixBytes) {
      const prefix = new Uint8Array(await file.slice(0, prefixBytes).arrayBuffer());
      if (!isCurrent() || hasExiflessJpegHeader(prefix)) {
        return null;
      }
      value = await gps(prefix).catch(() => undefined);
    }
    if (!value || !Number.isFinite(value.latitude) || !Number.isFinite(value.longitude)) {
      if (!isCurrent()) {
        return null;
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!isCurrent()) {
        return null;
      }
      value = await gps(bytes);
    }

    return isCurrent() &&
      value &&
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
