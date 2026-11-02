import { promoIdentityPath } from "../../scripts/preview-config.mjs";

export default async function verifyPromo() {
  const response = await fetch(`http://127.0.0.1:5175${promoIdentityPath}`, {
    redirect: "error",
    signal: AbortSignal.timeout(5000),
  });
  if (
    response.status !== 200 ||
    response.headers.get("Content-Type") !== "text/plain" ||
    (await response.text()) !== "voltura-places-promo"
  ) {
    throw new Error("Port 5175 must serve the Places promo from this checkout.");
  }
}
