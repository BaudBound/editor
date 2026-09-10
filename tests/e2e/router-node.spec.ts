import { expect, type Page, test } from "@playwright/test";

test("Router properties panel edits inputs, outputs, and routes", async ({ page }) => {
	await openEditor(page);

	const blockSearch = page.getByRole("textbox", { name: "Search blocks" });
	await blockSearch.fill("Router");
	await page.getByRole("button", { name: /^Router low/ }).click();

	const routerNode = page.locator(".react-flow__node").filter({ hasText: "Router" });
	await expect(routerNode).toContainText("1 in - 1 out - 1 route");

	const input1Routes = page.getByRole("list", { name: "Routes from Input 1" });
	await expect(input1Routes.getByRole("listitem")).toHaveCount(1);
	await expect(input1Routes.getByRole("listitem").first()).toContainText("Output 1");

	// Add output: gains a second output, still a single route, and the new
	// output reports that nothing reaches it yet.
	await page.getByRole("button", { name: "Add output", exact: true }).click();
	await expect(input1Routes.getByRole("listitem")).toHaveCount(1);
	await expect(routerNode).toContainText("1 in - 2 out - 1 route");
	await expect(page.getByLabel("Output 2 incoming routes")).toHaveText(/0 in/);

	// Route Input 1 to the new output from its own row.
	await page.getByRole("button", { name: "Add output for Input 1" }).click();
	await page.getByRole("option", { name: "Output 2" }).click();
	await expect(input1Routes.getByRole("listitem")).toHaveCount(2);
	await expect(input1Routes.getByRole("listitem").nth(1)).toContainText("Output 2");
	await expect(routerNode).toContainText("1 in - 2 out - 2 routes");
	await expect(page.getByLabel("Output 2 incoming routes")).toHaveText(/1 in/);

	// Every output is now routed from Input 1, so the picker has nothing left.
	await expect(page.getByRole("button", { name: "Add output for Input 1" })).toBeDisabled();

	// Reorder so the route to Output 2 executes first.
	await page.getByRole("button", { name: "Move route 2 for Input 1 earlier" }).click();
	await expect(input1Routes.getByRole("listitem").first()).toContainText("Output 2");

	// Renaming a port updates the canvas handle label and the chip without touching routes.
	await page.getByRole("textbox", { name: "Output 2 label" }).fill("Alerts");
	await expect(routerNode.getByText("Alerts", { exact: true })).toBeVisible();
	await expect(input1Routes.getByRole("listitem").first()).toContainText("Alerts");
	await expect(input1Routes.getByRole("listitem")).toHaveCount(2);

	// Removing a route from its chip renumbers the rest.
	await page.getByRole("button", { name: "Remove route 1 for Input 1" }).click();
	await expect(input1Routes.getByRole("listitem")).toHaveCount(1);
	await expect(input1Routes.getByRole("listitem").first()).toContainText("Output 1");
	await expect(page.getByLabel("Alerts incoming routes")).toHaveText(/0 in/);

	// Removing the renamed output also removes its picker entry.
	await page.getByRole("button", { name: "Remove output 2" }).click();
	await expect(routerNode).toContainText("1 in - 1 out - 1 route");

	// A newly added input has no routes yet, which the row and validation both flag.
	await page.getByRole("button", { name: "Add input" }).click();
	const routerErrors = page.getByRole("list", { name: "Router validation errors" });
	await expect(routerErrors).toContainText('Router input "Input 2" has no routes.');
	await expect(page.getByRole("list", { name: "Routes from Input 2" })).toHaveCount(0);

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
