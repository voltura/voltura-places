export const PHOTO_BYTES = 256 * 1024;
export const PHOTO_QUOTA = 50 * 1024 * 1024;
export const BACKUP_BYTES = 80 * 1024 * 1024;
export function jpegDimensions(bytes: Uint8Array) {
  if (
    bytes.length < 20 ||
    bytes.length > PHOTO_BYTES ||
    bytes[0] !== 255 ||
    bytes[1] !== 216 ||
    bytes.at(-2) !== 255 ||
    bytes.at(-1) !== 217
  )
    throw new Error("invalidPhoto");
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset++] !== 255) throw new Error("invalidPhoto");
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    const length = bytes[offset] * 256 + bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) throw new Error("invalidPhoto");
    if ([192, 193, 194].includes(marker)) {
      const height = bytes[offset + 3] * 256 + bytes[offset + 4],
        width = bytes[offset + 5] * 256 + bytes[offset + 6];
      if (length < 8 || !width || !height || width > 1280 || height > 1280)
        throw new Error("invalidPhoto");
      return { width, height };
    }
    if (marker === 218 || marker === 217) break;
    offset += length;
  }
  throw new Error("invalidPhoto");
}
export async function photoHash(bytes: Uint8Array) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export function decodePhoto(data: string) {
  if (
    !/^data:image\/jpeg;base64,[A-Za-z0-9+/]*={0,2}$/.test(data) ||
    data.length > PHOTO_BYTES * 1.34 + 40
  )
    throw new Error("invalidPhoto");
  const bytes = Uint8Array.from(atob(data.slice(data.indexOf(",") + 1)), (c) => c.charCodeAt(0));
  jpegDimensions(bytes);
  return bytes;
}
