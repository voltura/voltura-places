import { readFile } from "node:fs/promises";

export const startupDevices = JSON.parse(
  await readFile(new URL("../assets/branding/apple-startup-devices.json", import.meta.url), "utf8"),
);

export const startupName = (device, theme, orientation) =>
  `${device.name}-${device.width}x${device.height}-${device.dpr}x-${theme}-${orientation}.png`;
