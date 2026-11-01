export function renderUsage(language) {
  const sv = language === "sv";
  const t = (en, se) => (sv ? se : en);
  const cards = [
    ["activeNow", t("Active now", "Aktiva nu")],
    ["activeToday", t("Active today", "Aktiva idag")],
    ["active30Days", t("Active · 30 days", "Aktiva · 30 dagar")],
    ["registeredAccounts", t("Registered accounts", "Registrerade konton")],
    ["cloudPlaces", t("Cloud places", "Platser i molnet")],
    ["averagePersonalPlaces", t("Avg. places / account", "Snittplatser / konto")],
  ];
  return `<section class="usage-section" data-usage data-state="loading" aria-busy="true" aria-label="${t("Usage", "Användning")}">
<dl class="stats-summary usage-summary">${cards.map(([key, label]) => `<div class="stat-card"><dt>${label}</dt><dd data-metric="${key}"><span class="stat-skeleton" role="img" aria-label="${t("Loading", "Laddar")}"></span></dd></div>`).join("")}</dl>
<details class="usage-method"><summary aria-label="${t("How we count", "Så räknar vi")}"><span class="usage-status" data-usage-status role="status">${t("Loading…", "Laddar…")}</span><span class="disclosure-label">${t("How we count", "Så räknar vi")}</span></summary><div class="usage-method-panel">
<p>${t("Activity counts browsers, not people. Now: last two minutes. Today: Swedish time. One person may use several devices. Offline use and opted-out browsers are excluded.", "Aktivitet räknar webbläsare, inte personer. Nu: senaste två minuterna. Idag: svensk tid. En person kan använda flera enheter. Offlineanvändning och avstängd rapportering ingår inte.")}</p>
<p>${t("Cloud places exclude deleted and guest-only places. Shared places count once. The average covers personal places across all accounts, including empty ones.", "Molnplatser utesluter raderade platser och gästplatser. Delade platser räknas en gång. Snittet gäller personliga platser för alla konton, även tomma.")}</p>
<p>${t("A random browser ID is hashed on the server. Activity window: 31 days. Older entries are cleared during use. Disable reporting in Settings → Privacy.", "Ett slumpat webbläsar-ID hashas på servern. Aktivitetsfönster: 31 dagar. Äldre poster rensas vid användning. Stäng av rapportering i Inställningar → Integritet.")}</p>
<p data-activity-start>${t("Activity history starts with this release.", "Aktivitetshistoriken börjar med den här versionen.")}</p></div></details>
</section><h2 class="code-title">${t("Code statistics", "Kodstatistik")}</h2>`;
}
