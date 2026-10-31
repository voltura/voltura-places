// Render-blocking, same-origin initialization runs before styles and app rendering.
// Keep the skin allowlist aligned with foundation/appearance.ts.
(() => {
  let mode = "dark";
  let skin = "forest";
  try {
    const saved = JSON.parse(localStorage.getItem("places-preferences") || "null");
    if (
      saved &&
      ["en", "sv"].includes(saved.language) &&
      ["", "google", "apple", "geo"].includes(saved.provider) &&
      ["light", "dark", "system"].includes(saved.theme)
    ) {
      mode = saved.theme;
      if (
        ["forest", "retro-wood", "modern-metallic", "modern-black", "midnight", "matrix"].includes(
          saved.skin,
        )
      )
        skin = saved.skin;
    }
  } catch {
    /* Storage is optional. */
  }
  document.documentElement.dataset.theme =
    mode === "system"
      ? matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : mode;
  document.documentElement.dataset.skin = skin;
})();
