import { readFile, mkdir, writeFile, lstat, rename, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { Resvg } from "@resvg/resvg-js";

import { startupDevices, startupName } from "./startup-images.mjs";

const font = {
  fontFiles: [resolve("assets/branding/Inter.ttf")],
  loadSystemFonts: false,
  defaultFontFamily: "Inter",
};
const source = await readFile(new URL("../public/icon.svg", import.meta.url), "utf8");
const inside = source.replace(/^.*?<svg[^>]*>/s, "").replace(/<\/svg>\s*$/, "");
const glyph = inside.replace(/<rect[^>]*\/>/, "");
const screenshots = Object.fromEntries(
  await Promise.all(
    ["en", "sv"].map(async (language) => [
      language,
      (await readFile(`site/assets/app-mobile${language === "sv" ? "-sv" : ""}.png`)).toString(
        "base64",
      ),
    ]),
  ),
);

const svg = (width, height, content) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${content}</svg>`;

const mark = (x, y, size) =>
  `<g transform="translate(${x} ${y}) scale(${size / 512})">${inside}</g>`;

const png = (markup, size) =>
  new Resvg(markup, { font, ...(size ? { fitTo: { mode: "width", value: size } } : {}) })
    .render()
    .asPng();

const socialCards = new Map();

export function socialImage(language) {
  if (socialCards.has(language)) {
    return socialCards.get(language);
  }
  const swedish = language === "sv";

  const image = png(
    svg(
      1200,
      630,
      `
    <rect width="1200" height="630" fill="#111b17"/>
    <defs><clipPath id="screen"><rect x="880" y="48" width="248" height="537" rx="24"/></clipPath></defs>
    <path d="M826 0H1200V630H826Z" fill="#192720"/>
    ${mark(64, 58, 80)}
    <text x="164" y="111" fill="#eef5ed" font-family="Inter" font-size="36">voltura places</text>
    <text x="64" y="262" fill="#eef5ed" font-family="Inter" font-size="60" font-weight="700">${swedish ? "Spara en plats." : "Save a place."}</text>
    <text x="64" y="340" fill="#8dd7ad" font-family="Inter" font-size="60" font-weight="700">${swedish ? "Hitta tillbaka." : "Find your way back."}</text>
    <text x="68" y="418" fill="#eef5ed" font-family="Inter" font-size="28">${swedish ? "Privata platser. Delade grupper." : "Private places. Shared groups."}</text>
    <text x="68" y="464" fill="#b0c4b6" font-family="Inter" font-size="25">GPS · ${swedish ? "Foton" : "Photos"} · ${swedish ? "Karta" : "Map"} · Offline</text>
    <text x="68" y="564" fill="#8dd7ad" font-family="Inter" font-size="24">voltura.se/places</text>
    <image x="880" y="48" width="248" height="537" clip-path="url(#screen)" href="data:image/png;base64,${screenshots[language]}"/>
    <rect x="878" y="46" width="252" height="541" rx="26" fill="none" stroke="#344b3d" stroke-width="4"/>`,
    ),
  );
  socialCards.set(language, image);

  return image;
}

async function readGenerated(path) {
  if (!(await lstat(path)).isFile()) {
    throw new Error("Linked or non-regular generated Places file");
  }

  return readFile(path);
}

async function writeGenerated(path, bytes) {
  const data = Buffer.from(bytes);
  try {
    if ((await readGenerated(path)).equals(data)) {
      return;
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temporary, data, { flag: "wx" });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch((error) => {
      if (error.code !== "ENOENT") {
        throw error;
      }
    });
  }
}

export async function generateBranding() {
  await mkdir("public/startup-images", { recursive: true });
  for (const size of [192, 512]) {
    await writeGenerated(`public/icon-${size}.png`, png(source, size));
    await writeGenerated(
      `public/icon-maskable-${size}.png`,
      png(
        svg(
          512,
          512,
          `<rect width="512" height="512" fill="#111b17"/><g transform="translate(64 64) scale(.75)">${glyph}</g>`,
        ),
        size,
      ),
    );
  }
  const apple = svg(512, 512, inside.replace('rx="112"', ""));
  for (const size of [152, 167, 180]) {
    await writeGenerated(
      `public/apple-touch-icon${size === 180 ? "" : `-${size}`}.png`,
      png(apple, size),
    );
  }
  const small = [16, 32, 48].map((size) => ({ size, bytes: png(source, size) }));
  for (const { size, bytes } of small) {
    await writeGenerated(`public/icon-${size}.png`, bytes);
  }
  await writeGenerated("public/icon-150.png", png(source, 150));
  const header = Buffer.alloc(6 + 16 * small.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(small.length, 4);
  let offset = header.length;
  small.forEach(({ size, bytes }, i) => {
    const at = 6 + i * 16;
    header[at] = size;
    header[at + 1] = size;
    header.writeUInt16LE(1, at + 4);
    header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(bytes.length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += bytes.length;
  });
  await writeGenerated("public/favicon.ico", Buffer.concat([header, ...small.map((p) => p.bytes)]));
  await generateStartupImages();
  for (const lang of ["en", "sv"]) {
    await writeGenerated(`public/social-${lang}.png`, socialImage(lang));
  }
  console.log(
    `Prepared Places icons, social cards and ${startupDevices.length * 4} Apple startup images.`,
  );
}

async function generateStartupImages() {
  const configs = startupDevices.flatMap((device) =>
    ["dark", "light"].flatMap((theme) =>
      ["portrait", "landscape"].map((orientation) => ({ device, theme, orientation })),
    ),
  );
  const directory = "public/startup-images";
  const cachePath = ".artifacts/startup-images.sha256";
  const hash = createHash("sha256").update(
    JSON.stringify([process.platform, process.arch, configs, font]),
  );
  for (const path of [
    "scripts/branding.mjs",
    "scripts/startup-images.mjs",
    "public/icon.svg",
    "assets/branding/Inter.ttf",
    "package-lock.json",
  ]) {
    hash.update(
      createHash("sha256")
        .update(await readFile(path))
        .digest(),
    );
  }

  const signature = async () => {
    const combined = hash.copy();
    for (const { device, theme, orientation } of configs) {
      const file = await readGenerated(`${directory}/${startupName(device, theme, orientation)}`);
      combined.update(createHash("sha256").update(file).digest());
    }

    return combined.digest("hex");
  };

  try {
    if ((await readGenerated(cachePath)).toString("utf8") === (await signature())) {
      return;
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
  for (const { device, theme, orientation } of configs) {
    const width = (orientation === "portrait" ? device.width : device.height) * device.dpr;
    const height = (orientation === "portrait" ? device.height : device.width) * device.dpr;
    const size = Math.round(Math.min(width, height) * 0.28);
    const textSize = Math.round(Math.min(width, height) * 0.055);
    const top = Math.round((height - size - textSize * 2) / 2);
    await writeGenerated(
      `public/startup-images/${startupName(device, theme, orientation)}`,
      png(
        svg(
          width,
          height,
          `
      <rect width="${width}" height="${height}" fill="${theme === "dark" ? "#111b17" : "#f5f7f4"}"/>
      ${mark((width - size) / 2, top, size)}
      <text x="${width / 2}" y="${top + size + textSize * 1.5}" text-anchor="middle" fill="${theme === "dark" ? "#f5f7f4" : "#172d24"}" font-family="Inter" font-size="${textSize}" font-weight="600">Voltura Places</text>`,
        ),
      ),
    );
  }
  await mkdir(".artifacts", { recursive: true });
  await writeGenerated(cachePath, await signature());
}
