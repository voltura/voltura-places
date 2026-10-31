export const skins = [
  "forest",
  "retro-wood",
  "modern-metallic",
  "modern-black",
  "midnight",
  "matrix",
] as const;
export type Skin = (typeof skins)[number];
export function validSkin(value: unknown): Skin {
  return skins.includes(value as Skin) ? (value as Skin) : "forest";
}
export function applyAppearance(
  mode: "light" | "dark" | "system",
  skin: Skin,
  systemDark: boolean,
) {
  const root = document.documentElement;
  root.dataset.theme = mode === "system" ? (systemDark ? "dark" : "light") : mode;
  root.dataset.skin = skin;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", getComputedStyle(root).getPropertyValue("--bg").trim());
}
