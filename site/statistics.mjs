const escape = (value) =>
  String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
export function renderStatistics(stats, language) {
  const sv = language === "sv";
  const t = (en, se) => (sv ? se : en);
  const number = (n) => n.toLocaleString(sv ? "sv-SE" : "en-GB");
  const labels = {
    shared: t("Shared schemas & contracts", "Gemensamma scheman och kontrakt"),
    client: t("App client", "Appklient"),
    server: t("Server & database", "Server och databas"),
    tests: t("Tests", "Tester"),
    promo: t("Promo website", "Presentationssida"),
    tooling: t("Tooling & configuration", "Verktyg och konfiguration"),
  };
  const areas = Object.entries(stats.areas).sort((a, b) => b[1].lines - a[1].lines);
  const metric = (value, label, detail) =>
    `<div class="stat-card"><dt>${label}</dt><dd>${number(value)}</dd><p>${detail}</p></div>`;
  return `<section class="container stats-intro"><a class="stats-back" href="./">← ${t("Back to Places", "Tillbaka till Places")}</a><p class="eyebrow">${t("Behind the places", "Bakom platserna")}</p><h1>${t("Code", "Kod")}<span>${t(" statistics", "statistik")}</span></h1><p class="stats-lead">${t("A closer look at the code behind Voltura Places.", "En närmare titt på koden bakom Voltura Places.")}</p><p class="stats-snapshot">${t("Source snapshot", "Källkodsversion")}: ${escape(stats.date)} · <a href="https://github.com/voltura/voltura-places/tree/${escape(stats.revision)}">${escape(stats.revision.slice(0, 7))}</a>${stats.dirty ? ` · ${t("Local changes included", "Lokala ändringar ingår")}` : ""}</p></section>
<div class="container stats-content"><dl class="stats-summary">${metric(stats.lines, t("Source lines", "Källkodsrader"), t("Physical lines, including blanks", "Fysiska rader, inklusive tomrader"))}${metric(stats.files, t("Source files", "Källkodsfiler"), t("App, server, website, tests & tooling", "App, server, webbplats, tester och verktyg"))}${metric(stats.areas.tests?.files ?? 0, t("Test files", "Testfiler"), t("Tracked automated test sources", "Versionshanterade automatiserade tester"))}${metric(stats.commands, t("NPM commands", "NPM-kommandon"), t("Build, check, preview & publish", "Bygg, kontrollera, förhandsvisa och publicera"))}</dl>
<div class="stats-grid"><section class="stats-panel"><p class="eyebrow">${t("Repository composition", "Kodbasens uppdelning")}</p><h2>${t("Source lines by area", "Källkodsrader per område")}</h2><div class="stats-bars">${areas.map(([key, area]) => `<div class="stats-bar-row"><div><span>${labels[key]}</span><strong>${number(area.lines)}</strong></div><meter min="0" max="${stats.lines || 1}" value="${area.lines}" aria-label="${labels[key]}">${number(area.lines)}</meter><p>${number(area.files)} ${t("files", "filer")} · ${number(Math.round((area.lines / (stats.lines || 1)) * 100))}%</p></div>`).join("")}</div></section>
<section class="stats-panel"><p class="eyebrow">${t("Languages", "Språk")}</p><h2>${t("The building blocks", "Byggstenarna")}</h2><div class="stats-table-wrap"><table class="stats-table"><thead><tr><th scope="col">${t("File type", "Filtyp")}</th><th scope="col">${t("Files", "Filer")}</th><th scope="col">${t("Lines", "Rader")}</th></tr></thead><tbody>${Object.entries(
    stats.languages,
  )
    .sort((a, b) => b[1].lines - a[1].lines)
    .map(
      ([ext, row]) =>
        `<tr><th scope="row"><code>${escape(ext)}</code></th><td>${number(row.files)}</td><td>${number(row.lines)}</td></tr>`,
    )
    .join("")}</tbody></table></div></section></div>
<section class="stats-panel stats-method"><h2>${t("About these numbers", "Om siffrorna")}</h2><p>${t("Generated from Git-tracked source files each time the promo site is built. Lines include comments and blank lines. Dependencies, lockfiles, generated builds, screenshots and documentation are excluded from source totals. Test files are counted, not individual test cases or passing results.", "Genereras från Git-versionshanterade källkodsfiler varje gång presentationssidan byggs. Rader inkluderar kommentarer och tomrader. Beroenden, låsfiler, genererade byggen, skärmbilder och dokumentation ingår inte i källkodstotalerna. Testfiler räknas, inte enskilda testfall eller godkända resultat.")}</p><p>${t("Also in the repository", "Även i kodbasen")}: ${number(stats.documents)} ${t("documents", "dokument")}, ${number(stats.assets)} ${t("image assets", "bildresurser")}, ${number(stats.dependencies)} ${t("runtime dependencies", "runtime-beroenden")} ${t("and", "och")} ${number(stats.devDependencies)} ${t("development dependencies", "utvecklingsberoenden")}.</p><a class="button secondary" href="https://github.com/voltura/voltura-places">${t("Explore the source on GitHub", "Utforska källkoden på GitHub")} ↗</a></section></div>`;
}
