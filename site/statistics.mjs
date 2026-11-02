import { renderUsage } from "./usage.mjs";

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

  const metric = (value, label) =>
    `<div class="stat-card"><dt>${label}</dt><dd>${number(value)}</dd></div>`;

  const snapshot = `<p class="stats-snapshot">${t("Source", "Källkod")}: ${escape(stats.date)} · <a href="https://github.com/voltura/voltura-places/tree/${escape(stats.revision)}">${escape(stats.revision.slice(0, 7))}</a>${stats.dirty ? ` · ${t("Local changes", "Lokala ändringar")}` : ""}</p>`;

  return `<section class="container stats-intro"><h1>${t("Usage statistics", "Användningsstatistik")}</h1></section>
<div class="container stats-content">${renderUsage(language)}<dl class="stats-summary">${metric(stats.lines, t("Source lines", "Källkodsrader"))}${metric(stats.files, t("Source files", "Källkodsfiler"))}${metric(stats.areas.tests?.files ?? 0, t("Test files", "Testfiler"))}${metric(stats.commands, t("NPM commands", "NPM-kommandon"))}</dl>
<div class="stats-grid"><section class="stats-panel"><h2>${t("Source lines by area", "Källkodsrader per område")}</h2><div class="stats-bars">${areas.map(([key, area]) => `<div class="stats-bar-row"><div><span>${labels[key]}</span><strong>${number(area.lines)}</strong></div><meter min="0" max="${stats.lines || 1}" value="${area.lines}" aria-label="${labels[key]}">${number(area.lines)}</meter><p>${number(area.files)} ${t("files", "filer")} · ${number(Math.round((area.lines / (stats.lines || 1)) * 100))}%</p></div>`).join("")}</div></section>
<section class="stats-panel"><h2>${t("Languages", "Språk")}</h2><div class="stats-table-wrap"><table class="stats-table"><thead><tr><th scope="col">${t("File type", "Filtyp")}</th><th scope="col">${t("Files", "Filer")}</th><th scope="col">${t("Lines", "Rader")}</th></tr></thead><tbody>${Object.entries(
    stats.languages,
  )
    .sort((a, b) => b[1].lines - a[1].lines)
    .map(
      ([ext, row]) =>
        `<tr><th scope="row"><code>${escape(ext)}</code></th><td>${number(row.files)}</td><td>${number(row.lines)}</td></tr>`,
    )
    .join("")}</tbody></table></div></section></div>
<details class="stats-method"><summary><span class="disclosure-label">${t("About the code", "Om koden")}</span></summary><div class="usage-method-panel">${snapshot}<p>${t("Counts tracked source files at build time. Lines include blanks and comments. Excludes dependencies, lockfiles, generated files, images and docs. Test files are counted, not test results.", "Räknar versionshanterade källkodsfiler vid bygge. Rader inkluderar tomrader och kommentarer. Beroenden, låsfiler, genererade filer, bilder och dokument utesluts. Testfiler räknas, inte testresultat.")}</p><p>${t("Also in the repository", "Även i kodbasen")}: ${number(stats.documents)} ${t("documents", "dokument")}, ${number(stats.assets)} ${t("image assets", "bildresurser")}, ${number(stats.dependencies)} ${t("runtime dependencies", "runtime-beroenden")} ${t("and", "och")} ${number(stats.devDependencies)} ${t("development dependencies", "utvecklingsberoenden")}.</p><a class="button secondary" href="https://github.com/voltura/voltura-places">${t("Explore the source on GitHub", "Utforska källkoden på GitHub")} ↗</a></div></details></div>`;
}
