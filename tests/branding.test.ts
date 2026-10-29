import { readFile } from "node:fs/promises";
import { test, expect } from "vitest";
import { startupDevices, startupName } from "../scripts/branding.mjs";
const dimensions = (bytes: Buffer) => {
  expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
};
test("icons and localized social cards have usable dimensions and dedicated maskable assets", async () => {
  for (const [name, size] of [
    ["icon-16.png", 16],
    ["icon-32.png", 32],
    ["apple-touch-icon.png", 180],
    ["apple-touch-icon-167.png", 167],
    ["apple-touch-icon-152.png", 152],
    ["icon-maskable-192.png", 192],
    ["icon-maskable-512.png", 512],
  ] as const)
    expect(dimensions(await readFile(`public/${name}`))).toEqual([size, size]);
  for (const language of ["en", "sv"])
    expect(dimensions(await readFile(`public/social-${language}.png`))).toEqual([1200, 630]);
  expect((await readFile("public/favicon.ico")).subarray(0, 6).toString("hex")).toBe(
    "000001000300",
  );
});
test("every Apple device, appearance and orientation has an exact-size launch image", async () => {
  const names = new Set<string>();
  for (const device of startupDevices)
    for (const theme of ["dark", "light"])
      for (const orientation of ["portrait", "landscape"]) {
        const name = startupName(device, theme, orientation);
        expect(names.has(name)).toBe(false);
        names.add(name);
        expect(dimensions(await readFile(`public/startup-images/${name}`))).toEqual(
          (orientation === "portrait"
            ? [device.width, device.height]
            : [device.height, device.width]
          ).map((n) => n * device.dpr),
        );
      }
  expect(names.size).toBe(64);
});
