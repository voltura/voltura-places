import { installationPlatform } from "./installation";

export function mapLinkTarget(): "_self" | "_blank" {
  const installed =
    matchMedia("(display-mode: standalone)").matches ||
    matchMedia("(display-mode: fullscreen)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;

  // A new browsing context can survive a universal-link handoff as an empty
  // Safari sheet above an installed Apple web app.
  return installed && installationPlatform(navigator) === "ios" ? "_self" : "_blank";
}

export function openMapLink(url: string) {
  const link = document.createElement("a");
  link.href = url;
  link.target = mapLinkTarget();
  link.rel = "noopener noreferrer";
  document.body.appendChild(link);
  link.click();
  link.remove();
}
