import { createHash } from "node:crypto";
import sharp from "sharp";
import { readFile, readdir } from "node:fs/promises";
import { test, expect } from "vitest";
import { startupDevices, startupName } from "../scripts/startup-images.mjs";
import { skins } from "../src/client/foundation/appearance";

const dimensions = (bytes: Buffer) => {
  expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");

  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
};

test("localized promo screenshots are PNGs that can be embedded in generated social cards", async () => {
  for (const suffix of ["", "-sv"]) {
    expect(dimensions(await readFile(`site/assets/app-mobile${suffix}.png`))).toEqual([390, 844]);
  }
  for (const suffix of ["", "-sv"]) {
    expect(dimensions(await readFile(`site/assets/app-desktop${suffix}.png`))).toEqual([1000, 871]);
  }
});
test("every theme has localized iPhone-sized promo captures", async () => {
  for (const language of ["en", "sv"]) {
    for (const skin of skins) {
      for (const mode of ["dark", "light"]) {
        const metadata = await sharp(
          `site/assets/themes/${language}-${skin}-${mode}.webp`,
        ).metadata();
        expect([metadata.format, metadata.width, metadata.height]).toEqual(["webp", 1206, 2622]);
      }
    }
  }
});
test("icons and localized social cards have usable dimensions and dedicated maskable assets", async () => {
  for (const [name, size] of [
    ["icon-16.png", 16],
    ["icon-32.png", 32],
    ["apple-touch-icon.png", 180],
    ["apple-touch-icon-167.png", 167],
    ["apple-touch-icon-152.png", 152],
    ["icon-maskable-192.png", 192],
    ["icon-maskable-512.png", 512],
  ] as const) {
    expect(dimensions(await readFile(`public/${name}`))).toEqual([size, size]);
  }
  for (const language of ["en", "sv"]) {
    expect(dimensions(await readFile(`public/social-${language}.png`))).toEqual([1200, 630]);
  }
  expect((await readFile("public/favicon.ico")).subarray(0, 6).toString("hex")).toBe(
    "000001000300",
  );
});
test("every Apple device, appearance and orientation has an exact-size launch image", async () => {
  const names = new Set<string>();
  for (const device of startupDevices) {
    for (const theme of ["dark", "light"]) {
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
    }
  }
  expect(names.size).toBe(64);
});

test("losslessly encoded launch images and social cards retain their original RGBA pixels", async () => {
  const launch = (await readdir("public/startup-images")).sort();
  expect(launch).toHaveLength(64);
  const groups = [
    [
      "public/startup-images",
      launch,
      "dc86bb2121fcec70692d24ee1a8aa07bd5d949ce4c7520070f1e1f06abe9d35e",
    ],
    [
      "public",
      ["social-en.png", "social-sv.png"],
      "3e1dd917fc7b308c6130142cf6a3564c9c3577ca671b339caaa3f217e385cb8e",
    ],
  ] as const;
  for (const [directory, names, expected] of groups) {
    const manifest = createHash("sha256");
    for (const name of names) {
      const { data, info } = await sharp(`${directory}/${name}`)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const pixels = createHash("sha256").update(data).digest("hex");
      manifest.update(`${name} ${info.width}x${info.height} ${pixels}\n`);
    }
    expect(manifest.digest("hex")).toBe(expected);
  }
});
