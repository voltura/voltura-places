// Inverse Gauss–Krüger projection for EPSG:3006 (GRS 80, central meridian 15°).
// https://www.lantmateriet.se/sv/geodata/gps-geodesi-och-swepos/Referenssystem/Tvadimensionella-system/SWEREF-99-projektioner/
const flattening = 1 / 298.257222101;
const eccentricitySquared = flattening * (2 - flattening);
const n = flattening / (2 - flattening);
const scaledAxis = ((0.9996 * 6378137) / (1 + n)) * (1 + n ** 2 / 4 + n ** 4 / 64);
const beta = [
  n / 2 - (2 * n ** 2) / 3 + (37 * n ** 3) / 96 - n ** 4 / 360,
  n ** 2 / 48 + n ** 3 / 15 - (437 * n ** 4) / 1440,
  (17 * n ** 3) / 480 - (37 * n ** 4) / 840,
  (4397 * n ** 4) / 161280,
];
const e2 = eccentricitySquared;
const delta = [
  e2 + e2 ** 2 + e2 ** 3 + e2 ** 4,
  -(7 * e2 ** 2 + 17 * e2 ** 3 + 30 * e2 ** 4) / 6,
  (224 * e2 ** 3 + 889 * e2 ** 4) / 120,
  (-4279 * e2 ** 4) / 1260,
];

export function fromSweref(easting: number, northing: number) {
  const xi = northing / scaledAxis;
  const eta = (easting - 500000) / scaledAxis;
  let correctedXi = xi;
  let correctedEta = eta;
  for (const [index, coefficient] of beta.entries()) {
    const multiple = 2 * (index + 1);
    correctedXi -= coefficient * Math.sin(multiple * xi) * Math.cosh(multiple * eta);
    correctedEta -= coefficient * Math.cos(multiple * xi) * Math.sinh(multiple * eta);
  }
  const conformalLatitude = Math.asin(Math.sin(correctedXi) / Math.cosh(correctedEta));
  const sine = Math.sin(conformalLatitude);
  const latitude =
    conformalLatitude +
    sine *
      Math.cos(conformalLatitude) *
      delta.reduce((sum, coefficient, index) => sum + coefficient * sine ** (2 * index), 0);
  const longitude = Math.atan2(Math.sinh(correctedEta), Math.cos(correctedXi));

  return { latitude: (latitude * 180) / Math.PI, longitude: 15 + (longitude * 180) / Math.PI };
}
