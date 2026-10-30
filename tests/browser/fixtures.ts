import { test as base, type BrowserContext } from "@playwright/test";
export * from "@playwright/test";

export async function mockMapTiles(context: BrowserContext) {
  await context.route("https://tile.openstreetmap.org/**", (route) =>
    route.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
    }),
  );
}

export const test = base.extend({
  context: async ({ context }, use) => {
    await mockMapTiles(context);
    await use(context);
  },
});
