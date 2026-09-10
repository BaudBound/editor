import { expect, type Page, test } from "@playwright/test";

test("Router properties panel edits inputs, outputs, and routes in the matrix", async ({ page }) => {
	await openEditor(page);

	const blockSearch = page.getByRole("textbox", { name: "Search blocks" });
	await blockSearch.fill("Router");
	await page.getByRole("button", { name: /^Router low/ }).click();

	const routerNode = page.locator(".react-flow__node").filter({ hasText: "Router" });
	await expect(routerNode).toContainText("1 in - 1 out - 1 route");

	const cell = (input: string, output: string) =>
		page.getByRole("button", { name: `Route ${input} to ${output}`, exact: true });

	// The default route is the only connected cell.
	await expect(cell("Input 1", "Output 1")).toHaveAttribute("aria-pressed", "true");
	await expect(cell("Input 1", "Output 1")).toHaveText("1");

	// Add output: a new empty column, still a single route, nothing reaches it yet.
	await page.getByRole("button", { name: "Add output", exact: true }).click();
	await expect(cell("Input 1", "Output 2")).toHaveAttribute("aria-pressed", "false");
	await expect(routerNode).toContainText("1 in - 2 out - 1 route");
	await expect(page.getByLabel("Output 2 incoming routes")).toHaveText(/0 in/);

	// Click the empty cell to connect; it becomes the second route in the row.
	await cell("Input 1", "Output 2").click();
	await expect(cell("Input 1", "Output 2")).toHaveAttribute("aria-pressed", "true");
	await expect(cell("Input 1", "Output 2")).toHaveText("2");
	await expect(routerNode).toContainText("1 in - 2 out - 2 routes");
	await expect(page.getByLabel("Output 2 incoming routes")).toHaveText(/1 in/);

	// Reorder within the row so Output 2 executes first.
	await page.getByRole("button", { name: "Move route Input 1 to Output 2 earlier" }).click();
	await expect(cell("Input 1", "Output 2")).toHaveText("1");
	await expect(cell("Input 1", "Output 1")).toHaveText("2");

	// Renaming a port updates the canvas handle label and the cell names, not the routes.
	await page.getByRole("textbox", { name: "Output 2 label" }).fill("Alerts");
	await expect(routerNode.getByText("Alerts", { exact: true })).toBeVisible();
	await expect(cell("Input 1", "Alerts")).toHaveText("1");
	await expect(routerNode).toContainText("1 in - 2 out - 2 routes");

	// Clicking a connected cell disconnects it and renumbers the rest of the row.
	await cell("Input 1", "Alerts").click();
	await expect(cell("Input 1", "Alerts")).toHaveAttribute("aria-pressed", "false");
	await expect(cell("Input 1", "Output 1")).toHaveText("1");
	await expect(page.getByLabel("Alerts incoming routes")).toHaveText(/0 in/);
	await expect(routerNode).toContainText("1 in - 2 out - 1 route");

	// Removing the renamed output drops its column.
	await page.getByRole("button", { name: "Remove output 2" }).click();
	await expect(cell("Input 1", "Alerts")).toHaveCount(0);
	await expect(routerNode).toContainText("1 in - 1 out - 1 route");

	// A newly added input has no routes yet, which the row and validation both flag.
	await page.getByRole("button", { name: "Add input", exact: true }).click();
	await expect(page.getByLabel("Input 2 has no routes")).toBeVisible();
	const routerErrors = page.getByRole("list", { name: "Router validation errors" });
	await expect(routerErrors).toContainText('Router input "Input 2" has no routes.');

	// Removing the original (only routed) input leaves the remaining input
	// unrouted, and now the output has no incoming route either.
	await page.getByRole("button", { name: "Remove input 1" }).click();
	await expect(routerErrors).toContainText('Router output "Output 1" has no incoming routes.');
	await expect(routerErrors).toContainText('Router input "Input 2" has no routes.');
	await expect(page.getByLabel("Output 1 incoming routes")).toHaveText(/0 in/);
});

async function openEditor(page: Page) {
	await page.goto("/");
	await page.getByRole("button", { name: "New project" }).click();
	await page.getByRole("button", { name: "Create project" }).click();
	await expect(page.getByRole("button", { name: "Open asset editor" })).toBeVisible();
}
