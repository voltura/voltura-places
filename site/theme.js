(() => {
  const root = document.documentElement;
  let theme = "dark";
  try {
    const saved = localStorage.getItem("places-promo-theme");
    if (saved === "light" || saved === "dark") theme = saved;
  } catch {}
  const apply = () => {
    root.dataset.theme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "dark" ? "#111b17" : "#fafbf7");
    const toggle = document.querySelector(".theme-toggle");
    if (toggle) {
      toggle.setAttribute("aria-checked", String(theme === "dark"));
      toggle.title = theme === "dark" ? toggle.dataset.lightLabel : toggle.dataset.darkLabel;
    }
  };
  apply();
  document.addEventListener("DOMContentLoaded", () => {
    apply();
    document.querySelector(".theme-toggle")?.addEventListener("click", () => {
      theme = theme === "dark" ? "light" : "dark";
      try {
        localStorage.setItem("places-promo-theme", theme);
      } catch {}
      apply();
    });
  });
})();
