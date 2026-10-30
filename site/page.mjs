const paths = {
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  external: '<path d="M7 17 17 7M7 7h10v10"/>',
  target:
    '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/>',
  image:
    '<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8" cy="8" r="1.5"/><path d="m4 17 5-5 4 4 3-3 5 5"/>',
  wifi: '<path d="M3 8a15 15 0 0 1 18 0M6 12a10 10 0 0 1 12 0m-9 4a5 5 0 0 1 6 0M12 20h.01M3 3l18 18"/>',
  users:
    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/><circle cx="9" cy="7" r="4"/>',
  search: '<circle cx="10.5" cy="10.5" r="7"/><path d="m16 16 5 5"/>',
  palette:
    '<path d="M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 0-4h-.5a1.5 1.5 0 0 1 0-3H16a5 5 0 0 0 5-5c0-4-5-6-9-6Z"/><path d="M7 9h.01M10 6h.01M15 6h.01M6 13h.01"/>',
  navigation: '<path d="m21 3-6.5 18-4-7.5L3 9.5 21 3Z"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3"/>',
  phone: '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M11 18h2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  moon: '<path d="M20.5 13.3A8.6 8.6 0 0 1 10.7 3.5a8.6 8.6 0 1 0 9.8 9.8Z"/>',
  code: '<path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18"/>',
};
const icon = (name, cls = "") =>
  `<svg class="icon ${cls}" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
export function renderPromo({
  language,
  c,
  prefix,
  appUrl,
  pageUrl,
  imageUrl,
  imageAlt,
  screenshotName,
  desktopName,
  cssName,
  themeScript,
}) {
  const asset = (name) => `${prefix}assets/${name}`;
  const brand = `<img src="${asset("icon.svg")}" width="38" height="38" alt=""><span>voltura <strong>places</strong></span>`;
  const appButton = `<a class="button primary" href="${appUrl}">${c.open}${icon("arrow")}</a>`;
  return `<!doctype html>
<html lang="${language}" data-theme="dark"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#111b17"><script>${themeScript}</script>
<title>Voltura Places — ${c.title}</title><meta name="description" content="${c.description}">
<link rel="canonical" href="${pageUrl}"><link rel="alternate" hreflang="en" href="https://voltura.se/places/"><link rel="alternate" hreflang="sv" href="https://voltura.se/places/sv/">
<meta property="og:title" content="Voltura Places — ${c.title}"><meta property="og:description" content="${c.description}"><meta property="og:type" content="website"><meta property="og:site_name" content="Voltura Places"><meta property="og:url" content="${pageUrl}"><meta property="og:locale" content="${language === "sv" ? "sv_SE" : "en_GB"}"><meta property="og:image" content="${imageUrl}"><meta property="og:image:type" content="image/png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="${imageAlt}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="Voltura Places — ${c.title}"><meta name="twitter:description" content="${c.description}"><meta name="twitter:image" content="${imageUrl}"><meta name="twitter:image:alt" content="${imageAlt}">
<link rel="icon" href="${asset("icon.svg")}"><link rel="stylesheet" href="${asset(cssName)}">
</head><body>
<a class="skip-link" href="#main">${c.skip}</a>
<header class="site-header"><div class="container header-inner">
  <a class="brand" href="${language === "sv" ? "./" : "./"}" aria-label="Voltura Places">${brand}</a>
  <nav class="main-nav" aria-label="${c.navLabel}"><a href="#features">${c.featuresNav}</a><a href="#sharing">${c.sharingNav}</a><a href="#install">${c.installNav}</a></nav>
  <div class="header-actions"><a class="language" href="${language === "sv" ? "../" : "sv/"}" lang="${language === "sv" ? "en" : "sv"}">${language === "sv" ? "English" : "Svenska"}</a><button class="theme-toggle" type="button" role="switch" aria-checked="true" aria-label="${c.darkTheme}" data-light-label="${c.lightThemeAction}" data-dark-label="${c.darkThemeAction}">${icon("sun", "theme-sun")}${icon("moon", "theme-moon")}</button><a class="header-open" href="${appUrl}">${c.open}${icon("external")}</a></div>
</div></header>
<main id="main">
<section class="hero container">
  <div class="hero-copy"><p class="eyebrow"><span class="status-dot"></span>${c.platforms}</p><h1>${c.title}<br><span>${c.titleSecond}</span></h1><p class="hero-description">${c.description}</p><div class="cta">${appButton}<a class="button secondary" href="https://github.com/voltura/voltura-places">${icon("code")}${c.github}</a></div><p class="free">${icon("check")}${c.free}</p></div>
  <div class="product-stage"><div class="stage-glow"></div><div class="desktop-device hero-desktop"><div class="window-bar"><span class="window-dots"><i></i><i></i><i></i></span><span>places.voltura.se</span>${icon("lock")}</div><img src="${asset(desktopName)}" width="1000" height="871" alt="${c.desktopAlt}" fetchpriority="high"></div><div class="phone-device"><img src="${asset(screenshotName)}" width="390" height="844" alt="${c.screenshotAlt}" fetchpriority="high"></div></div>
</section>
<div class="container"><div class="capability-strip">${c.capabilities.map(([glyph, label]) => `<div>${icon(glyph)}<span>${label}</span></div>`).join("")}</div></div>
<section id="features" class="section container">
  <div class="section-heading"><p class="eyebrow">${c.productLabel}</p><h2>${c.detailsTitle}</h2><p>${c.detailsText}</p></div>
  <div class="product-overview"><div class="desktop-device overview-device"><div class="window-bar"><span class="window-dots"><i></i><i></i><i></i></span><span>places.voltura.se</span>${icon("lock")}</div><img src="${asset(desktopName)}" width="1000" height="871" alt="${c.desktopAlt}" loading="lazy"></div><div class="feature-list">${c.detailFeatures.map(([glyph, title, text]) => `<article><span class="feature-icon">${icon(glyph)}</span><div><h3>${title}</h3><p>${text}</p></div></article>`).join("")}</div></div>
</section>
<section id="how" class="section section-tinted"><div class="container"><div class="section-heading compact"><p class="eyebrow">VOLTURA PLACES</p><h2>${c.how}</h2></div><div class="steps">${c.steps.map(([number, title, text]) => `<article><span class="step-number">${number}</span><h3>${title}</h3><p>${text}</p></article>`).join("")}</div></div></section>
<section id="sharing" class="section container sharing-section"><div class="sharing-copy"><p class="eyebrow">${c.sharingLabel}</p><h2>${c.sharingTitle}</h2><p class="section-intro">${c.sharingText}</p><ol class="sharing-steps">${c.sharingSteps.map(([number, title, text]) => `<li><span>${number}</span><div><h3>${title}</h3><p>${text}</p></div></li>`).join("")}</ol></div><div class="library-illustration" role="img" aria-label="${c.separateLabel}"><div class="library-head">${icon("users")}<span>${c.libraryLabel}</span><span class="library-count">3</span></div><div class="library-row private"><span class="library-symbol">${icon("lock")}</span><span>${c.privateLabel}</span><span class="row-line"></span></div><div class="library-row family"><span class="library-symbol">${icon("users")}</span><span>${c.familyLabel}</span><span class="row-line"></span></div><div class="library-row walks"><span class="library-symbol">${icon("users")}</span><span>${c.walksLabel}</span><span class="row-line"></span></div><div class="library-divider"></div><p>${icon("check")}${c.separateLabel}</p></div></section>
<section class="container offline-section"><div class="offline-panel"><div class="offline-symbol">${icon("wifi")}</div><div class="offline-copy"><p class="eyebrow">${c.offlineLabel}</p><h2>${c.offlineTitle}</h2><p>${c.offlineShort}</p><ul class="check-list">${c.offlinePoints.map((text) => `<li>${icon("check")}${text}</li>`).join("")}</ul><details><summary>${c.backupLabel}</summary><p>${c.offlineText}</p></details></div></div></section>
<section id="install" class="section container install-section"><div class="install-copy"><img class="install-icon" src="${asset("icon.svg")}" alt="" width="72" height="72"><p class="eyebrow">${c.installLabel}</p><h2>${c.installTitle}</h2><p>${c.installShort}</p><div class="cta">${appButton}</div><p class="free">${c.free}</p></div><div class="install-guide"><div>${icon("phone")}<p>${c.ios}</p></div><div>${icon("phone")}<p>${c.android}</p></div><p class="install-note">${c.installText}</p></div></section>
<section id="privacy" class="container privacy-section"><div class="privacy-copy">${icon("lock")}<div><h3>${c.privacyTitle}</h3><p>${c.privacyText}</p></div></div><details><summary>${c.privacy}</summary><p>${c.privacyDetail}</p><p>${c.sourceText}</p></details></section>
</main><footer class="site-footer"><div class="container footer-inner"><a class="brand footer-brand" href="${pageUrl}">${brand}</a><nav aria-label="${c.privacy}"><a href="#privacy">${c.privacy}</a><a href="https://github.com/voltura/voltura-places">${c.sourceLink}</a><a href="https://voltura.se/">Voltura AB</a><span>MIT · 2026</span></nav></div></footer>
</body></html>`;
}
