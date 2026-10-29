import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Resvg } from "@resvg/resvg-js";
export const startupDevices = JSON.parse(
  await readFile(new URL("../assets/branding/apple-startup-devices.json", import.meta.url), "utf8"),
);
export const startupName = (device, theme, orientation) =>
  `${device.name}-${device.width}x${device.height}-${device.dpr}x-${theme}-${orientation}.png`;
const font = {
  fontFiles: [resolve("assets/branding/Inter.ttf")],
  loadSystemFonts: false,
  defaultFontFamily: "Inter",
};
const source = await readFile(new URL("../public/icon.svg", import.meta.url), "utf8");
const inside = source.replace(/^.*?<svg[^>]*>/s, "").replace(/<\/svg>\s*$/, "");
const glyph = inside.replace(/<rect[^>]*\/>/, "");
const svg = (width, height, content) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${content}</svg>`;
const mark = (x, y, size) =>
  `<g transform="translate(${x} ${y}) scale(${size / 512})">${inside}</g>`;
const png = (markup, size) =>
  new Resvg(markup, { font, ...(size ? { fitTo: { mode: "width", value: size } } : {}) })
    .render()
    .asPng();
export function socialImage(language) {
  const swedish = language === "sv";
  return png(
    svg(
      1200,
      630,
      `
    <rect width="1200" height="630" fill="#111b17"/>
    <g fill="none" stroke="#8dd7ad" stroke-width="2" opacity=".12"><path d="M800 -80C540 130 1280 200 850 690M900 -80C640 130 1380 200 950 690M1000 -80C740 130 1480 200 1050 690M1100 -80C840 130 1580 200 1150 690"/></g>
    ${mark(76, 64, 96)}
    <text x="200" y="128" fill="#f5f7f4" font-family="Inter" font-size="44">voltura places</text>
    <text x="76" y="302" fill="#f5f7f4" font-family="Inter" font-size="70" font-weight="700">${swedish ? "Spara platser." : "Save your places."}</text>
    <text x="76" y="392" fill="#8dd7ad" font-family="Inter" font-size="70" font-weight="700">${swedish ? "Hitta tillbaka." : "Find your way back."}</text>
    <text x="80" y="480" fill="#b3c6bb" font-family="Inter" font-size="28">GPS · ${swedish ? "Foton" : "Photos"} · Offline</text>
    <text x="80" y="568" fill="#8dd7ad" font-family="Inter" font-size="24">voltura.se/places</text>`,
    ),
  );
}
export async function generateBranding() {
  await mkdir("public/startup-images", { recursive: true });
  for (const size of [192, 512]) {
    await writeFile(`public/icon-${size}.png`, png(source, size));
    await writeFile(
      `public/icon-maskable-${size}.png`,
      png(
        svg(
          512,
          512,
          `<rect width="512" height="512" fill="#126a50"/><g transform="translate(64 64) scale(.75)">${glyph}</g>`,
        ),
        size,
      ),
    );
  }
  const apple = svg(512, 512, `<rect width="512" height="512" fill="#126a50"/>${glyph}`);
  for (const size of [152, 167, 180])
    await writeFile(
      `public/apple-touch-icon${size === 180 ? "" : `-${size}`}.png`,
      png(apple, size),
    );
  for (const size of [16, 32, 48, 150])
    await writeFile(`public/icon-${size}.png`, png(source, size));
  const small = [16, 32, 48].map((size) => ({ size, bytes: png(source, size) }));
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
  await writeFile("public/favicon.ico", Buffer.concat([header, ...small.map((p) => p.bytes)]));
  for (const device of startupDevices)
    for (const theme of ["dark", "light"])
      for (const orientation of ["portrait", "landscape"]) {
        const width = (orientation === "portrait" ? device.width : device.height) * device.dpr;
        const height = (orientation === "portrait" ? device.height : device.width) * device.dpr;
        const size = Math.round(Math.min(width, height) * 0.28),
          textSize = Math.round(Math.min(width, height) * 0.055);
        const top = Math.round((height - size - textSize * 2) / 2);
        await writeFile(
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
  for (const lang of ["en", "sv"]) await writeFile(`public/social-${lang}.png`, socialImage(lang));
  console.log(
    `Generated Places icons, social cards and ${startupDevices.length * 4} Apple startup images.`,
  );
}
