const section = document.querySelector("[data-usage]");
if (section) {
  const sv = document.documentElement.lang === "sv";

  const t = (en, se) => (sv ? se : en);

  const locale = sv ? "sv-SE" : "en-GB";
  const status = section.querySelector("[data-usage-status]");
  const metrics = [...section.querySelectorAll("[data-metric]")];
  const endpoint = ["http://127.0.0.1:5175", "http://localhost:5175"].includes(location.origin)
    ? "http://127.0.0.1:5173/api/v1/statistics"
    : "https://places.voltura.se/api/v1/statistics";
  const counts = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const averages = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  let active;
  let timer;
  let lastSuccess = -Infinity;

  async function refresh() {
    if (active || document.visibilityState !== "visible") {
      return;
    }
    const controller = new AbortController();
    active = controller;
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      if (!navigator.onLine) {
        throw new Error("offline");
      }
      const response = await fetch(endpoint, {
        credentials: "omit",
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error("unavailable");
      }
      const data = await response.json();
      if (
        data.version !== 1 ||
        !Number.isSafeInteger(data.generatedAt) ||
        data.generatedAt <= 0 ||
        !Number.isFinite(new Date(data.generatedAt).getTime()) ||
        !Number.isSafeInteger(data.activityStartedAt) ||
        data.activityStartedAt <= 0 ||
        !Number.isFinite(new Date(data.activityStartedAt).getTime()) ||
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
      if (active !== controller) {
        return;
      }
      lastSuccess = performance.now();
      section.dataset.state = "ready";
      section.setAttribute("aria-busy", "false");
      for (const node of metrics) {
        const formatter = node.dataset.metric === "averagePersonalPlaces" ? averages : counts;
        node.textContent = formatter.format(data[node.dataset.metric]);
      }
      status.textContent = `${t("Updated", "Uppdaterad")} ${new Date(data.generatedAt).toLocaleString(locale)}`;
      section.querySelector("[data-activity-start]").textContent =
        `${t("Activity history since", "Aktivitetshistorik sedan")} ${new Date(data.activityStartedAt).toLocaleDateString(locale)}.`;
    } catch {
      if (active !== controller) {
        return;
      }
      lastSuccess = -Infinity;
      section.dataset.state = "unavailable";
      section.setAttribute("aria-busy", "false");
      for (const node of metrics) {
        node.textContent = t("Unavailable", "Saknas");
      }
      status.textContent = t("Usage unavailable.", "Användning ej tillgänglig.");
    } finally {
      clearTimeout(timeout);
      if (active === controller) {
        active = undefined;
      }
    }
  }

  function schedule() {
    clearTimeout(timer);
    if (document.visibilityState !== "visible" || !navigator.onLine) {
      active?.abort();
      active = undefined;
      if (document.visibilityState === "visible" && !navigator.onLine) {
        void refresh();
      }

      return;
    }
    const remaining = Math.max(0, 60_000 - (performance.now() - lastSuccess));
    if (remaining === 0) {
      void refresh();
    }
    timer = setTimeout(schedule, remaining || 60_000);
  }

  document.addEventListener("visibilitychange", schedule);
  window.addEventListener("online", schedule);
  window.addEventListener("offline", schedule);
  window.addEventListener("pageshow", schedule);
  schedule();
}
