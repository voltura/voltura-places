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
  let dimensions: { width: number; height: number } | undefined;
  let components = 0,
    quantization = false,
    huffman = false,
    scanned = false;
  while (offset < bytes.length) {
    if (bytes[offset++] !== 255) throw new Error("invalidPhoto");
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    if (marker === 217) {
      if (offset !== bytes.length || !dimensions || !scanned) throw new Error("invalidPhoto");
      return dimensions;
    }
    if (marker === 0 || marker === 216 || (marker >= 208 && marker <= 215))
      throw new Error("invalidPhoto");
    const length = bytes[offset] * 256 + bytes[offset + 1];
    if (!Number.isFinite(length) || length < 2 || offset + length > bytes.length)
      throw new Error("invalidPhoto");
    const end = offset + length;
    if ([192, 193, 194].includes(marker)) {
      const height = bytes[offset + 3] * 256 + bytes[offset + 4],
        width = bytes[offset + 5] * 256 + bytes[offset + 6];
      components = bytes[offset + 7];
      if (
        dimensions ||
        bytes[offset + 2] !== 8 ||
        components < 1 ||
        components > 4 ||
        length !== 8 + 3 * components ||
        !width ||
        !height ||
        width > 1280 ||
        height > 1280
      )
        throw new Error("invalidPhoto");
      dimensions = { width, height };
    } else if (marker === 219) {
      let at = offset + 2;
      while (at < end) {
        const table = bytes[at++];
        if (table >> 4 > 1 || (table & 15) > 3) throw new Error("invalidPhoto");
        at += table >> 4 === 1 ? 128 : 64;
      }
      if (at !== end || length < 67) throw new Error("invalidPhoto");
      quantization = true;
    } else if (marker === 196) {
      let at = offset + 2;
      while (at < end) {
        const table = bytes[at++];
        if (table >> 4 > 1 || (table & 15) > 3 || at + 16 > end) throw new Error("invalidPhoto");
        let symbols = 0;
        for (let i = 0; i < 16; i++) symbols += bytes[at++];
        if (symbols > 256) throw new Error("invalidPhoto");
        at += symbols;
      }
      if (at !== end || length < 19) throw new Error("invalidPhoto");
      huffman = true;
    } else if (marker === 218) {
      const count = bytes[offset + 2];
      if (
        !dimensions ||
        !quantization ||
        !huffman ||
        count < 1 ||
        count > components ||
        length !== 6 + 2 * count
      )
        throw new Error("invalidPhoto");
      offset = end;
      let entropy = 0;
      while (offset < bytes.length) {
        if (bytes[offset] !== 255) {
          offset++;
          entropy++;
          continue;
        }
        const start = offset++;
        while (bytes[offset] === 255) offset++;
        const next = bytes[offset];
        if (next === 0 || (next >= 208 && next <= 215)) {
          offset++;
          entropy++;
          continue;
        }
        offset = start;
        break;
      }
      if (!entropy) throw new Error("invalidPhoto");
      scanned = true;
      continue;
    }
    offset = end;
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
