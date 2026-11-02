(() => {
  const root = document.documentElement;
  root.classList.remove("no-js");
  let theme = "dark";
  try {
    const saved = localStorage.getItem("places-promo-theme");
    if (saved === "light" || saved === "dark") {
      theme = saved;
    }
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

  window.addEventListener("storage", (event) => {
    if (event.key === "places-promo-theme" || event.key === null) {
      try {
        if (event.storageArea === localStorage) {
          theme = localStorage.getItem("places-promo-theme") === "light" ? "light" : "dark";
          apply();
        }
      } catch {}
    }
  });
  apply();
  document.addEventListener("DOMContentLoaded", () => {
    apply();
    const languageLink = document.querySelector(".language");
    if (languageLink) {
      const localized = new URL(languageLink.href);

      const updateSection = () => {
        localized.hash = document.getElementById(location.hash.slice(1)) ? location.hash : "";
        languageLink.href = localized.href;
      };

      updateSection();
      window.addEventListener("hashchange", updateSection);
    }
    document.querySelector(".theme-toggle")?.addEventListener("click", () => {
      theme = theme === "dark" ? "light" : "dark";
      try {
        localStorage.setItem("places-promo-theme", theme);
      } catch {}
      apply();
    });
  });
})();
