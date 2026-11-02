import { test, expect } from "./fixtures";

for (const theme of ["dark", "light"]) {
  for (const [width, height] of [
    [320, 740],
    [1280, 740],
    [320, 480],
  ]) {
    test(`category appearance persists in ${theme} at ${width}x${height}px`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height });
      await page.addInitScript((theme) => {
        localStorage.setItem(
          "places-preferences",
          JSON.stringify({ theme, language: "en", provider: "" }),
        );
      }, theme);
      await page.goto("/");
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page
        .getByRole("combobox", { name: "Settings", exact: true })
        .selectOption("categories");
      await expect(page.locator(".category-list .category-icon")).toHaveCount(6);
      await page.getByRole("button", { name: "New category", exact: true }).click();
      const save = page.getByRole("button", { name: "Save", exact: true });
      await expect(save).toBeInViewport({ ratio: 1 });
      const initialSaveBox = await save.boundingBox();
      const name = page.getByRole("textbox", { name: "Name", exact: true });
      const field = page.locator(".category-name-field");
      const emptyFieldBox = await field.boundingBox();
      await field.click({ position: { x: 25, y: emptyFieldBox!.height / 2 } });
      await expect(name).toBeFocused();
      await name.fill("Camping");
      expect((await field.boundingBox())!.height).toBe(emptyFieldBox!.height);
      await expect(page.locator(".color-swatch")).toHaveCount(12);
      await expect(page.locator(".category-icon-grid button")).toHaveCount(49);
      await page.getByRole("button", { name: "Cyan", exact: true }).click();
      const noIcon = page.getByRole("button", { name: "No icon", exact: true });
      await expect(page.locator(".category-icon-grid button").nth(0)).toHaveAttribute(
        "aria-label",
        "Place pin",
      );
      await expect(page.locator(".category-icon-grid button").nth(1)).toHaveAttribute(
        "aria-label",
        "No icon",
      );
      await expect(page.getByRole("button", { name: "Place pin", exact: true })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await noIcon.press("Space");
      await expect(noIcon).toHaveAttribute("aria-pressed", "true");
      await expect(noIcon).toHaveAttribute("title", "No icon");
      await expect(noIcon.locator(".category-no-icon")).toBeVisible();
      await expect(field.locator(".category-name-preview")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Cyan", exact: true })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(await name.evaluate((el) => getComputedStyle(el).paddingInlineStart)).toBe("15px");
      await page.getByRole("button", { name: "Ice cream", exact: true }).press("Space");
      const preview = field.locator(".category-icon");
      await expect(preview).toHaveClass(/cyan/);
      await expect(preview.locator(".lucide-ice-cream-cone")).toHaveCount(1);
      expect(await name.evaluate((el) => getComputedStyle(el).color)).not.toBe(
        await preview.evaluate((el) => getComputedStyle(el).color),
      );
      await expect(page.getByRole("button", { name: "Ice cream", exact: true })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(
        await page
          .locator(".category-appearance-picker")
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
      const swatches = await page.locator(".color-swatch").evaluateAll((buttons) =>
        buttons.map((button) => {
          const rect = button.getBoundingClientRect();

          return {
            width: rect.width,
            height: rect.height,
            marker: getComputedStyle(button).getPropertyValue("--marker").trim(),
          };
        }),
      );
      expect(
        swatches.every((s) => s.width >= 48 && s.height >= 48 && s.marker.startsWith("#")),
      ).toBe(true);
      expect(new Set(swatches.map((s) => s.marker)).size).toBe(12);
      await expect(save).toBeInViewport({ ratio: 1 });
      const scrolledSaveBox = await save.boundingBox();
      expect(Math.abs(scrolledSaveBox!.y - initialSaveBox!.y)).toBeLessThan(1);
      const body = page.locator(".category-editor-body");
      if (
        await page
          .locator(".category-appearance-picker")
          .evaluate((el) => el.classList.contains("scroll-icons"))
      ) {
        expect(await body.evaluate((el) => el.scrollTop)).toBe(0);
        await expect(page.getByRole("textbox", { name: "Name", exact: true })).toBeInViewport({
          ratio: 1,
        });
        await expect(page.getByRole("button", { name: "Cyan", exact: true })).toBeInViewport({
          ratio: 1,
        });
        expect(
          await page.locator(".category-icon-scroll").evaluate((el) => el.scrollTop),
        ).toBeGreaterThan(0);
      } else {
        expect(await body.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
        expect(await page.locator(".category-icon-scroll").evaluate((el) => el.scrollTop)).toBe(0);
      }
      const lastIcon = await page
        .getByRole("button", { name: "Ice cream", exact: true })
        .boundingBox();
      expect(lastIcon!.y + lastIcon!.height).toBeLessThanOrEqual(scrolledSaveBox!.y);
      await page.screenshot({ path: testInfo.outputPath("category-picker.png") });
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(page.getByRole("heading", { name: "New category", exact: true })).toHaveCount(0);
      await page.reload();
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page
        .getByRole("combobox", { name: "Settings", exact: true })
        .selectOption("categories");
      await expect(
        page
          .locator(".category-list > div")
          .filter({ hasText: "Camping" })
          .locator(".category-icon.cyan .lucide-ice-cream-cone"),
      ).toHaveCount(1);
      await page.getByRole("button", { name: "Edit category Camping", exact: true }).click();
      await expect(page.getByRole("button", { name: "Ice cream", exact: true })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(page.getByRole("button", { name: "Cyan", exact: true })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      // Adapt an already-open editor as the available screen height changes.
      await page.setViewportSize({ width: 320, height: 480 });
      await expect(page.locator(".category-appearance-picker")).not.toHaveClass(/scroll-icons/);
      await expect(save).toBeInViewport({ ratio: 1 });
      await page.setViewportSize({ width: 320, height: 1000 });
      await expect(page.locator(".category-appearance-picker")).toHaveClass(/scroll-icons/);
      await expect(save).toBeInViewport({ ratio: 1 });
    });
  }
}

test("explicit no icon survives editing and leaves no icon gap on category surfaces", async ({
  page,
  context,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("combobox", { name: "Settings", exact: true }).selectOption("categories");
  await page.getByRole("button", { name: "New category", exact: true }).click();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("Plain");
  await page.getByRole("button", { name: "Cyan", exact: true }).click();
  const noIcon = page.getByRole("button", { name: "No icon", exact: true });
  await noIcon.click();
  const tile = await noIcon.boundingBox();
  expect(tile!.width).toBeGreaterThanOrEqual(48);
  expect(tile!.height).toBeGreaterThanOrEqual(48);
  expect(
    await noIcon.locator(".category-no-icon").evaluate((el) => getComputedStyle(el).borderTopStyle),
  ).toBe("dotted");
  await expect(noIcon).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Place pin", exact: true })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await page.screenshot({
    path: testInfo.outputPath("no-icon-selected.png"),
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const row = page.locator(".category-list > div").filter({ hasText: "Plain" });
  await expect(row.locator(".category-icon")).toHaveCount(0);
  expect(
    await row.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length),
  ).toBe(3);
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("combobox", { name: "Settings", exact: true }).selectOption("categories");
  await page.getByRole("button", { name: "Edit category Plain", exact: true }).click();
  await expect(noIcon).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".category-name-preview")).toHaveCount(0);
  await page.getByRole("button", { name: "Place pin", exact: true }).click();
  await expect(
    page.locator(".category-name-preview .category-icon.cyan .lucide-map-pin"),
  ).toHaveCount(1);
  await noIcon.press("Space");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Edit category", exact: true })).toHaveCount(0);
  await page
    .getByRole("dialog", { name: "Settings", exact: true })
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 59, longitude: 18, accuracy: 8 });
  await page.getByRole("button", { name: "Save position", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Place saved", exact: true });
  await editor.getByRole("textbox", { name: "Name", exact: true }).fill("Plain place");
  await editor
    .getByRole("combobox", { name: "Category", exact: true })
    .selectOption({ label: "Plain" });
  await expect(editor.locator(".editor-category .category-icon")).toHaveCount(6);
  await expect(editor.locator(".preference-value .category-icon")).toHaveCount(0);
  await editor.getByRole("button", { name: "Done", exact: true }).click();
  await expect(
    page
      .locator("nav")
      .getByRole("button", { name: "Plain", exact: true })
      .locator(".category-icon"),
  ).toHaveCount(0);
  const card = page.locator(".place-card").filter({ hasText: "Plain place" });
  await expect(card.locator(".place-marker")).toBeHidden();
  await card.locator(".card-main").click();
  await expect(page.locator(".details-content:visible .detail-marker")).toBeHidden();
});
