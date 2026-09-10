import { expect, type Page, test } from "@playwright/test";

test("Router properties panel edits inputs, outputs, and routes", async ({ page }) => {
	await openEditor(page);

	const blockSearch = page.getByRole("textbox", { name: "Search blocks" });
	await blockSearch.fill("Router");
	await page.getByRole("button", { name: /^Router low/ }).click();

	const routerNode = page.locator(".react-flow__node").filter({ hasText: "Router" });
	await expect(routerNode).toContainText("1 in - 1 out - 1 route");

	const routerRoutes = page.getByRole("list", { name: "Router routes" });

	// Add output: gains a second output, still a single route.
	await page.getByRole("button", { name: "Add output" }).click();
	await expect(routerRoutes.getByRole("listitem")).toHaveCount(1);
	await expect(routerNode).toContainText("1 in - 2 out - 1 route");

	// Route the (still selected) first input to the new output.
	await page.getByRole("button", { name: "Toggle route to output 2" }).click();
	await expect(routerRoutes.getByRole("listitem")).toHaveCount(2);
	await expect(routerNode).toContainText("1 in - 2 out - 2 routes");

	// Reorder so the route to Output 2 executes first.
	await page.getByRole("button", { name: "Move route 2 up" }).click();
	await expect(routerRoutes.getByRole("listitem").first()).toContainText("Output 2");

	// Renaming a port updates the canvas handle label without touching routes.
	await page.getByRole("textbox", { name: "Output 2 label" }).fill("Alerts");
	await expect(routerNode.getByText("Alerts", { exact: true })).toBeVisible();
	await expect(routerRoutes.getByRole("listitem")).toHaveCount(2);

	// Removing the renamed output also removes the route that used it.
	await page.getByRole("button", { name: "Remove output 2" }).click();
	await expect(routerRoutes.getByRole("listitem")).toHaveCount(1);
	await expect(routerNode).toContainText("1 in - 1 out - 1 route");

	// A newly added input has no routes yet, which validation should flag.
	await page.getByRole("button", { name: "Add input" }).click();
	const routerErrors = page.getByRole("list", { name: "Router validation errors" });
	await expect(routerErrors).toContainText('Router input "Input 2" has no routes.');

	// Removing the original (only routed) input leaves the remaining input
	// unrouted, and now the output has no incoming route either.
	await page.getByRole("button", { name: "Remove input 1" }).click();
	await expect(routerErrors).toContainText('Router output "Output 1" has no incoming routes.');
	await expect(routerErrors).toContainText('Router input "Input 2" has no routes.');
});

async function openEditor(page: Page) {
	await page.goto("/");
	await page.getByRole("button", { name: "New project" }).click();
	await page.getByRole("button", { name: "Create project" }).click();
	await expect(page.getByRole("button", { name: "Open asset editor" })).toBeVisible();
}
