import { renderPromo } from "../site/page.mjs";
import { readFile, writeFile, mkdir, cp, rm, lstat, realpath } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { createHash } from "node:crypto";
import { socialImage } from "./branding.mjs";
const themeScript = await readFile("site/theme.js", "utf8");
const content = JSON.parse(await readFile("site/content.json", "utf8"));
const output = resolve(".artifacts/promo");
await mkdir(resolve(".artifacts"), { recursive: true });
if (
  relative(process.cwd(), output) !== ".artifacts/promo" &&
  relative(process.cwd(), output) !== ".artifacts\\promo"
)
  throw new Error("Unsafe promo build directory");
if (
  (await lstat(resolve(".artifacts"))).isSymbolicLink() ||
  (await realpath(resolve(".artifacts"))) !== resolve(".artifacts")
)
  throw new Error("Linked artifact directory");
try {
  if ((await lstat(output)).isSymbolicLink()) throw new Error("Linked promo output");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
await rm(output, { recursive: true, force: true });
const css = await readFile("site/site.css"),
  hash = createHash("sha256").update(css).digest("hex").slice(0, 16);
await mkdir(".artifacts/promo/assets", { recursive: true });
await mkdir(".artifacts/promo/sv", { recursive: true });
await writeFile(`.artifacts/promo/assets/site.${hash}.css`, css);
await cp("public/icon.svg", ".artifacts/promo/assets/icon.svg");
for (const [language, c] of Object.entries(content)) {
  const prefix = language === "sv" ? "../" : "./";
  const appUrl = `https://places.voltura.se/?lang=${language}`;
  const social = socialImage(language);
  const socialName = `social-${language}.${createHash("sha256").update(social).digest("hex").slice(0, 16)}.png`;
  await writeFile(`.artifacts/promo/assets/${socialName}`, social);
  const pageUrl = `https://voltura.se/places/${language === "sv" ? "sv/" : ""}`;
  const imageUrl = `https://voltura.se/places/assets/${socialName}`;
  const imageAlt =
    language === "sv"
      ? "Voltura Places — spara platser och hitta tillbaka"
      : "Voltura Places — save your places and find your way back";
  const screenshot = await readFile(`site/assets/app-mobile${language === "sv" ? "-sv" : ""}.png`);
  const screenshotName = `app-${language}.${createHash("sha256").update(screenshot).digest("hex").slice(0, 16)}.png`;
  await writeFile(`.artifacts/promo/assets/${screenshotName}`, screenshot);
  const desktop = await readFile(`site/assets/app-desktop${language === "sv" ? "-sv" : ""}.png`);
  const desktopName = `desktop-${language}.${createHash("sha256").update(desktop).digest("hex").slice(0, 16)}.png`;
  await writeFile(`.artifacts/promo/assets/${desktopName}`, desktop);
  const html = renderPromo({
    language,
    c,
    prefix,
    appUrl,
    pageUrl,
    imageUrl,
    imageAlt,
    screenshotName,
    desktopName,
    cssName: `site.${hash}.css`,
    themeScript,
  });
  await writeFile(`.artifacts/promo/${language === "sv" ? "sv/" : ""}index.html`, html);
}
console.log("Built isolated English/Swedish promotional pages.");
