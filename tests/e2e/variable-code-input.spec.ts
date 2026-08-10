import { expect, type Page, test } from "@playwright/test";

/**
 * A single-line variable field used to look like it truncated its value.
 *
 * The textarea holding the text is transparent; the highlighted `pre` behind
 * it is what a reader sees. The scroll sync ran only for multi-line fields, so
 * on one line the textarea scrolled to follow the caret while the layer stayed
 * at zero: the text appeared to stop at the right edge, the caret walked off
 * into nothing, and a selection past the edge was invisible.
 */

async function openEditor(page: Page) {
	await page.goto("/");
	await page.getByRole("button", { name: "New project" }).click();
	await page.getByRole("button", { name: "Create project" }).click();
	await expect(page.getByRole("button", { name: "Open asset editor" })).toBeVisible();
}

const LONG_VALUE = "the quick brown fox jumps over the lazy dog and keeps running well past the edge";

test("a single line variable field scrolls its highlight layer with the caret", async ({ page }) => {
	await openEditor(page);
	await page.getByRole("button", { name: "Manual" }).click();
	await page.getByRole("textbox", { name: "Search blocks" }).fill("Notification");
	await page.getByRole("button", { name: /^Show Notification/ }).click();

	// Title is single line and variable-aware, the shape the bug lived in.
	const title = page.getByRole("textbox", { name: "Title", exact: true });
	await title.fill(LONG_VALUE);
	await title.focus();

	const overflows = await title.evaluate((element: HTMLTextAreaElement) => element.scrollWidth > element.clientWidth);
	expect(overflows, "the value must be longer than the field for this test to mean anything").toBe(true);

	await page.keyboard.press("End");
	const caretScroll = await title.evaluate((element: HTMLTextAreaElement) => element.scrollLeft);
	expect(caretScroll, "the field scrolls to keep the caret visible").toBeGreaterThan(0);

	// The assertion that fails without the fix: the layer stayed at 0.
	const layerScroll = await page
		.locator("[data-variable-highlight-layer]")
		.first()
		.evaluate((element) => element.scrollLeft);
	expect(layerScroll, "the highlight layer must follow the caret").toBe(caretScroll);

	// Selecting everything must reach past the visible edge.
	await page.keyboard.press("ControlOrMeta+a");
	const selected = await title.evaluate((element: HTMLTextAreaElement) =>
		element.value.slice(element.selectionStart, element.selectionEnd),
	);
	expect(selected).toBe(LONG_VALUE);
});
