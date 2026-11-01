import { test, expect } from "./fixtures";

test("Edit place reuses deletion confirmation and preserves cancelled edits", async ({
  page,
  context,
}, testInfo) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 0, longitude: 0, accuracy: 8 });
  await page.goto("/");
  await page.getByRole("button", { name: "Save position", exact: true }).click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page
    .locator(".details-content:visible")
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  const editor = page.getByRole("dialog", { name: "Edit place", exact: true });
  await editor.getByRole("textbox", { name: "Name", exact: true }).fill("Unsaved edit");
  const remove = editor.getByRole("button", { name: "Delete", exact: true });
  await expect(remove.locator("svg")).toHaveCount(1);
  await remove.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("edit-place-delete.png") });
  await remove.click();
  const confirmation = page.getByRole("dialog", { name: "Delete this place?", exact: true });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "Cancel", exact: true }).last().click();
  await expect(editor.getByRole("textbox", { name: "Name", exact: true })).toHaveValue(
    "Unsaved edit",
  );
  await expect(page.locator("article.place-card")).toHaveCount(1);
  await remove.click();
  await confirmation.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.locator(".card-main")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: "Save position", exact: true })).toBeEnabled();
  await expect(page.locator(".card-main")).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Edit place", exact: true })).toHaveCount(0);
});
