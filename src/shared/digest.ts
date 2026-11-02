/** Canonical lowercase hex used by immutable photos, identities and receipts. */
export const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, "0")).join("");

export const digest = async (value: string) =>
  hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
