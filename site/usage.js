const section = document.querySelector("[data-usage]");
if (section) {
  const sv = document.documentElement.lang === "sv";

  const t = (en, se) => (sv ? se : en);

  const locale = sv ? "sv-SE" : "en-GB";
  const status = section.querySelector("[data-usage-status]");
  const metrics = [...section.querySelectorAll("[data-metric]")];
  const endpoint =
    location.origin === "http://127.0.0.1:5175"
      ? "http://127.0.0.1:5173/api/v1/statistics"
      : "https://places.voltura.se/api/v1/statistics";
  let busy = false;

  async function refresh() {
    if (busy || document.visibilityState !== "visible") {
      return;
    }
    busy = true;
    try {
      const response = await fetch(endpoint, {
        credentials: "omit",
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) {
        throw new Error("unavailable");
      }
      const data = await response.json();
      if (
        data.version !== 1 ||
        !Number.isSafeInteger(data.generatedAt) ||
        data.generatedAt <= 0 ||
        !Number.isSafeInteger(data.activityStartedAt) ||
        data.activityStartedAt <= 0 ||
        metrics.some(
          (node) =>
            !Number.isFinite(data[node.dataset.metric]) ||
            data[node.dataset.metric] < 0 ||
            (node.dataset.metric !== "averagePersonalPlaces" &&
              !Number.isSafeInteger(data[node.dataset.metric])),
        )
      ) {
        throw new Error("invalidStatistics");
      }
      section.dataset.state = "ready";
      section.setAttribute("aria-busy", "false");
      for (const node of metrics) {
        node.textContent = data[node.dataset.metric].toLocaleString(locale, {
          maximumFractionDigits: node.dataset.metric === "averagePersonalPlaces" ? 1 : 0,
        });
      }
      status.textContent = `${t("Updated", "Uppdaterad")} ${new Date(data.generatedAt).toLocaleString(locale)}`;
      section.querySelector("[data-activity-start]").textContent =
        `${t("Activity history since", "Aktivitetshistorik sedan")} ${new Date(data.activityStartedAt).toLocaleDateString(locale)}.`;
    } catch {
      section.dataset.state = "unavailable";
      section.setAttribute("aria-busy", "false");
      for (const node of metrics) {
        node.textContent = t("Unavailable", "Saknas");
      }
      status.textContent = t("Usage unavailable.", "Användning ej tillgänglig.");
    } finally {
      busy = false;
    }
  }

  document.addEventListener("visibilitychange", () => void refresh());
  window.addEventListener("online", () => void refresh());
  setInterval(() => void refresh(), 60_000);
  void refresh();
}
