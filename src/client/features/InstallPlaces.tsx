import { useSyncExternalStore } from "react";
import { ChevronRight, ChevronDown, Download, Share, SquarePlus, Check } from "lucide-react";
import {
  appleInstallBrowser,
  appleInstallDevice,
  manualInstallBrowser,
  installationPlatform,
} from "../foundation/installation";
import { installation } from "../foundation/installation-runtime";
import type { Message } from "../foundation/i18n";

export function InstallPlaces({
  t,
  firstUse = false,
}: {
  t: (key: Message) => string;
  firstUse?: boolean;
}) {
  const state = useSyncExternalStore(installation.subscribe, installation.getSnapshot);
  if (state.installed) {
    return null;
  }
  const platform = installationPlatform(navigator);
  if (firstUse && platform === "other") {
    return null;
  }
  const appleBrowser = appleInstallBrowser(navigator);
  const appleDevice = appleInstallDevice(navigator);
  const manualBrowser = manualInstallBrowser(navigator);
  const manualMessage =
    platform === "android"
      ? manualBrowser === "chrome"
        ? "installAndroid"
        : "installAndroidOther"
      : manualBrowser === "chrome"
        ? "installChromeDesktop"
        : manualBrowser === "edge"
          ? "installEdgeDesktop"
          : manualBrowser === "safari-mac"
            ? "installSafariMac"
            : "installOther";
  const disclosure = (
    <details>
      <summary className={firstUse ? "button primary" : undefined}>
        <span>{t(firstUse ? "installationSteps" : "install")}</span>
        <ChevronRight aria-hidden="true" size={20} />
      </summary>
      <div className="install-content">
        {state.available || state.pending ? (
          <button
            className="button primary"
            disabled={state.pending}
            onClick={() => void installation.install()}
          >
            <Download size={20} aria-hidden="true" />
            {t(state.pending ? "installPending" : "install")}
          </button>
        ) : platform === "ios" ? (
          <>
            <p className="muted">
              {t(
                appleBrowser === "chrome"
                  ? "installIOSChrome"
                  : appleBrowser === "safari"
                    ? "installIOS"
                    : "installIOSOther",
              )}
            </p>
            <ol className="install-steps">
              <li>
                <Share size={22} aria-hidden="true" />
                <span>
                  {t(
                    appleBrowser === "chrome"
                      ? "installChromeShare"
                      : appleDevice === "ipad"
                        ? "installIPadShare"
                        : "installShare",
                  )}
                </span>
              </li>
              {appleBrowser !== "chrome" && (
                <li>
                  <ChevronDown size={22} aria-hidden="true" />
                  <span>{t("installExpandShare")}</span>
                </li>
              )}
              <li>
                <SquarePlus size={22} aria-hidden="true" />
                <span>
                  {t(appleBrowser === "chrome" ? "installChromeHomeScreen" : "installHomeScreen")}
                </span>
              </li>
              <li>
                <Check size={22} aria-hidden="true" />
                <span>
                  {t(appleBrowser === "chrome" ? "installChromeConfirm" : "installConfirm")}
                </span>
              </li>
            </ol>
            {appleBrowser === "chrome" && <p className="muted">{t("installIOSFallback")}</p>}
          </>
        ) : (
          <p className="muted">{t(manualMessage)}</p>
        )}
        {state.failed && (
          <p role="status" className="muted">
            {t("installFailed")}
          </p>
        )}
      </div>
    </details>
  );

  return firstUse ? (
    <section className="onboarding-step stack" aria-labelledby="onboarding-install-title">
      <h3 className="onboarding-step-heading" id="onboarding-install-title">
        <span className="onboarding-step-number" aria-hidden="true" />
        {t("install")}
      </h3>
      <p>{t("accountChoiceInstall")}</p>
      <div className="preferences-disclosures">{disclosure}</div>
    </section>
  ) : (
    disclosure
  );
}
