import { hex } from "./digest";

export const SOURCE_PHOTO_BYTES = 32 * 1024 * 1024;
export const PHOTO_BYTES = 256 * 1024;
export const PHOTO_QUOTA = 50 * 1024 * 1024;
// Covers base64 for the full photo quota plus JSON escaping and pretty-printing
// 5,000 maximum-length place descriptions/names with their categories and visits.
export const BACKUP_BYTES = 160 * 1024 * 1024;

export function jpegDimensions(bytes: Uint8Array) {
  if (
    bytes.length < 20 ||
    bytes.length > PHOTO_BYTES ||
    bytes[0] !== 255 ||
    bytes[1] !== 216 ||
    bytes.at(-2) !== 255 ||
    bytes.at(-1) !== 217
  ) {
    throw new Error("invalidPhoto");
  }
  let offset = 2;
  let dimensions: { width: number; height: number } | undefined;
  const componentTables = new Map<number, number>();
  const quantizationTables = new Set<number>();
  const huffmanTables = new Set<number>();
  let progressive = false;
  const progression = new Map<number, Int8Array>();
  const scannedComponents = new Set<number>();
  while (offset < bytes.length) {
    if (bytes[offset++] !== 255) {
      throw new Error("invalidPhoto");
    }
    while (bytes[offset] === 255) {
      offset++;
    }
    const marker = bytes[offset++];
    if (marker === 217) {
      if (
        offset !== bytes.length ||
        !dimensions ||
        scannedComponents.size !== componentTables.size
      ) {
        throw new Error("invalidPhoto");
      }

      return dimensions;
    }
    if (marker === 0 || marker === 216 || (marker >= 208 && marker <= 215)) {
      throw new Error("invalidPhoto");
    }
    const length = bytes[offset] * 256 + bytes[offset + 1];
    if (!Number.isFinite(length) || length < 2 || offset + length > bytes.length) {
      throw new Error("invalidPhoto");
    }
    const end = offset + length;
    if ([192, 193, 194].includes(marker)) {
      const height = bytes[offset + 3] * 256 + bytes[offset + 4];
      const width = bytes[offset + 5] * 256 + bytes[offset + 6];
      const components = bytes[offset + 7];
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
      ) {
        throw new Error("invalidPhoto");
      }
      for (let at = offset + 8; at < end; at += 3) {
        const id = bytes[at];
        const sampling = bytes[at + 1];
        const horizontal = sampling >> 4;
        const vertical = sampling & 15;
        if (
          componentTables.has(id) ||
          horizontal < 1 ||
          horizontal > 4 ||
          vertical < 1 ||
          vertical > 4
        ) {
          throw new Error("invalidPhoto");
        }
        componentTables.set(id, bytes[at + 2]);
      }
      progressive = marker === 194;
      dimensions = { width, height };
    } else if (marker === 219) {
      let at = offset + 2;
      while (at < end) {
        const table = bytes[at++];
        if (table >> 4 > 1 || (table & 15) > 3) {
          throw new Error("invalidPhoto");
        }
        quantizationTables.add(table & 15);
        at += table >> 4 === 1 ? 128 : 64;
      }
      if (at !== end || length < 67) {
        throw new Error("invalidPhoto");
      }
    } else if (marker === 196) {
      let at = offset + 2;
      while (at < end) {
        const table = bytes[at++];
        if (table >> 4 > 1 || (table & 15) > 3 || at + 16 > end) {
          throw new Error("invalidPhoto");
        }
        let symbols = 0;
        let available = 1;
        for (let i = 0; i < 16; i++) {
          const count = bytes[at++];
          available = available * 2 - count;
          if (available <= 0) {
            throw new Error("invalidPhoto");
          }
          symbols += count;
        }
        if (symbols > 256) {
          throw new Error("invalidPhoto");
        }
        if (symbols) {
          huffmanTables.add(table);
        } else {
          huffmanTables.delete(table);
        }
        at += symbols;
      }
      if (at !== end || length < 19) {
        throw new Error("invalidPhoto");
      }
    } else if (marker === 218) {
      const count = bytes[offset + 2];
      if (!dimensions || count < 1 || count > componentTables.size || length !== 6 + 2 * count) {
        throw new Error("invalidPhoto");
      }
      const first = bytes[end - 3];
      const last = bytes[end - 2];
      const high = bytes[end - 1] >> 4;
      const low = bytes[end - 1] & 15;
      if (progressive) {
        if (
          first > last ||
          last > 63 ||
          (first === 0 ? last !== 0 : count !== 1) ||
          low > 13 ||
          high > 13 ||
          (high !== 0 && high !== low + 1)
        ) {
          throw new Error("invalidPhoto");
        }
      } else if (first !== 0 || last !== 63 || high !== 0 || low !== 0) {
        throw new Error("invalidPhoto");
      }
      const needsDC = first === 0 && high === 0;
      const needsAC = !progressive || first > 0;
      const selected = new Set<number>();
      for (let i = 0; i < count; i++) {
        const id = bytes[offset + 3 + 2 * i];
        const selectors = bytes[offset + 4 + 2 * i];
        if (
          (needsDC && !huffmanTables.has(selectors >> 4)) ||
          (needsAC && !huffmanTables.has(16 + (selectors & 15)))
        ) {
          throw new Error("invalidPhoto");
        }
        const table = componentTables.get(id);
        if (
          table === undefined ||
          selected.has(id) ||
          (!progressive && scannedComponents.has(id)) ||
          !quantizationTables.has(table)
        ) {
          throw new Error("invalidPhoto");
        }
        if (progressive) {
          const levels = progression.get(id) ?? new Int8Array(64).fill(-1);
          if (first > 0 && levels[0] === -1) {
            throw new Error("invalidPhoto");
          }
          for (let coefficient = first; coefficient <= last; coefficient++) {
            if (levels[coefficient] !== (high === 0 ? -1 : high)) {
              throw new Error("invalidPhoto");
            }
            levels[coefficient] = low;
          }
          progression.set(id, levels);
        }
        selected.add(id);
        scannedComponents.add(id);
      }
      offset = end;
      let entropy = 0;
      while (offset < bytes.length) {
        if (bytes[offset] !== 255) {
          offset++;
          entropy++;
          continue;
        }
        const start = offset++;
        while (bytes[offset] === 255) {
          offset++;
        }
        const next = bytes[offset];
        if (next === 0 || (next >= 208 && next <= 215)) {
          offset++;
          if (next === 0) {
            entropy++;
          }
          continue;
        }
        offset = start;
        break;
      }
      if (!entropy) {
        throw new Error("invalidPhoto");
      }
      continue;
    }
    offset = end;
  }
  throw new Error("invalidPhoto");
}

export async function photoHash(bytes: Uint8Array) {
  return hex(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>));
}

const dataPrefix = "data:image/jpeg;base64,";

export function encodedPhotoSize(data: string) {
  const length = data.length - dataPrefix.length;
  if (length <= 0 || length > 4 * Math.ceil(PHOTO_BYTES / 3) || !data.startsWith(dataPrefix)) {
    throw new Error("invalidPhoto");
  }
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;

  return Math.floor(((length - padding) * 3) / 4);
}

export function decodePhoto(data: string) {
  if (
    encodedPhotoSize(data) > PHOTO_BYTES ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(data.slice(dataPrefix.length))
  ) {
    throw new Error("invalidPhoto");
  }
  let raw;
  try {
    raw = atob(data.slice(dataPrefix.length));
  } catch {
    throw new Error("invalidPhoto");
  }
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    bytes[i] = raw.charCodeAt(i);
  }
  jpegDimensions(bytes);

  return bytes;
}
