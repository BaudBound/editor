import { expect, type Locator, type Page, test } from "@playwright/test";

test("Router properties panel connects inputs to outputs by dragging", async ({ page }) => {
	await openEditor(page);

	const blockSearch = page.getByRole("textbox", { name: "Search blocks" });
	await blockSearch.fill("Router");
	await page.getByRole("button", { name: /^Router low/ }).click();

	const routerNode = page.locator(".react-flow__node").filter({ hasText: "Router" });
	await expect(routerNode).toContainText("1 in - 1 out - 1 route");

	const route = (input: string, output: string, order: number) =>
		page.getByRole("button", { name: `Route ${input} to ${output}, order ${order}`, exact: true });
	const outputPill = (name: string) =>
		page.getByRole("list", { name: "Router outputs" }).getByRole("button", { name, exact: true });
	const inputPill = (name: string) =>
		page.getByRole("list", { name: "Router inputs" }).getByRole("button", { name, exact: true });

	// The default route is drawn between the only two pills.
	await expect(route("Input 1", "Output 1", 1)).toBeAttached();

	// Add output: a new pill nothing reaches yet. It is selected for editing right away.
	await page.getByRole("button", { name: "Add output", exact: true }).click();
	await expect(routerNode).toContainText("1 in - 2 out - 1 route");
	await expect(page.getByLabel("Output 2 is not reached")).toBeVisible();
	await expect(page.getByRole("toolbar", { name: "Output 2" })).toBeVisible();

	// Expand into the dialog and connect there: the dialog shows the same routes
	// and the same toolbar, and the connection is visible in the inspector afterwards.
	await page.getByRole("button", { name: "Expand router routes" }).click();
	const dialog = page.getByRole("dialog", { name: "Router routes" });
	await expect(dialog).toBeVisible();
	await expect(dialog.getByRole("button", { name: "Route Input 1 to Output 1, order 1", exact: true })).toBeAttached();
	await dragToConnect(
		page,
		dialog.getByRole("button", { name: "Drag from Input 1 to connect" }),
		dialog.getByRole("list", { name: "Router outputs" }).getByRole("button", { name: "Output 2", exact: true }),
	);
	await expect(dialog.getByRole("toolbar", { name: "Route Input 1 to Output 2" })).toContainText("Order 2 of 2");
	await page.getByRole("button", { name: "Close router routes" }).click();
	await expect(dialog).toHaveCount(0);
	await expect(route("Input 1", "Output 2", 2)).toBeAttached();
	await expect(routerNode).toContainText("1 in - 2 out - 2 routes");
	await expect(page.getByLabel("Output 2 is not reached")).toHaveCount(0);
	await expect(page.getByRole("toolbar", { name: "Route Input 1 to Output 2" })).toContainText("Order 2 of 2");

	// Dragging the same pair again changes nothing.
	await dragToConnect(page, page.getByRole("button", { name: "Drag from Input 1 to connect" }), outputPill("Output 2"));
	await expect(routerNode).toContainText("1 in - 2 out - 2 routes");

	// Move the selected line earlier: it becomes order 1.
	await page.getByRole("button", { name: "Move route Input 1 to Output 2 earlier" }).click();
	await expect(route("Input 1", "Output 2", 1)).toBeAttached();
	await expect(route("Input 1", "Output 1", 2)).toBeAttached();

	// Selecting a pill opens its toolbar; renaming updates the canvas handle label and the line names.
	await outputPill("Output 2").click();
	await page.getByRole("textbox", { name: "Output 2 label" }).fill("Alerts");
	await expect(routerNode.getByText("Alerts", { exact: true })).toBeVisible();
	await expect(route("Input 1", "Alerts", 1)).toBeAttached();
	await expect(routerNode).toContainText("1 in - 2 out - 2 routes");

	// Selecting a line by clicking it and removing it renumbers the rest of the row.
	await route("Input 1", "Alerts", 1).dispatchEvent("click");
	await page.getByRole("button", { name: "Remove route Input 1 to Alerts" }).click();
	await expect(route("Input 1", "Output 1", 1)).toBeAttached();
	await expect(page.getByLabel("Alerts is not reached")).toBeVisible();
	await expect(routerNode).toContainText("1 in - 2 out - 1 route");

	// Removing the renamed output drops its pill.
	await outputPill("Alerts").click();
	await page.getByRole("button", { name: "Remove output 2" }).click();
	await expect(outputPill("Alerts")).toHaveCount(0);
	await expect(routerNode).toContainText("1 in - 1 out - 1 route");

	// A newly added input has no routes yet, which the pill and validation both flag.
	await page.getByRole("button", { name: "Add input", exact: true }).click();
	const routerErrors = page.getByRole("list", { name: "Router validation errors" });
	await expect(routerErrors).toContainText('Router input "Input 2" has no routes.');
	await expect(page.getByLabel("Input 2 has no routes")).toBeVisible();

	// Removing the original (only routed) input leaves the remaining input
	// unrouted, and now the output has no incoming route either.
	await inputPill("Input 1").click();
	await page.getByRole("button", { name: "Remove input 1" }).click();
	await expect(routerErrors).toContainText('Router output "Output 1" has no incoming routes.');
	await expect(routerErrors).toContainText('Router input "Input 2" has no routes.');
	await expect(page.getByLabel("Output 1 is not reached")).toBeVisible();
});

async function dragToConnect(page: Page, handle: Locator, target: Locator) {
	const from = await handle.boundingBox();
	const to = await target.boundingBox();
	if (!from || !to) throw new Error("drag endpoints must be visible");
	await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
	await page.mouse.down();
	await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
	await page.mouse.up();
}

async function openEditor(page: Page) {
	await page.goto("/");
	await page.getByRole("button", { name: "New project" }).click();
	await page.getByRole("button", { name: "Create project" }).click();
	await expect(page.getByRole("button", { name: "Open asset editor" })).toBeVisible();
}
