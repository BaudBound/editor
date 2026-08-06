import { readFileSync, writeFileSync } from "node:fs";
import { expect, type Locator, type Page, test } from "@playwright/test";
import JSZip from "jszip";

async function addFormDialogComponent(page: Page, formBuilder: Locator, type: string = "Text input"): Promise<void> {
	await formBuilder.getByRole("button", { name: "Add form component" }).click();
	await page.getByRole("option", { name: type, exact: true }).click();
}

test("editor shell loads the core controls", async ({ page }) => {
	await openEditor(page);

	await expect(page.getByText("BaudBound Editor", { exact: true })).toBeVisible();
	const editingControls = page.getByRole("group", { name: "Canvas editing controls" });
	await expect(editingControls.getByRole("button", { name: "Save project" })).toBeVisible();
	await expect(editingControls.getByRole("button", { name: "Undo" })).toBeVisible();
	await expect(editingControls.getByRole("button", { name: "Redo" })).toBeVisible();
	await expect(editingControls.getByRole("button", { name: "Find a node" })).toBeVisible();
	const projectTools = page.getByRole("group", { name: "Canvas project tools" });
	await expect(projectTools.getByRole("button", { name: "Open help" })).toBeVisible();
	await expect(projectTools.getByRole("button", { name: "Open asset editor" })).toBeVisible();
	await expect(projectTools.getByRole("button", { name: "Open project settings" })).toBeVisible();
	const packageActions = page.getByRole("group", { name: "Package actions" });
	await expect(packageActions.getByRole("button", { name: "Verify script" })).toBeVisible();
	await expect(packageActions.getByRole("button", { name: "Export package" })).toBeVisible();
	await expect(page.getByRole("textbox", { name: "Search blocks" })).toBeVisible();
	await expect(page.getByRole("button", { name: "Properties" })).toBeVisible();
	await expect(page.getByRole("button", { name: "Simulator" })).toBeVisible();
	await page.getByRole("button", { name: "Simulator" }).click();
	await expect(page.getByRole("button", { name: "Stop simulation" })).toBeVisible();
});

test("real-time simulation streams steps without blocking the editor UI", async ({ page }) => {
	await openEditor(page);

	await page.getByRole("button", { name: "Manual" }).click();
	await page.getByRole("textbox", { name: "Search blocks" }).fill("Repeat");
	await page.getByRole("button", { name: /^Repeat low/ }).click();
	await page.getByRole("textbox", { name: "Repeat count" }).fill("40");

	const manualNode = page.locator(".react-flow__node").filter({ hasText: "Manual Trigger" });
	const repeatNode = page.locator(".react-flow__node").filter({ hasText: "Repeat" });
	await manualNode.locator(".react-flow__handle.source").first().dispatchEvent("click", { bubbles: true });
	await repeatNode.locator(".react-flow__handle.target").first().dispatchEvent("click", { bubbles: true });

	await page.getByRole("button", { name: "Simulator" }).click();
	await expect(page.getByRole("button", { name: "Simulation speed" })).toContainText("Real time");
	await page.getByRole("button", { name: "Trigger", exact: true }).click();

	const runState = page.getByText("Run State", { exact: true }).locator("..");
	await expect(runState).toContainText("running");
	await page.getByRole("button", { name: "Variables", exact: true }).click();
	await expect(page.getByRole("textbox", { name: "Search variables" })).toBeVisible();
	await page.getByRole("button", { name: "Simulation", exact: true }).click();
	await expect(page.getByText(/Simulation completed\./)).toHaveCount(0);
	await expect(page.getByText(/Repeat .* iteration 40 of 40\./)).toBeVisible();
	await expect(page.getByText(/Simulation completed\./)).toBeVisible();
	await expect(runState).toContainText("waiting");
});

test("simulation publishes each node output before completing and advancing its highlight", async ({ page }) => {
	await openEditor(page);

	await page.getByRole("button", { name: "Manual" }).click();
	const blockSearch = page.getByRole("textbox", { name: "Search blocks" });
	await blockSearch.fill("Log");
	await page.getByRole("button", { name: /^Log low/ }).click();
	await page.getByRole("textbox", { name: "Custom name" }).fill("First live log");
	await page.getByRole("textbox", { name: "Message" }).fill("first live output");

	await page.getByRole("button", { name: /^Log low/ }).click();
	await page.getByRole("textbox", { name: "Custom name" }).fill("Second live log");
	await page.getByRole("textbox", { name: "Message" }).fill("second live output");

	const manualNode = page.locator(".react-flow__node").filter({ hasText: "Manual Trigger" });
	const firstLogNode = page.locator(".react-flow__node").filter({ hasText: "First live log" });
	const secondLogNode = page.locator(".react-flow__node").filter({ hasText: "Second live log" });
	await manualNode.locator(".react-flow__handle.source").first().dispatchEvent("click", { bubbles: true });
	await firstLogNode.locator(".react-flow__handle.target").first().dispatchEvent("click", { bubbles: true });
	await firstLogNode.locator(".react-flow__handle.source").first().dispatchEvent("click", { bubbles: true });
	await secondLogNode.locator(".react-flow__handle.target").first().dispatchEvent("click", { bubbles: true });

	await page.getByRole("button", { name: "Simulator" }).click();
	const outputTab = page.getByRole("button", { name: "Output", exact: true });
	await outputTab.click();
	const outputPanel = outputTab.locator("xpath=ancestor::section");
	const firstLogState = firstLogNode.locator(".baud-script-node");
	const secondLogState = secondLogNode.locator(".baud-script-node");
	const firstOutput = outputPanel.getByText(/first live output/);
	const secondOutput = outputPanel.getByText(/second live output/);

	await page.evaluate(() => {
		const testWindow = window as typeof window & {
			__simulationSequence?: string[];
			__simulationSequenceObserver?: MutationObserver;
		};
		const sequence: string[] = [];
		const record = (event: string) => {
			if (!sequence.includes(event)) {
				sequence.push(event);
			}
		};
		const capture = () => {
			const flowNodes = [...document.querySelectorAll(".react-flow__node")];
			const firstLog = flowNodes.find((node) => node.textContent?.includes("First live log"));
			const secondLog = flowNodes.find((node) => node.textContent?.includes("Second live log"));
			const firstState = firstLog?.querySelector(".baud-script-node")?.getAttribute("data-simulation-state");
			const secondState = secondLog?.querySelector(".baud-script-node")?.getAttribute("data-simulation-state");
			const outputButton = [...document.querySelectorAll("button")].find(
				(button) => button.textContent?.trim() === "Output",
			);
			const outputText = outputButton?.closest("section")?.textContent ?? "";

			if (firstState === "active") record("first-active");
			if (outputText.includes("first live output")) record("first-output");
			if (firstState === "completed") record("first-completed");
			if (secondState === "active") record("second-active");
			if (outputText.includes("second live output")) record("second-output");
			if (secondState === "completed") record("second-completed");
		};

		testWindow.__simulationSequence = sequence;
		testWindow.__simulationSequenceObserver = new MutationObserver(capture);
		testWindow.__simulationSequenceObserver.observe(document.body, {
			attributes: true,
			childList: true,
			characterData: true,
			subtree: true,
		});
		capture();
	});

	await page.getByRole("button", { name: "Trigger", exact: true }).click();
	await expect(firstOutput).toBeVisible();
	await expect(secondOutput).toBeVisible();
	await expect(secondLogState).toHaveAttribute("data-simulation-state", "completed");
	const sequence = await page.evaluate(() => {
		const testWindow = window as typeof window & {
			__simulationSequence?: string[];
			__simulationSequenceObserver?: MutationObserver;
		};
		testWindow.__simulationSequenceObserver?.disconnect();
		return testWindow.__simulationSequence ?? [];
	});
	expect(sequence).toEqual([
		"first-active",
		"first-output",
		"first-completed",
		"second-active",
		"second-output",
		"second-completed",
	]);
	await expect(firstLogState).toHaveAttribute("data-simulation-state", "completed");
});

test("Message Dialog renders and returns the exact configured button set", async ({ page }) => {
	await openEditor(page);

	await page.getByRole("button", { name: "Manual" }).click();
	await page.getByRole("button", { name: "Dialogs" }).click();
	await page.getByRole("button", { name: /^Message Dialog medium/ }).click();
	await page.getByRole("button", { name: "Buttons", exact: true }).click();
	await page.getByRole("option", { name: "Cancel / Confirm", exact: true }).click();
	await page.getByRole("textbox", { name: "Title", exact: true }).fill("Confirm changes");
	await page.getByRole("textbox", { name: "Message", exact: true }).fill("Apply the configured changes?");

	const manualNode = page.locator(".react-flow__node").filter({ hasText: "Manual Trigger" });
	const messageNode = page.locator(".react-flow__node").filter({ hasText: "Message Dialog" });
	await manualNode.locator(".react-flow__handle.source").first().dispatchEvent("click", { bubbles: true });
	await messageNode.locator(".react-flow__handle.target").first().dispatchEvent("click", { bubbles: true });

	await page.getByRole("button", { name: "Simulator" }).click();
	await page.getByRole("button", { name: "Trigger", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Confirm changes" });
	await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
	await expect(dialog.getByRole("button", { name: "Confirm", exact: true })).toBeVisible();
	await expect(dialog.getByRole("button", { name: "OK", exact: true })).toHaveCount(0);
	await expect(dialog.getByRole("button", { name: "Yes", exact: true })).toHaveCount(0);
	await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
	await expect(dialog).toHaveCount(0);
	const simulationTab = page.getByRole("button", { name: "Simulation", exact: true });
	await simulationTab.click();
	await expect(
		simulationTab.locator("xpath=ancestor::section").getByText(/Message Dialog .* returned "confirm"\./),
	).toBeVisible();
});

test("Form Dialog form builder shows only controls relevant to each component type", async ({ page }) => {
	await openEditor(page);

	await page.getByRole("button", { name: "Manual" }).click();
	await page.getByRole("button", { name: "Dialogs" }).click();
	await page.getByRole("button", { name: /^Form Dialog medium/ }).click();
	await page.getByRole("textbox", { name: "Window title" }).fill("Enter a value");
	await page.getByRole("button", { name: "Edit form" }).click();
	const formBuilder = page.getByRole("dialog", { name: "Edit form dialog" });
	await expect(formBuilder.getByText("0/50", { exact: true })).toBeVisible();
	await expect(formBuilder.getByRole("button", { name: /Component 1 type/ })).toHaveCount(0);
	await addFormDialogComponent(page, formBuilder, "Password input");
	await expect(formBuilder.getByRole("button", { name: "Component 1 type" })).toHaveCount(0);
	const passwordOutlineItem = formBuilder.getByRole("button", { name: /Edit component 1/ });
	await expect(passwordOutlineItem.locator("[data-form-component-type]")).toHaveText("Password input");
	await expect(
		formBuilder.getByRole("region", { name: "Selected component settings" }).locator("[data-form-component-type]"),
	).toHaveText("Password input");
	await expect(formBuilder.getByRole("textbox", { name: "Placeholder" })).toBeVisible();
	await expect(formBuilder.getByRole("textbox", { name: "Default value" })).toHaveCount(0);
	await formBuilder.getByRole("textbox", { name: "Output key" }).fill("Secret key_42-");
	await expect(formBuilder.getByRole("textbox", { name: "Output key" })).toHaveValue("Secret key_42-");
	await expect(
		formBuilder.getByText("Key may contain only letters A-Z, a-z, numbers 0-9, hyphens, and underscores.", {
			exact: true,
		}),
	).toBeVisible();
	await formBuilder.getByRole("textbox", { name: "Output key" }).fill("Secret_key-42");
	await formBuilder.getByRole("button", { name: "Remove component 1", exact: true }).click();
	await addFormDialogComponent(page, formBuilder, "Single choice");
	await formBuilder.getByRole("textbox", { name: "Key", exact: true }).fill("Choice key_1-");
	await expect(formBuilder.getByRole("textbox", { name: "Key", exact: true })).toHaveValue("Choice key_1-");
	await expect(
		formBuilder.getByText("Key may contain only letters A-Z, a-z, numbers 0-9, hyphens, and underscores.", {
			exact: true,
		}),
	).toBeVisible();
	await formBuilder.getByRole("textbox", { name: "Key", exact: true }).fill("Choice_key-1");
	await formBuilder.getByRole("button", { name: "Remove component 1", exact: true }).click();
	await addFormDialogComponent(page, formBuilder, "Information");
	await expect(formBuilder.getByRole("textbox", { name: "Output key" })).toHaveCount(0);
	await expect(formBuilder.getByRole("switch", { name: "Required" })).toHaveCount(0);
	await expect(formBuilder.getByRole("textbox", { name: "Accent color" })).toHaveValue("#5B8AF5");
	await formBuilder.getByRole("button", { name: "Remove component 1", exact: true }).click();
	await addFormDialogComponent(page, formBuilder, "Text input");
	await formBuilder.getByRole("textbox", { name: "Output key" }).fill("answer");
	await formBuilder.getByRole("textbox", { name: "Label", exact: true }).fill("Value");
	await formBuilder.getByRole("button", { name: "Apply" }).click();

	const manualNode = page.locator(".react-flow__node").filter({ hasText: "Manual Trigger" });
	const promptNode = page.locator(".react-flow__node").filter({ hasText: "Form Dialog" });
	await manualNode.locator(".react-flow__handle.source").first().dispatchEvent("click", { bubbles: true });
	await promptNode.locator(".react-flow__handle.target").first().dispatchEvent("click", { bubbles: true });

	await page.getByRole("button", { name: "Simulator" }).click();
	await page.getByRole("button", { name: "Trigger", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Enter a value" });
	await expect(dialog).toBeVisible();
	await dialog.getByRole("textbox", { name: "Value" }).fill("submitted text");
	await dialog.getByRole("button", { name: "Submit", exact: true }).click();
	await expect(dialog).toHaveCount(0);
});

test("Form Dialog temporal defaults use native pickers with an explicit variable mode", async ({ page }) => {
	await openEditor(page);
	await openProjectSettingsTab(page, "Script Settings");
	await page.getByRole("button", { name: "Add setting" }).click();
	const settingDialog = page.getByRole("dialog");
	await settingDialog.getByRole("textbox", { name: "Name" }).fill("testvar");
	await settingDialog.locator('[data-slot="select-trigger"]').first().click();
	await page.getByRole("option", { name: "datetime", exact: true }).click();
	await settingDialog.getByRole("switch", { name: "Use Simulation override" }).click();
	await settingDialog.getByRole("combobox", { name: "Datetime timezone" }).click();
	await page.getByRole("option", { name: "UTC", exact: true }).click();
	await settingDialog
		.locator('input[type="datetime-local"][aria-label="Simulation override"]')
		.fill("2026-08-03T12:30:15");
	await settingDialog.getByRole("button", { name: "Save", exact: true }).click();
	await page.getByRole("button", { name: "Save Settings" }).click();

	await page.getByRole("button", { name: "Manual" }).click();
	await page.getByRole("button", { name: "Dialogs" }).click();
	await page.getByRole("button", { name: /^Form Dialog medium/ }).click();
	await page.getByRole("textbox", { name: "Window title" }).fill("Datetime variable");
	await page.getByRole("button", { name: "Edit form" }).click();
	const formBuilder = page.getByRole("dialog", { name: "Edit form dialog" });

	await addFormDialogComponent(page, formBuilder, "Date");
	await formBuilder.getByRole("textbox", { name: "Label", exact: true }).fill("Run date");
	const datePicker = formBuilder.locator('input[type="date"][aria-label="Default value"]');
	await expect(datePicker).toBeVisible();
	await datePicker.fill("2026-08-03");
	await expect(datePicker).toHaveValue("2026-08-03");
	await formBuilder.getByRole("button", { name: "Variable", exact: true }).click();
	const variableInput = formBuilder.getByRole("textbox", { name: "Default value" });
	await variableInput.fill("{{system_dat");
	await expect(page.locator('[data-variable-suggestion="system_date"]')).toHaveCount(0);
	await variableInput.fill("{{system_date}}");
	await expect(
		formBuilder.locator('[data-variable-token="system_date"][data-variable-status="type-mismatch"]'),
	).toBeVisible();
	await expect(
		formBuilder.getByRole("alert").filter({ hasText: /system_date.*type string.*accepts datetime variables/i }),
	).toBeVisible();
	await variableInput.fill("{{settings.testv");
	const suggestions = page.getByRole("listbox", { name: "Default value suggestions" });
	await expect(suggestions.locator('[data-variable-suggestion="settings.testvar"]')).toBeVisible();
	await suggestions.locator('[data-variable-suggestion="settings.testvar"]').click();
	await expect(variableInput).toHaveValue("{{settings.testvar}}");
	await formBuilder.getByRole("button", { name: "Picker", exact: true }).click();
	await expect(datePicker).toHaveValue("");

	await addFormDialogComponent(page, formBuilder, "Time");
	await formBuilder.getByRole("textbox", { name: "Label", exact: true }).fill("Run time");
	const timePicker = formBuilder.locator('input[type="time"][aria-label="Default value"]');
	await expect(timePicker).toBeVisible();
	await timePicker.fill("14:30:15");
	await expect(timePicker).toHaveValue("14:30:15");

	await addFormDialogComponent(page, formBuilder, "Date and time");
	await formBuilder.getByRole("textbox", { name: "Label", exact: true }).fill("Run at");
	const datetimePicker = formBuilder.locator('input[type="datetime-local"][aria-label="Default value"]');
	await expect(datetimePicker).toBeVisible();
	await datetimePicker.fill("2026-08-03T14:30:15");
	await expect(datetimePicker).toHaveValue("2026-08-03T14:30:15");
	await expect(formBuilder.getByText("Timezone", { exact: true })).toBeVisible();
	await formBuilder.getByRole("button", { name: "Date and time timezone" }).click();
	await page.getByRole("option", { name: "UTC", exact: true }).click();
	await formBuilder.getByRole("button", { name: "Variable", exact: true }).click();
	const datetimeVariableInput = formBuilder.getByRole("textbox", { name: "Default value" });
	await datetimeVariableInput.fill("{{settings.testv");
	const datetimeSuggestions = page.getByRole("listbox", { name: "Default value suggestions" });
	await expect(datetimeSuggestions.locator('[data-variable-suggestion="settings.testvar"]')).toBeVisible();
	await datetimeSuggestions.locator('[data-variable-suggestion="settings.testvar"]').click();
	await expect(datetimeVariableInput).toHaveValue("{{settings.testvar}}");
	await expect(formBuilder.getByText(/accepts text or datetime variables/i)).toHaveCount(0);
	await formBuilder.getByRole("button", { name: "Apply" }).click();

	const manualNode = page.locator(".react-flow__node").filter({ hasText: "Manual Trigger" });
	const dialogNode = page.locator(".react-flow__node").filter({ hasText: "Form Dialog" });
	await manualNode.locator(".react-flow__handle.source").first().dispatchEvent("click", { bubbles: true });
	await dialogNode.locator(".react-flow__handle.target").first().dispatchEvent("click", { bubbles: true });
	await page.getByRole("button", { name: "Simulator" }).click();
	await page.getByRole("button", { name: "Trigger", exact: true }).click();
	const simulationDialog = page.getByRole("dialog", { name: "Datetime variable" });
	await expect(simulationDialog.locator('input[type="datetime-local"]')).toHaveValue("2026-08-03T12:30:15");
});

test("Form Dialog information components render a configurable high-contrast accent panel", async ({ page }) => {
	await openEditor(page);
	await openProjectSettingsTab(page, "Script Settings");
	await addTextScriptSetting(page, "NotAColor", "plain text");
	await page.getByRole("button", { name: "Add setting" }).click();
	const settingDialog = page.getByRole("dialog");
	await settingDialog.getByRole("textbox", { name: "Name" }).fill("InformationAccent");
	await settingDialog.locator('[data-slot="select-trigger"]').first().click();
	await page.getByRole("option", { name: "color", exact: true }).click();
	await settingDialog.getByRole("switch", { name: "Use Simulation override" }).click();
	await settingDialog.getByRole("textbox", { name: "Simulation override" }).fill("#12AB34");
	await settingDialog.getByRole("button", { name: "Save", exact: true }).click();
	await page.getByRole("button", { name: "Save Settings" }).click();

	await page.getByRole("button", { name: "Manual" }).click();
	await page.getByRole("button", { name: "Dialogs" }).click();
	await page.getByRole("button", { name: /^Form Dialog medium/ }).click();
	await page.getByRole("textbox", { name: "Window title" }).fill("Information preview");
	await page.getByRole("button", { name: "Edit form" }).click();
	const formBuilder = page.getByRole("dialog", { name: "Edit form dialog" });
	await addFormDialogComponent(page, formBuilder, "Information");
	await formBuilder.getByRole("textbox", { name: "Heading" }).fill("Deployment notice");
	await formBuilder.getByRole("textbox", { name: "Content" }).fill("Review this information before continuing.");
	const accentColor = formBuilder.getByRole("textbox", { name: "Accent color" });
	await accentColor.fill("invalid");
	await expect(formBuilder.getByRole("alert").filter({ hasText: /accent color must be #RRGGBB/i })).toBeVisible();
	await expect(formBuilder.getByRole("button", { name: "1 issue must be resolved" })).toBeVisible();
	await accentColor.fill("{{settings.InformationAcc");
	const suggestions = page.getByRole("listbox", { name: "Accent color suggestions" });
	await expect(suggestions.locator('[data-variable-suggestion="settings.NotAColor"]')).toHaveCount(0);
	await suggestions.getByRole("option", { name: /\{\{settings\.InformationAccent\}\}/ }).click();
	await expect(accentColor).toHaveValue("{{settings.InformationAccent}}");
	await expect(formBuilder.getByRole("button", { name: "Open accent color color picker" })).toHaveCSS(
		"background-color",
		"rgb(18, 171, 52)",
	);
	await expect(formBuilder.getByRole("alert").filter({ hasText: /accent color must be #RRGGBB/i })).toHaveCount(0);
	await formBuilder.getByRole("button", { name: "Apply" }).click();

	const manualNode = page.locator(".react-flow__node").filter({ hasText: "Manual Trigger" });
	const dialogNode = page.locator(".react-flow__node").filter({ hasText: "Form Dialog" });
	await manualNode.locator(".react-flow__handle.source").first().dispatchEvent("click", { bubbles: true });
	await dialogNode.locator(".react-flow__handle.target").first().dispatchEvent("click", { bubbles: true });
	await page.getByRole("button", { name: "Simulator" }).click();
	await page.getByRole("button", { name: "Trigger", exact: true }).click();

	const dialog = page.getByRole("dialog", { name: "Information preview" });
	const information = dialog.locator("[data-form-dialog-information]");
	await expect(information).toContainText("Deployment notice");
	await expect(information).toHaveCSS("border-left-color", "rgb(18, 171, 52)");
	const surface = await information.evaluate((element) => {
		const style = getComputedStyle(element);
		return { backgroundColor: style.backgroundColor, borderTopWidth: style.borderTopWidth };
	});
	expect(surface.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
	expect(surface.borderTopWidth).toBe("1px");
	await dialog.getByRole("button", { name: "Submit", exact: true }).click();
});

test("Form Dialog choices validate duplicate keys and publish nested values in configured order", async ({ page }) => {
	await openEditor(page);

	await page.getByRole("button", { name: "Manual" }).click();
	await page.getByRole("textbox", { name: "Search blocks" }).fill("Form Dialog");
	await page.getByRole("button", { name: /^Form Dialog medium/ }).click();
	await page.getByRole("textbox", { name: "Window title" }).fill("Choose targets");
	await page.getByRole("button", { name: "Edit form" }).click();
	const formBuilder = page.getByRole("dialog", { name: "Edit form dialog" });
	await addFormDialogComponent(page, formBuilder, "Multi choice");
	await formBuilder.getByRole("textbox", { name: "Output key" }).fill("targets");
	await formBuilder.getByRole("textbox", { name: "Label", exact: true }).fill("Targets");
	await formBuilder.getByRole("textbox", { name: "Key", exact: true }).fill("first-key");
	await formBuilder.getByRole("textbox", { name: "Displayed value", exact: true }).fill("First displayed value");
	await formBuilder.getByRole("button", { name: "Add choice" }).click();
	const secondKey = formBuilder.getByRole("textbox", { name: "Key", exact: true }).nth(1);
	await secondKey.fill("first-key");
	await expect(secondKey).toHaveAttribute("aria-invalid", "true");
	await expect(formBuilder.getByText("Key must be unique.", { exact: true })).toHaveCount(2);
	await secondKey.fill("second-key");
	await expect(secondKey).not.toHaveAttribute("aria-invalid", "true");
	await expect(formBuilder.getByText("Key must be unique.", { exact: true })).toHaveCount(0);
	await formBuilder
		.getByRole("textbox", { name: "Displayed value", exact: true })
		.nth(1)
		.fill("Second displayed value");
	await formBuilder.getByRole("button", { name: "Apply" }).click();

	const manualNode = page.locator(".react-flow__node").filter({ hasText: "Manual Trigger" });
	const promptNode = page.locator(".react-flow__node").filter({ hasText: "Form Dialog" });
	await manualNode.locator(".react-flow__handle.source").first().dispatchEvent("click", { bubbles: true });
	await promptNode.locator(".react-flow__handle.target").first().dispatchEvent("click", { bubbles: true });

	await page.getByRole("button", { name: "Simulator" }).click();
	await page.getByRole("button", { name: "Trigger", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Choose targets" });
	await expect(dialog.getByText("first-key", { exact: true })).toHaveCount(0);
	await expect(dialog.getByText("second-key", { exact: true })).toHaveCount(0);
	await dialog.getByText("Second displayed value", { exact: true }).click();
	await dialog.getByText("First displayed value", { exact: true }).click();
	await dialog.getByRole("button", { name: "Submit", exact: true }).click();

	await page.getByRole("button", { name: "Variables", exact: true }).click();
	const selectedChoices = page.locator('[data-variable-name$=".values.targets"] pre');
	await expect(selectedChoices).toContainText("first-key");
	await expect(selectedChoices).toContainText("second-key");
	await expect(selectedChoices).not.toContainText("displayed value");
});

test("Form Dialog expanded controls publish typed simulator values", async ({ page }) => {
	await openEditor(page);
	await page.getByRole("button", { name: "Manual" }).click();
	await page.getByRole("button", { name: "Dialogs" }).click();
	await page.getByRole("button", { name: /^Form Dialog medium/ }).click();
	await page.getByRole("textbox", { name: "Window title" }).fill("Expanded form");
	await page.getByRole("button", { name: "Edit form" }).click();
	const formBuilder = page.getByRole("dialog", { name: "Edit form dialog" });

	await addFormDialogComponent(page, formBuilder, "Dropdown");
	await formBuilder.getByRole("textbox", { name: "Output key" }).fill("environment");
	await formBuilder.getByRole("textbox", { name: "Label", exact: true }).fill("Environment");
	await formBuilder.getByRole("textbox", { name: "Key", exact: true }).fill("production");
	await formBuilder.getByRole("textbox", { name: "Displayed value", exact: true }).fill("Production");

	await addFormDialogComponent(page, formBuilder, "Slider");
	await formBuilder.getByRole("textbox", { name: "Output key" }).fill("level");
	await formBuilder.getByRole("textbox", { name: "Label", exact: true }).fill("Level");
	await formBuilder.getByRole("textbox", { name: "Component 2 slider minimum" }).fill("0");
	await formBuilder.getByRole("textbox", { name: "Component 2 slider maximum" }).fill("100");
	await formBuilder.getByRole("textbox", { name: "Component 2 slider step" }).fill("5");
	await formBuilder.getByRole("textbox", { name: "Component 2 slider default value" }).fill("50");

	await addFormDialogComponent(page, formBuilder, "Date");
	await formBuilder.getByRole("textbox", { name: "Output key" }).fill("runDate");
	await formBuilder.getByRole("textbox", { name: "Label", exact: true }).fill("Run date");
	await formBuilder.getByRole("textbox", { name: "Default value" }).fill("2026-08-03");

	await addFormDialogComponent(page, formBuilder, "Color picker");
	await formBuilder.getByRole("textbox", { name: "Output key" }).fill("theme");
	await formBuilder.getByRole("textbox", { name: "Label", exact: true }).fill("Theme");
	await formBuilder.getByRole("textbox", { name: "Default color" }).fill("#12AB34");

	await addFormDialogComponent(page, formBuilder, "Section heading");
	await formBuilder.getByRole("textbox", { name: "Heading" }).fill("Advanced values");
	await formBuilder.getByRole("button", { name: "Apply" }).click();

	const manualNode = page.locator(".react-flow__node").filter({ hasText: "Manual Trigger" });
	const dialogNode = page.locator(".react-flow__node").filter({ hasText: "Form Dialog" });
	await manualNode.locator(".react-flow__handle.source").first().dispatchEvent("click", { bubbles: true });
	await dialogNode.locator(".react-flow__handle.target").first().dispatchEvent("click", { bubbles: true });
	await page.getByRole("button", { name: "Simulator" }).click();
	await page.getByRole("button", { name: "Trigger", exact: true }).click();

	const dialog = page.getByRole("dialog", { name: "Expanded form" });
	await expect(dialog).toHaveAttribute("data-simulation-form-dialog-shell", "true");
	await expect(dialog.getByText("BaudBound", { exact: true })).toBeVisible();
	await expect(dialog.getByText("Requested by editor simulator", { exact: true })).toBeVisible();
	await expect(dialog.locator("[data-simulation-form-dialog-content]")).toBeVisible();
	await expect(dialog.locator("[data-simulation-form-dialog-footer]")).toBeVisible();
	await page.setViewportSize({ width: 480, height: 700 });
	await expect.poll(async () => (await dialog.boundingBox())?.width).toBeLessThanOrEqual(448);
	expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
	await dialog.getByRole("combobox", { name: "Environment" }).click();
	await page.getByRole("option", { name: "Production", exact: true }).click();
	await dialog.getByRole("slider", { name: "Level" }).fill("75");
	await dialog.getByLabel("Run date").fill("2026-08-04");
	await dialog.getByRole("textbox", { name: "Theme", exact: true }).fill("#ABCDEF");
	await expect(dialog.getByRole("heading", { name: "Advanced values" })).toBeVisible();
	await dialog.getByRole("button", { name: "Submit", exact: true }).click();

	await page.getByRole("button", { name: "Variables", exact: true }).click();
	await expect(page.locator('[data-variable-name$=".values.environment"] pre')).toHaveText("production");
	await expect(page.locator('[data-variable-name$=".values.level"] pre')).toHaveText("75");
	await expect(page.locator('[data-variable-name$=".values.runDate"] pre')).toHaveText("2026-08-04");
	await expect(page.locator('[data-variable-name$=".values.theme"] pre')).toHaveText("#ABCDEF");
});

test("Form Dialog display values suggest compatible variables while keys remain literal", async ({ page }) => {
	await openEditor(page);

	await openProjectSettingsTab(page, "Script Settings");
	await addTextScriptSetting(page, "ChoiceLabel", "Production environment");
	await page.getByRole("button", { name: "Save Settings" }).click();

	await page.getByRole("button", { name: "Manual" }).click();
	await page.getByRole("button", { name: "Dialogs" }).click();
	await page.getByRole("button", { name: /^Form Dialog medium/ }).click();
	await page.getByRole("textbox", { name: "Window title" }).fill("Variable choice");
	await page.getByRole("button", { name: "Edit form" }).click();
	const formBuilder = page.getByRole("dialog", { name: "Edit form dialog" });
	await addFormDialogComponent(page, formBuilder, "Single choice");
	await formBuilder.getByRole("textbox", { name: "Output key" }).fill("target");
	await formBuilder.getByRole("textbox", { name: "Label", exact: true }).fill("Target");

	const choiceKey = formBuilder.getByRole("textbox", { name: "Key", exact: true });
	await choiceKey.fill("{{settings.ChoiceKey}}");
	await expect(page.getByRole("listbox", { name: "Key suggestions" })).toHaveCount(0);
	await expect(
		formBuilder.getByText("Key may contain only letters A-Z, a-z, numbers 0-9, hyphens, and underscores.", {
			exact: true,
		}),
	).toBeVisible();
	await choiceKey.fill("production");

	const choiceLabel = formBuilder.getByRole("textbox", { name: "Displayed value", exact: true });
	await choiceLabel.fill("{{settings.ChoiceL");
	await page
		.getByRole("listbox", { name: "Displayed value suggestions" })
		.getByRole("option", { name: /\{\{settings\.ChoiceLabel\}\}/ })
		.click();
	await expect(choiceLabel).toHaveValue("{{settings.ChoiceLabel}}");
	await formBuilder.getByRole("button", { name: "Apply" }).click();

	const manualNode = page.locator(".react-flow__node").filter({ hasText: "Manual Trigger" });
	const promptNode = page.locator(".react-flow__node").filter({ hasText: "Form Dialog" });
	await manualNode.locator(".react-flow__handle.source").first().dispatchEvent("click", { bubbles: true });
	await promptNode.locator(".react-flow__handle.target").first().dispatchEvent("click", { bubbles: true });

	await page.getByRole("button", { name: "Simulator" }).click();
	await page.getByRole("button", { name: "Trigger", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Variable choice" });
	await expect(dialog.getByText("Production environment", { exact: true })).toBeVisible();
	await expect(dialog.getByText("production", { exact: true })).toHaveCount(0);
	await dialog.getByText("Production environment", { exact: true }).click();
	await dialog.getByRole("button", { name: "Submit", exact: true }).click();

	await page.getByRole("button", { name: "Variables", exact: true }).click();
	await expect(page.locator('[data-variable-name$=".values.target"] pre')).toHaveText("production");
});

test("Form Dialog form builder applies drafts atomically and discards cancelled edits", async ({ page }) => {
	await openEditor(page);

	await page.getByRole("button", { name: "Dialogs" }).click();
	await page.getByRole("button", { name: /^Form Dialog medium/ }).click();
	await page.getByRole("button", { name: "Edit form" }).click();
	let formBuilder = page.getByRole("dialog", { name: "Edit form dialog" });
	await expect(formBuilder.getByText("0/50", { exact: true })).toBeVisible();
	await addFormDialogComponent(page, formBuilder);
	await formBuilder.getByRole("textbox", { name: "Output key" }).fill("cancelledKey");
	await formBuilder.getByRole("textbox", { name: "Label", exact: true }).fill("Cancelled label");
	await formBuilder.getByRole("button", { name: "Duplicate component 1" }).click();
	await expect(formBuilder.getByRole("textbox", { name: "Output key" })).toHaveValue("cancelledKey2");
	await formBuilder.getByRole("button", { name: "Cancel", exact: true }).click();

	await page.getByRole("button", { name: "Edit form" }).click();
	formBuilder = page.getByRole("dialog", { name: "Edit form dialog" });
	await expect(formBuilder.getByText("0/50", { exact: true })).toBeVisible();
	await expect(formBuilder.getByRole("textbox", { name: "Output key" })).toHaveCount(0);
	await addFormDialogComponent(page, formBuilder);
	await formBuilder.getByRole("textbox", { name: "Output key" }).fill("savedKey");
	await formBuilder.getByRole("textbox", { name: "Label", exact: true }).fill("Saved label");
	await formBuilder.getByRole("button", { name: "Apply" }).click();

	await page.getByRole("button", { name: "Edit form" }).click();
	formBuilder = page.getByRole("dialog", { name: "Edit form dialog" });
	await expect(formBuilder.getByRole("textbox", { name: "Output key" })).toHaveValue("savedKey");
	await expect(formBuilder.getByRole("textbox", { name: "Label", exact: true })).toHaveValue("Saved label");
});

test("Form Dialog form builder keeps component navigation usable on narrow screens", async ({ page }) => {
	await openEditor(page);

	await page.getByRole("button", { name: "Dialogs" }).click();
	await page.getByRole("button", { name: /^Form Dialog medium/ }).click();
	await page.getByRole("button", { name: "Edit form" }).click();
	await page.setViewportSize({ width: 390, height: 760 });

	const formBuilder = page.getByRole("dialog", { name: "Edit form dialog" });
	await expect(formBuilder.getByRole("tab", { name: "Components" })).toHaveAttribute("aria-selected", "true");
	await formBuilder.getByRole("button", { name: "Add form component" }).click();
	const addComponentMenu = formBuilder.getByRole("listbox");
	await expect(addComponentMenu).toBeVisible();
	const dialogBox = await formBuilder.boundingBox();
	const menuBox = await addComponentMenu.boundingBox();
	expect(dialogBox).not.toBeNull();
	expect(menuBox).not.toBeNull();
	expect(menuBox?.y).toBeGreaterThanOrEqual(dialogBox?.y ?? 0);
	expect((menuBox?.y ?? 0) + (menuBox?.height ?? 0)).toBeLessThanOrEqual(
		(dialogBox?.y ?? 0) + (dialogBox?.height ?? 0),
	);
	await page.getByRole("option", { name: "Text input", exact: true }).click();
	await expect(formBuilder.getByRole("tab", { name: "Settings" })).toHaveAttribute("aria-selected", "true");
	await formBuilder.getByRole("tab", { name: "Components" }).click();
	await formBuilder.getByRole("button", { name: /^Edit component 1:/ }).click();
	await expect(formBuilder.getByRole("tab", { name: "Settings" })).toHaveAttribute("aria-selected", "true");
	await expect(formBuilder.getByRole("button", { name: "Component 1 type" })).toHaveCount(0);

	const layout = await formBuilder.evaluate((element) => ({
		bottom: element.getBoundingClientRect().bottom,
		clientWidth: element.clientWidth,
		left: element.getBoundingClientRect().left,
		right: element.getBoundingClientRect().right,
		scrollWidth: element.scrollWidth,
		top: element.getBoundingClientRect().top,
	}));
	expect(layout.left).toBeGreaterThanOrEqual(0);
	expect(layout.top).toBeGreaterThanOrEqual(0);
	expect(layout.right).toBeLessThanOrEqual(390);
	expect(layout.bottom).toBeLessThanOrEqual(760);
	expect(layout.scrollWidth).toBe(layout.clientWidth);
});

test("Form Dialog component drag preview remains attached to the pointer", async ({ page }) => {
	await openEditor(page);

	await page.getByRole("button", { name: "Dialogs" }).click();
	await page.getByRole("button", { name: /^Form Dialog medium/ }).click();
	await page.getByRole("button", { name: "Edit form" }).click();

	const formBuilder = page.getByRole("dialog", { name: "Edit form dialog" });
	await addFormDialogComponent(page, formBuilder);
	const dragHandle = formBuilder.getByRole("button", { name: "Reorder component 1" });
	const componentRow = formBuilder.getByRole("button", { name: /^Edit component 1:/ }).locator("..");
	const handleBox = await dragHandle.boundingBox();
	const rowBox = await componentRow.boundingBox();
	expect(handleBox).not.toBeNull();
	expect(rowBox).not.toBeNull();

	const startX = (handleBox?.x ?? 0) + (handleBox?.width ?? 0) / 2;
	const startY = (handleBox?.y ?? 0) + (handleBox?.height ?? 0) / 2;
	const deltaX = 420;
	const deltaY = 80;
	await page.mouse.move(startX, startY);
	await page.mouse.down();
	await page.mouse.move(startX + deltaX, startY + deltaY, { steps: 3 });

	const dragOverlay = page.locator("[data-reorder-drag-overlay]");
	await expect(dragOverlay).toBeVisible();
	const overlayBox = await dragOverlay.boundingBox();
	expect(overlayBox).not.toBeNull();
	expect(overlayBox?.x).toBeCloseTo((rowBox?.x ?? 0) + deltaX, 0);
	expect(overlayBox?.y).toBeCloseTo((rowBox?.y ?? 0) + deltaY, 0);
	await page.mouse.up();
	await expect(dragOverlay).toHaveCount(0);
});

test("inspector fields show accessible inline validation and clear it after correction", async ({ page }) => {
	await openEditor(page);

	const blockSearch = page.getByRole("textbox", { name: "Search blocks" });
	await blockSearch.fill("Log");
	await page.getByRole("button", { name: /^Log low/ }).click();

	const message = page.getByRole("textbox", { name: "Message" });
	await expect(message).toHaveAttribute("aria-invalid", "true");
	const messageErrorId = await message.getAttribute("aria-describedby");
	expect(messageErrorId).toBeTruthy();
	await expect(page.locator(`[id="${messageErrorId}"]`)).toHaveText("Message is required.");

	await message.fill("Ready");
	await expect(message).not.toHaveAttribute("aria-invalid", "true");
	await expect(page.locator(`[id="${messageErrorId}"]`)).toHaveCount(0);

	await blockSearch.fill("Calculate");
	await page.getByRole("button", { name: /^Calculate low/ }).click();
	const expression = page.getByRole("textbox", { name: "Expression" });
	await expression.fill("not_a_formula");
	await expect(expression).toHaveAttribute("aria-invalid", "true");
	await expect(page.getByText('Function "not_a_formula" must be called with parentheses.')).toBeVisible();

	await expression.fill("round(1.5)");
	await expect(expression).not.toHaveAttribute("aria-invalid", "true");
	await expect(page.getByText('Function "not_a_formula" must be called with parentheses.')).toHaveCount(0);

	await blockSearch.fill("Switch");
	await page.getByRole("button", { name: /^Switch low/ }).click();
	const switchValue = page.getByRole("textbox", { name: "Switch value" });
	await expect(switchValue).toHaveAttribute("aria-invalid", "true");
	await expect(page.getByText("Switch value is required.")).toBeVisible();
	await switchValue.fill("{{broken");
	await expect(page.getByText("Variable reference syntax is incomplete.")).toBeVisible();
	await switchValue.fill("ready");

	const switchCases = page.getByRole("list", { name: "Switch cases" });
	const firstCase = switchCases.getByRole("listitem").first();
	await expect(firstCase.getByText("Name is required.")).toBeVisible();
	await expect(firstCase.getByText("Value is required.")).toBeVisible();
	await firstCase.getByRole("textbox", { name: "Name" }).fill("Primary");
	await firstCase.getByRole("textbox", { name: "Value" }).fill("yes");
	await page.getByRole("button", { name: "Add switch case" }).click();
	const secondCase = switchCases.getByRole("listitem").nth(1);
	await secondCase.getByRole("textbox", { name: "Name" }).fill("primary");
	await secondCase.getByRole("textbox", { name: "Value" }).fill("yes");
	await expect(secondCase.getByText("Name must be unique.")).toBeVisible();
	await expect(secondCase.getByText("Value must be unique.")).toBeVisible();
	await secondCase.getByRole("textbox", { name: "Name" }).fill("Secondary");
	await secondCase.getByRole("textbox", { name: "Value" }).fill("no");
	await expect(secondCase.getByText("Name must be unique.")).toHaveCount(0);
	await expect(secondCase.getByText("Value must be unique.")).toHaveCount(0);
});

test("Shell Command accepts literal PowerShell script-block braces", async ({ page }) => {
	await openEditor(page);

	const command =
		'powershell -NoProfile -Command "$r=Test-Connection 1.1.1.1 -Count 1 -ErrorAction SilentlyContinue; if($r){if($null-ne $r.Latency){$r.Latency}else{$r.ResponseTime}}"';
	await page.getByRole("textbox", { name: "Search blocks" }).fill("Shell Command");
	await page.getByRole("button", { name: /^Shell Command dangerous/ }).click();

	const commandInput = page.getByRole("textbox", { name: "Command" });
	await commandInput.fill(command);

	await expect(commandInput).toHaveValue(command);
	await expect(commandInput).not.toHaveAttribute("aria-invalid", "true");
	await expect(page.getByText("Variable reference syntax is incomplete.")).toHaveCount(0);
});

test("WebSocket nodes normalize paths and select a trigger connection", async ({ page }) => {
	await openEditor(page);

	const blockSearch = page.getByRole("textbox", { name: "Search blocks" });
	await blockSearch.fill("WebSocket");
	await page.getByRole("button", { name: /^WebSocket high/ }).click();
	await page.getByRole("textbox", { name: "Custom name" }).fill("Inbound messages");
	const path = page.getByRole("textbox", { name: "Path" });
	await path.fill("events/messages");
	await expect(path).toHaveValue("events/messages");
	await expect(path).not.toHaveAttribute("aria-invalid", "true");

	await page.getByRole("button", { name: /^WebSocket Write medium/ }).click();
	await expect(page.getByRole("textbox", { name: "Connection id" })).toHaveCount(0);
	const connection = page.getByRole("button", { name: "Connection" });
	await connection.click();
	await page.getByRole("option", { name: "Inbound messages (/events/messages)" }).click();
	await expect(connection).toContainText("Inbound messages (/events/messages)");
	await page.getByRole("textbox", { name: "Message" }).fill("reply");

	const triggerNode = page.locator(".react-flow__node").filter({ hasText: "Inbound messages" });
	const writeNode = page.locator(".react-flow__node").filter({ hasText: "WebSocket Write" });
	await triggerNode.locator(".react-flow__handle.source").first().dispatchEvent("click", { bubbles: true });
	await writeNode.locator(".react-flow__handle.target").first().dispatchEvent("click", { bubbles: true });

	await page.getByRole("button", { name: "Simulator" }).click();
	await page.getByRole("button", { name: "Trigger", exact: true }).click();
	await page.getByRole("button", { name: "Simulation", exact: true }).click();
	await expect(page.getByText(/sent 5 bytes to connection simulated-connection/)).toBeVisible();
});

test("node finder searches configuration and focuses the selected node", async ({ page }) => {
	await openEditor(page);

	const blockSearch = page.getByRole("textbox", { name: "Search blocks" });
	await blockSearch.fill("Log");
	await page.getByRole("button", { name: /^Log low/ }).click();
	await page.getByRole("textbox", { name: "Custom name" }).fill("Inventory logger");
	await page.getByRole("textbox", { name: "Message" }).fill("Status: {{inventory_status}}");

	await blockSearch.fill("Delay");
	await page.getByRole("button", { name: /^Delay low/ }).click();
	await expect(page.getByRole("textbox", { name: "Custom name" })).toHaveValue("");

	await page.keyboard.press("Control+f");
	const finder = page.getByRole("dialog");
	await expect(finder.getByRole("heading", { name: "Find a node" })).toBeVisible();
	const finderSearch = finder.getByRole("combobox", { name: "Search project nodes" });
	await finderSearch.fill("inventory_status");
	await expect(finder.getByRole("option", { name: /Inventory logger/ })).toHaveCount(1);
	await finderSearch.press("Enter");

	await expect(finder).toBeHidden();
	await expect(page.getByRole("textbox", { name: "Custom name" })).toHaveValue("Inventory logger");
	await expect(page.locator(".react-flow__node.baud-node-found").filter({ hasText: "Inventory logger" })).toHaveCount(
		1,
	);
});

test("Schedule triggers can start and stop their simulator timer", async ({ page }) => {
	await openEditor(page);

	await openProjectSettingsTab(page, "Default Variables");
	await page.getByRole("button", { name: "Add variable" }).click();
	const variableDialog = page.getByRole("dialog");
	await variableDialog.getByRole("textbox", { name: "Name" }).fill("interval");
	await variableDialog.getByRole("combobox", { name: "Type" }).click();
	await page.getByRole("option", { name: "float" }).click();
	await variableDialog.getByRole("spinbutton", { name: "Default value" }).fill("25");
	await variableDialog.getByRole("button", { name: "Save" }).click();
	await page.getByRole("button", { name: "Save Settings" }).click();

	await page.getByRole("button", { name: "Schedule" }).click();
	const intervalField = page.getByRole("textbox", { name: "Every", exact: true });
	await intervalField.fill("{{int");
	const suggestions = page.getByRole("listbox", { name: "Every suggestions" });
	const intervalSuggestion = suggestions.locator('[data-variable-suggestion="interval"]');
	await expect(suggestions).toBeVisible();
	await expect(intervalSuggestion).toBeVisible();
	await expect(intervalSuggestion).toHaveAttribute("aria-selected", "true");
	await expect(suggestions.getByRole("option")).toHaveCount(1);
	await expect(suggestions.locator('[data-variable-suggestion*="interval_seconds"]')).toHaveCount(0);
	const [fieldBox, suggestionBox] = await Promise.all([intervalField.boundingBox(), suggestions.boundingBox()]);
	expect(fieldBox).not.toBeNull();
	expect(suggestionBox).not.toBeNull();
	expect(suggestionBox?.y).toBeGreaterThanOrEqual((fieldBox?.y ?? 0) + (fieldBox?.height ?? 0));
	expect(suggestionBox?.width).toBeGreaterThan(100);
	await intervalSuggestion.click();
	await expect(intervalField).toHaveValue("{{interval}}");
	const highlightedToken = page.locator(
		'[data-variable-highlight-layer] [data-variable-token="interval"][data-variable-status="known"]',
	);
	await expect(highlightedToken).toBeVisible();
	const highlightStyles = await highlightedToken.evaluate((element) => {
		const tokenStyle = getComputedStyle(element);
		const layerStyle = getComputedStyle(element.closest("[data-variable-highlight-layer]") as HTMLElement);
		return {
			backgroundColor: tokenStyle.backgroundColor,
			baseColor: layerStyle.color,
			tokenColor: tokenStyle.color,
		};
	});
	expect(highlightStyles.tokenColor).not.toBe(highlightStyles.baseColor);
	expect(highlightStyles.backgroundColor).not.toMatch(/^(?:rgba\(0,\s*0,\s*0,\s*0\)|transparent)$/);
	await expect(intervalField).not.toHaveAttribute("aria-invalid", "true");
	const highlightedTokenBox = await highlightedToken.boundingBox();
	expect(highlightedTokenBox).not.toBeNull();
	const fieldCenter = (fieldBox?.y ?? 0) + (fieldBox?.height ?? 0) / 2;
	const tokenCenter = (highlightedTokenBox?.y ?? 0) + (highlightedTokenBox?.height ?? 0) / 2;
	expect(Math.abs(fieldCenter - tokenCenter)).toBeLessThanOrEqual(1);
	await page.getByText("Unit", { exact: true }).locator("..").getByRole("button").click();
	await page.getByRole("option", { name: "Milliseconds" }).click();
	await page.getByRole("button", { name: "Simulator" }).click();

	const scheduleStatus = page.getByText("Schedule simulation", { exact: true }).locator("../..");
	const startSchedule = page.getByRole("button", { name: "Start Schedule" });
	await expect(startSchedule).toBeEnabled();
	await startSchedule.click();

	await expect(page.getByRole("button", { name: "Stop Schedule" })).toBeVisible();
	await expect(scheduleStatus).not.toContainText("not yet", { timeout: 2_000 });

	await page.getByRole("button", { name: "Stop Schedule" }).click();
	await expect(page.getByRole("button", { name: "Start Schedule" })).toBeVisible();
	await expect(page.getByRole("button", { name: "Stop simulation" })).toBeDisabled();
});

test("Schedule simulation fires a three-second interval every three seconds", async ({ page }) => {
	await openEditor(page);

	await page.getByRole("button", { name: "Schedule" }).click();
	await page.getByRole("textbox", { name: "Every", exact: true }).fill("3");
	await page.getByText("Unit", { exact: true }).locator("..").getByRole("button").click();
	await page.getByRole("option", { name: "Seconds", exact: true }).click();
	await page.getByRole("button", { name: "Simulator" }).click();
	await page.getByRole("button", { name: "Simulation speed" }).click();
	await page.getByRole("option", { name: "Real time" }).click();

	const scheduleStatus = page.locator("[data-schedule-status]");
	await page.getByRole("button", { name: "Start Schedule" }).click();

	const firstFireAt = await waitForScheduleFire(scheduleStatus, 0);
	const secondFireAt = await waitForScheduleFire(scheduleStatus, firstFireAt);
	const elapsedMs = secondFireAt - firstFireAt;

	expect(elapsedMs).toBeGreaterThanOrEqual(2_800);
	expect(elapsedMs).toBeLessThan(3_600);
});

test("failed simulation preflight leaves Schedule controls inactive", async ({ page }) => {
	await openEditor(page);

	await openProjectSettingsTab(page, "Secrets");
	await page.getByRole("button", { name: "Add secret" }).click();
	const secretDialog = page.getByRole("dialog");
	await secretDialog.getByRole("textbox", { name: "Name" }).fill("api_token");
	await expect(secretDialog.getByRole("switch", { name: "Required for execution" })).toBeChecked();
	await secretDialog.getByRole("button", { name: "Save", exact: true }).click();

	await page.getByRole("tab", { name: "Script Settings" }).click();
	await page.getByRole("button", { name: "Add setting" }).click();
	const settingDialog = page.getByRole("dialog");
	await settingDialog.getByRole("textbox", { name: "Name" }).fill("Endpoint");
	await settingDialog.getByRole("switch", { name: "Required Script Setting" }).click();
	await settingDialog.getByRole("button", { name: "Save", exact: true }).click();
	await page.getByRole("button", { name: "Save Settings" }).click();

	await page.getByRole("button", { name: "Schedule" }).click();
	await page.getByRole("textbox", { name: "Every", exact: true }).fill("10");
	await page.getByRole("button", { name: "Simulator" }).click();

	const runState = page.getByText("Run State", { exact: true }).locator("..");
	await expect(runState).toContainText("idle");
	await page.getByRole("button", { name: "Start Schedule" }).click();

	const blockedDialog = page.getByRole("dialog");
	await expect(blockedDialog.getByRole("heading", { name: "Simulation Blocked" })).toBeVisible();
	await expect(blockedDialog).toContainText('Required simulation secret "api_token" has no value.');
	await expect(blockedDialog).toContainText(
		'Required Script Setting "Endpoint" has no simulation override or package default.',
	);
	await expect(blockedDialog).toContainText("Nothing was started or activated.");
	await blockedDialog.getByRole("button", { name: "Close" }).first().click();
	await expect(page.getByRole("button", { name: "Start Schedule" })).toBeVisible();
	await expect(page.getByRole("button", { name: "Stop Schedule" })).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Stop simulation" })).toBeDisabled();
	await expect(runState).toContainText("idle");
	await expect(page.getByText("inactive", { exact: true })).toHaveCount(2);
});

async function waitForScheduleFire(scheduleStatus: ReturnType<Page["locator"]>, after: number) {
	let firedAt = 0;
	await expect
		.poll(
			async () => {
				firedAt = Number(await scheduleStatus.getAttribute("data-schedule-last-run-at"));
				return firedAt;
			},
			{ timeout: 5_000 },
		)
		.toBeGreaterThan(after);
	return firedAt;
}

test("panel collapse state persists across editor reloads", async ({ page }) => {
	await openEditor(page);

	await page.getByRole("button", { name: "Collapse block library" }).click();
	await page.getByRole("button", { name: "Collapse inspector" }).click();
	await page.getByRole("button", { name: "Collapse bottom panel" }).click();

	await expect(page.getByRole("button", { name: "Expand block library" })).toBeVisible();
	await expect(page.getByRole("button", { name: "Expand inspector" })).toBeVisible();
	await expect(page.getByRole("button", { name: "Expand bottom panel" })).toBeVisible();
	await expect(page.getByRole("textbox", { name: "Search blocks" })).toBeHidden();
	await expect(page.getByRole("button", { name: "Properties" })).toBeHidden();
	const exportButton = page.getByRole("button", { name: "Export package" });
	await expect(exportButton).toBeVisible();
	const exportBounds = await exportButton.boundingBox();
	expect(exportBounds).not.toBeNull();
	expect((page.viewportSize()?.width ?? 0) - ((exportBounds?.x ?? 0) + (exportBounds?.width ?? 0))).toBeLessThanOrEqual(
		12,
	);

	const storedState = await readPanelPreferences(page);
	expect(storedState).toEqual({ left: true, right: true, bottom: true });

	await page.reload({ waitUntil: "commit" });

	await expect(page.getByRole("button", { name: "Expand block library" })).toBeVisible();
	await expect(page.getByRole("button", { name: "Expand inspector" })).toBeVisible();
	await expect(page.getByRole("button", { name: "Expand bottom panel" })).toBeVisible();
	await expect(page.getByRole("textbox", { name: "Search blocks" })).toBeHidden();
	await expect(page.getByRole("button", { name: "Properties" })).toBeHidden();
});

test("help modal exposes controls, references, expressions, and node docs", async ({ page }) => {
	await openEditor(page);

	await page.getByRole("button", { name: "Open help" }).click();
	await expect(page.getByRole("heading", { name: "Editor Help" })).toBeVisible();
	await expect(page.getByRole("heading", { name: "Editor Shortcuts" })).toBeVisible();
	await expect(page.getByRole("heading", { name: "Windows Node Keys" })).toBeVisible();

	await page.getByRole("button", { name: "References" }).click();
	await expect(page.getByRole("heading", { name: "Reference Formats" })).toBeVisible();
	await expect(page.getByText("{{node-id.output_name}}")).toBeVisible();

	await page.getByRole("button", { name: "Expressions" }).click();
	await expect(page.getByRole("heading", { name: "Calculate Node" })).toBeVisible();
	await expect(page.getByText("round(value)")).toBeVisible();
	await expect(page.getByText("^", { exact: true })).toBeVisible();

	await page.getByRole("button", { name: "Nodes" }).click();
	await expect(page.getByRole("heading", { name: "Node Reference" })).toBeVisible();
	await expect(page.getByText("Send an HTTP request.")).toBeVisible();
});

test("project settings target runtimes can be selected together", async ({ page }) => {
	await openEditor(page);

	await page.getByRole("button", { name: "Open project settings" }).click();
	await expect(page.getByRole("heading", { name: "Project Settings" })).toBeVisible();

	await page.getByRole("tab", { name: "Runtime" }).click();
	await page.getByRole("button", { name: "Target runtimes" }).click();
	await page.getByRole("option", { name: "Linux Desktop" }).click();
	await page.getByRole("button", { name: "Save Settings" }).click();

	await expect(page.getByText("Windows Desktop, Linux Desktop", { exact: true })).toBeVisible();
	await expect(page.getByText("not verified", { exact: true })).toBeVisible();
});

test("If / Else unary conditions hide the target field", async ({ page }) => {
	await openEditor(page);

	await page.getByRole("button", { name: "If / Else" }).click();
	const expressionTrigger = page.getByRole("button", { name: "Expression" });
	const selectedExpression = expressionTrigger.locator("span").first();
	const [triggerBounds, selectedBounds] = await Promise.all([
		expressionTrigger.boundingBox(),
		selectedExpression.boundingBox(),
	]);
	if (!triggerBounds || !selectedBounds) throw new Error("Expression dropdown is not visible.");
	expect(
		Math.abs(triggerBounds.y + triggerBounds.height / 2 - (selectedBounds.y + selectedBounds.height / 2)),
	).toBeLessThan(1.5);

	await expressionTrigger.click();
	const equalsOption = page.getByRole("option", { name: "equals", exact: true });
	const equalsLabel = equalsOption.locator("span").first();
	const [optionBounds, optionLabelBounds] = await Promise.all([equalsOption.boundingBox(), equalsLabel.boundingBox()]);
	if (!optionBounds || !optionLabelBounds) throw new Error("Expression option is not visible.");
	expect(
		Math.abs(optionBounds.y + optionBounds.height / 2 - (optionLabelBounds.y + optionLabelBounds.height / 2)),
	).toBeLessThan(1.5);
	await equalsOption.click();

	await expressionTrigger.click();
	await page.getByRole("option", { name: "greater than", exact: true }).click();
	await expect(page.getByRole("button", { name: "Increase Value" })).toBeVisible();
	await expect(page.getByRole("button", { name: "Increase Target" })).toBeVisible();

	await expressionTrigger.click();
	await page.getByRole("option", { name: "Is numeric" }).click();
	await expect(page.getByRole("textbox", { name: "Target" })).toHaveCount(0);

	await expressionTrigger.click();
	await page.getByRole("option", { name: "has key" }).click();
	await expect(page.getByRole("textbox", { name: "Target" })).toBeVisible();

	await expressionTrigger.click();
	await page.getByRole("option", { name: "Is between" }).click();
	await expect(page.getByRole("button", { name: "Increase Value" })).toBeVisible();
	await expect(page.getByRole("textbox", { name: "Start value" })).toBeVisible();
	await expect(page.getByRole("textbox", { name: "End value" })).toBeVisible();
	await expect(page.getByRole("textbox", { name: "Target" })).toHaveCount(0);

	await page.getByRole("textbox", { name: "Search blocks" }).fill("While");
	await page.getByRole("button", { name: /^While low/ }).click();
	await page.getByRole("button", { name: "Expression" }).click();
	await page.getByRole("option", { name: "Is True" }).click();
	await expect(page.getByRole("textbox", { name: "Target" })).toHaveCount(0);
});

test("text transform accepts a default variable with inactive optional numeric fields", async ({ page }) => {
	await openEditor(page);

	await openProjectSettingsTab(page, "Default Variables");
	await page.getByRole("button", { name: "Add variable" }).click();
	const variableDialog = page.getByRole("dialog");
	await variableDialog.getByRole("textbox", { name: "Name" }).fill("test");
	await variableDialog.getByRole("textbox", { name: "Default value" }).fill("lowercase_data");
	await variableDialog.getByRole("button", { name: "Save" }).click();
	await page.getByRole("button", { name: "Save Settings" }).click();

	await page.getByRole("button", { name: "Data & Variables" }).click();
	await page.getByRole("button", { name: "Text Transform" }).click();
	const operationList = page.getByRole("list", { name: "Text transform operations" });
	const firstOperation = operationList.getByRole("listitem").first();
	await firstOperation.getByRole("button", { name: "Operation", exact: true }).click();
	await page.getByRole("option", { name: "Uppercase" }).click();
	await page.getByRole("textbox", { name: "Input" }).fill("{{test}}");
	const transformNode = page.locator(".react-flow__node").filter({ hasText: "Text Transform" });
	await expect(transformNode).toContainText("uppercase");
	await page.getByRole("button", { name: "Add operation" }).click();
	const secondOperation = operationList.getByRole("listitem").nth(1);
	await secondOperation.getByRole("button", { name: "Operation", exact: true }).click();
	await page.getByRole("option", { name: "Replace text", exact: true }).click();
	await secondOperation.getByRole("textbox", { name: "Search" }).fill("DATA");
	await secondOperation.getByRole("textbox", { name: "Replacement" }).fill("VALUE");
	await expect(transformNode).toContainText("uppercase -> replace");
	await page.getByRole("button", { name: "Verify script" }).click();

	await expect(page.getByRole("heading", { name: "Verification" })).toBeVisible();
	await expect(page.getByText("Variable writes, calculations, and action configs are valid.")).toBeVisible();
	await expect(page.getByText(/Invalid value for length/)).toHaveCount(0);
});

test("variable operation completes writable variable names without template braces", async ({ page }) => {
	await openEditor(page);

	await openProjectSettingsTab(page, "Default Variables");
	await page.getByRole("button", { name: "Add variable" }).click();
	const variableDialog = page.getByRole("dialog");
	await variableDialog.getByRole("textbox", { name: "Name" }).fill("preferred_status");
	await variableDialog.getByRole("textbox", { name: "Default value" }).fill("ready");
	await variableDialog.getByRole("button", { name: "Save" }).click();
	await page.getByRole("button", { name: "Save Settings" }).click();

	await page.getByRole("button", { name: "Data & Variables" }).click();
	await page.getByRole("button", { name: "Variable Operation" }).click();
	const nameInput = page.getByRole("combobox", { name: "Variable name" });
	await nameInput.fill("preferred");
	await page.getByRole("option", { name: /preferred_status/ }).click();

	await expect(nameInput).toHaveValue("preferred_status");
	await expect(nameInput).not.toHaveValue("{{preferred_status}}");
});

test("Script Settings are available to autocomplete and simulation", async ({ page }) => {
	await openEditor(page);

	await openProjectSettingsTab(page, "Script Settings");
	await page.getByRole("button", { name: "Add setting" }).click();
	const settingDialog = page.getByRole("dialog");
	await settingDialog.getByRole("textbox", { name: "Name" }).fill("Endpoint");
	await settingDialog.getByRole("switch", { name: "Required Script Setting" }).click();
	await settingDialog.getByRole("switch", { name: "Use Package default" }).click();
	await settingDialog.getByRole("textbox", { name: "Package default" }).fill("https://default.example");
	await settingDialog.getByRole("switch", { name: "Use Simulation override" }).click();
	await settingDialog.getByRole("textbox", { name: "Simulation override" }).fill("https://simulation.example");
	await settingDialog.getByRole("button", { name: "Save", exact: true }).click();
	await page.getByRole("button", { name: "Save Settings" }).click();

	await page.getByRole("button", { name: "Manual" }).click();
	await page.getByRole("button", { name: "Output & Timing" }).click();
	await page.getByRole("button", { name: /^Log low/ }).click();
	const message = page.getByRole("textbox", { name: "Message" });
	await message.fill("{{settings.End");
	await page
		.getByRole("listbox", { name: "Message suggestions" })
		.getByRole("option", { name: /\{\{settings\.Endpoint\}\}/ })
		.click();
	await expect(message).toHaveValue("{{settings.Endpoint}}");

	const manualNode = page.locator(".react-flow__node").filter({ hasText: "Manual Trigger" });
	const logNode = page.locator(".react-flow__node").filter({ hasText: "Log" });
	await manualNode.locator(".react-flow__handle.source").first().dispatchEvent("click", { bubbles: true });
	await logNode.locator(".react-flow__handle.target").first().dispatchEvent("click", { bubbles: true });

	await page.getByRole("button", { name: "Simulator" }).click();
	await page.getByRole("button", { name: "Simulation speed" }).click();
	await page.getByRole("option", { name: "Real time" }).click();
	await page.getByRole("button", { name: "Trigger", exact: true }).click();
	await page.getByRole("button", { name: "Output", exact: true }).click();
	await expect(page.getByText(/https:\/\/simulation\.example/)).toBeVisible();

	await page.getByRole("button", { name: "Variables", exact: true }).click();
	await expect(page.locator('[data-variable-name="settings.Endpoint"] pre')).toHaveText("https://simulation.example");
});

test("Script Setting type and timezone menus stay anchored and scroll vertically", async ({ page }) => {
	await openEditor(page);

	await openProjectSettingsTab(page, "Script Settings");
	await page.getByRole("button", { name: "Add setting" }).click();
	const settingDialog = page.getByRole("dialog");
	const typeTrigger = settingDialog.locator('[data-slot="select-trigger"]').first();
	const typeTriggerBounds = await typeTrigger.boundingBox();
	if (!typeTriggerBounds) throw new Error("Script Setting type trigger is not visible.");

	await typeTrigger.click();
	const typeMenu = page.locator('[data-slot="select-content"]');
	await expect(typeMenu).toBeVisible();
	const typeMenuBounds = await typeMenu.boundingBox();
	if (!typeMenuBounds) throw new Error("Script Setting type menu is not visible.");
	expect(typeMenuBounds.y).toBeGreaterThanOrEqual(typeTriggerBounds.y + typeTriggerBounds.height);
	await expect(typeMenu).toHaveJSProperty("scrollWidth", await typeMenu.evaluate((element) => element.clientWidth));

	await page.getByRole("option", { name: "datetime" }).click();
	await settingDialog.getByRole("switch", { name: "Use Package default" }).click();
	const timeZoneTrigger = settingDialog.getByRole("combobox", { name: "Datetime timezone" });
	const timeZoneTriggerBounds = await timeZoneTrigger.boundingBox();
	if (!timeZoneTriggerBounds) throw new Error("Timezone trigger is not visible.");
	await timeZoneTrigger.click();
	const timeZoneMenu = page.locator('[data-slot="select-content"]');
	const timeZoneViewport = timeZoneMenu.locator('[data-position="popper"]');
	await expect(timeZoneMenu).toBeVisible();
	expect(await timeZoneMenu.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
	expect(await timeZoneViewport.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
	await expect(timeZoneMenu.locator('[data-slot="select-scroll-up-button"]')).toHaveCount(0);
	await expect(timeZoneMenu.locator('[data-slot="select-scroll-down-button"]')).toHaveCount(0);
	const menuBoundsBeforeScroll = await timeZoneMenu.boundingBox();
	if (!menuBoundsBeforeScroll) throw new Error("Timezone menu geometry is unavailable.");
	expect(menuBoundsBeforeScroll.y).toBeGreaterThanOrEqual(timeZoneTriggerBounds.y + timeZoneTriggerBounds.height);
	expect(Math.abs(menuBoundsBeforeScroll.width - timeZoneTriggerBounds.width)).toBeLessThanOrEqual(1);

	await timeZoneViewport.hover();
	await page.mouse.wheel(0, 500);
	await expect
		.poll(() => timeZoneViewport.evaluate((element) => element.scrollTop), {
			message: "Timezone menu should scroll down.",
		})
		.toBeGreaterThan(0);
	const menuBoundsAfterScroll = await timeZoneMenu.boundingBox();
	expect(menuBoundsAfterScroll?.x).toBe(menuBoundsBeforeScroll.x);
	expect(menuBoundsAfterScroll?.y).toBe(menuBoundsBeforeScroll.y);
});

test("Default Variables and Script Settings display typed values without internal JSON wrappers", async ({ page }) => {
	await openEditor(page);
	await openProjectSettingsTab(page, "Default Variables");
	await page.getByRole("button", { name: "Add variable" }).click();
	let valueDialog = page.getByRole("dialog");
	await valueDialog.getByRole("textbox", { name: "Name" }).fill("Timeout");
	await valueDialog.getByRole("combobox", { name: "Type" }).click();
	await page.getByRole("option", { name: "duration", exact: true }).click();
	await valueDialog.getByRole("spinbutton", { name: "Default value amount" }).fill("3");
	await valueDialog.getByRole("button", { name: "Save", exact: true }).click();

	const timeoutVariable = page.locator("article").filter({ hasText: "Timeout" });
	await expect(timeoutVariable.locator("pre")).toHaveText("3 seconds");
	await expect(timeoutVariable.locator("pre")).not.toContainText('"type"');

	await page.getByRole("tab", { name: "Script Settings" }).click();
	await page.getByRole("button", { name: "Add setting" }).click();
	valueDialog = page.getByRole("dialog");
	await valueDialog.getByRole("textbox", { name: "Name" }).fill("StartedAt");
	await valueDialog.locator('[data-slot="select-trigger"]').first().click();
	await page.getByRole("option", { name: "datetime", exact: true }).click();
	await valueDialog.getByRole("switch", { name: "Use Package default" }).click();
	await valueDialog.getByRole("combobox", { name: "Datetime timezone" }).click();
	await page.getByRole("option", { name: "UTC", exact: true }).click();
	await valueDialog.locator('input[type="datetime-local"][aria-label="Package default"]').fill("2026-08-03T12:30:15");
	await valueDialog.getByRole("button", { name: "Save", exact: true }).click();

	const datetimeSetting = page.locator("article").filter({ hasText: "StartedAt" });
	await expect(datetimeSetting.locator("pre").first()).toHaveText("2026-08-03T12:30:15.000Z");
	await expect(datetimeSetting.locator("pre").first()).not.toContainText('"type"');
});

test("Webhook response controls explain both modes and Read File is implicitly UTF-8", async ({ page }) => {
	await openEditor(page);

	const blockSearch = page.getByRole("textbox", { name: "Search blocks" });
	await blockSearch.fill("Webhook");
	await page.getByRole("button", { name: /^Webhook high$/ }).click();
	await expect(page.getByRole("spinbutton", { name: "Response timeout seconds" })).toBeVisible();
	await expect(page.getByRole("spinbutton", { name: "Response status" })).toBeVisible();
	await expect(page.getByRole("textbox", { name: "Response content type" })).toBeVisible();
	await expect(page.getByRole("textbox", { name: "Response body" })).toBeVisible();
	await page.getByRole("switch", { name: "Wait for response node" }).click();
	await expect(page.getByRole("spinbutton", { name: "Response timeout seconds" })).toBeVisible();

	await blockSearch.fill("Read File");
	await page.getByRole("button", { name: /^Read File medium$/ }).click();
	await expect(page.getByRole("textbox", { name: "Path" })).toBeVisible();
	await expect(page.getByText("Encoding", { exact: true })).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Encoding" })).toHaveCount(0);
});

test("hotkey and color Script Settings use dedicated controls and color variables resolve in nodes", async ({
	page,
}) => {
	await openEditor(page);

	await openProjectSettingsTab(page, "Script Settings");
	await page.getByRole("button", { name: "Add setting" }).click();
	let settingDialog = page.getByRole("dialog");
	await settingDialog.getByRole("textbox", { name: "Name" }).fill("Accent");
	await settingDialog.locator('[data-slot="select-trigger"]').first().click();
	await page.getByRole("option", { name: "color", exact: true }).click();
	await settingDialog.getByRole("switch", { name: "Use Simulation override" }).click();
	await settingDialog.getByRole("textbox", { name: "Simulation override" }).fill("#123456");
	await settingDialog.getByRole("button", { name: "Save", exact: true }).click();

	await page.getByRole("button", { name: "Add setting" }).click();
	settingDialog = page.getByRole("dialog");
	await settingDialog.getByRole("textbox", { name: "Name" }).fill("Shortcut");
	await settingDialog.locator('[data-slot="select-trigger"]').first().click();
	await page.getByRole("option", { name: "keyboard_key", exact: true }).click();
	await settingDialog.getByRole("switch", { name: "Use Package default" }).click();
	const hotkeyDefault = settingDialog.getByRole("textbox", { name: "Package default" });
	await hotkeyDefault.press("Control+Shift+F8");
	await expect(hotkeyDefault).toHaveValue("Ctrl+Shift+F8");
	await settingDialog.getByRole("button", { name: "Save", exact: true }).click();
	await page.getByRole("button", { name: "Save Settings" }).click();
	await expect(page.getByText("unsaved changes", { exact: true })).toBeVisible();
	await page.keyboard.press("Control+s");
	await expect(page.getByText("saved", { exact: true })).toBeVisible();
	const projectId = new URL(page.url()).pathname.split("/").at(-1);
	if (!projectId) throw new Error("The editor URL does not contain a project id.");
	const storedSettings = await page.evaluate(async (id) => {
		const database = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open("baudbound-editor", 1);
			request.addEventListener("success", () => resolve(request.result), { once: true });
			request.addEventListener("error", () => reject(request.error), { once: true });
		});
		try {
			return await new Promise<unknown>((resolve, reject) => {
				const request = database.transaction("projects", "readonly").objectStore("projects").get(id);
				request.addEventListener("success", () =>
					resolve((request.result as { scriptSettings?: unknown } | undefined)?.scriptSettings),
				);
				request.addEventListener("error", () => reject(request.error), { once: true });
			});
		} finally {
			database.close();
		}
	}, projectId);
	expect(storedSettings).toEqual([
		{
			description: "",
			name: "Accent",
			required: false,
			simulationValue: "#123456",
			type: "color",
		},
		{
			defaultValue: "Ctrl+Shift+F8",
			description: "",
			name: "Shortcut",
			required: false,
			type: "keyboard_key",
		},
	]);
	await page.reload({ waitUntil: "commit" });
	await expect(page.getByRole("button", { name: "Open project settings" })).toBeVisible();
	await openProjectSettingsTab(page, "Script Settings");
	const accentSetting = page.locator("article").filter({ hasText: "Accent" });
	const shortcutSetting = page.locator("article").filter({ hasText: "Shortcut" });
	await expect(accentSetting).toContainText("color");
	await expect(accentSetting).toContainText("#123456");
	await expect(shortcutSetting).toContainText("keyboard_key");
	await expect(shortcutSetting).toContainText("Ctrl+Shift+F8");
	await page.getByRole("button", { name: "Save Settings" }).click();

	await page.getByRole("button", { name: /Color Match low/ }).click();
	const actualColor = page.getByRole("textbox", { name: "Actual color" });
	await actualColor.fill("{{settings.Acc");
	const colorSuggestions = page.getByRole("listbox", { name: "Actual color suggestions" });
	await expect(colorSuggestions.locator('[data-variable-suggestion="settings.Shortcut"]')).toHaveCount(0);
	await colorSuggestions.getByRole("option", { name: /\{\{settings\.Accent\}\}/ }).click();
	await expect(actualColor).toHaveValue("{{settings.Accent}}");
	await expect(page.getByRole("button", { name: "Open actual color color picker" })).toHaveCSS(
		"background-color",
		"rgb(18, 52, 86)",
	);

	const blockSearch = page.getByRole("textbox", { name: "Search blocks" });
	await blockSearch.fill("Hotkey");
	await page.getByRole("button", { name: /Hotkey medium/ }).click();
	const inspector = page.getByRole("complementary", { name: "Inspector" });
	const literalKey = inspector.getByRole("textbox", { name: "Key" });
	await literalKey.press("Control+8");
	await expect(literalKey).toHaveValue("Ctrl+8");

	const keySource = inspector.getByRole("button", { name: "Key source" });
	await keySource.click();
	await page.getByRole("option", { name: "Variable", exact: true }).click();
	await expect(inspector.getByRole("textbox", { name: "Key" })).toHaveCount(0);
	const hotkeyVariable = inspector.getByRole("button", { name: "Key", exact: true });
	await hotkeyVariable.click();
	await expect(page.getByRole("option", { name: "settings.Accent", exact: true })).toHaveCount(0);
	await page.getByRole("option", { name: "settings.Shortcut", exact: true }).click();
	await expect(hotkeyVariable).toContainText("settings.Shortcut");
	await expect(hotkeyVariable).not.toContainText("{{");
	await expect(inspector.getByText("Supported key reference", { exact: true })).toHaveCount(0);
});

test("renaming defaults and secrets updates every node reference", async ({ page }) => {
	await openEditor(page);

	await openProjectSettingsTab(page, "Default Variables");
	await page.getByRole("button", { name: "Add variable" }).click();
	let variableDialog = page.getByRole("dialog");
	await variableDialog.getByRole("textbox", { name: "Name" }).fill("inventory");
	await variableDialog.getByRole("textbox", { name: "Default value" }).fill("ready");
	await variableDialog.getByRole("button", { name: "Save" }).click();

	await page.getByRole("tab", { name: "Secrets" }).click();
	await page.getByRole("button", { name: "Add secret" }).click();
	let secretDialog = page.getByRole("dialog");
	await secretDialog.getByRole("textbox", { name: "Name" }).fill("api_token");
	await secretDialog.getByRole("switch", { name: "Use Simulation override" }).click();
	await secretDialog.getByRole("textbox", { name: "Simulation override" }).fill("test-secret");
	await secretDialog.getByRole("button", { name: "Save" }).click();
	await expect(page.getByText("Override configured")).toBeVisible();
	await page.getByRole("button", { name: "Save Settings" }).click();

	await page.getByRole("button", { name: "Data & Variables" }).click();
	await page.getByRole("button", { name: "Variable Operation" }).click();
	await page.getByRole("combobox", { name: "Variable name" }).fill("inventory");
	const variableNode = page.locator(".react-flow__node").filter({ hasText: "Variable Operation" });

	await page.getByRole("button", { name: "Output & Timing" }).click();
	await page.getByRole("button", { name: /^Log low/ }).click();
	await page
		.getByRole("textbox", { name: "Message" })
		.fill("{{inventory}} {{inventory.items[0]}} {{api_token}} {{api_token.value}} {{inventory_backup}}");
	const logNode = page.locator(".react-flow__node").filter({ hasText: "Log" });

	await openProjectSettingsTab(page, "Default Variables");
	await page.getByRole("button", { name: "Edit inventory" }).click();
	variableDialog = page.getByRole("dialog");
	await variableDialog.getByRole("textbox", { name: "Name" }).fill("stock");
	await variableDialog.getByRole("button", { name: "Save" }).click();

	await page.getByRole("tab", { name: "Secrets" }).click();
	await page.getByRole("button", { name: "Edit api_token" }).click();
	secretDialog = page.getByRole("dialog");
	await secretDialog.getByRole("textbox", { name: "Name" }).fill("access_token");
	await expect(secretDialog.getByRole("switch", { name: "Use Simulation override" })).toBeChecked();
	await expect(secretDialog.getByRole("textbox", { name: "Simulation override" })).toHaveValue("test-secret");
	await secretDialog.getByRole("button", { name: "Save" }).click();
	await expect(page.getByText("Override configured")).toBeVisible();
	await page.getByRole("button", { name: "Save Settings" }).click();

	await expect(variableNode).toContainText("stock");
	await expect(logNode).toContainText(
		"{{stock}} {{stock.items[0]}} {{access_token}} {{access_token.value}} {{inventory_backup}}",
	);
});

test("variable search respects the error output visibility option", async ({ page }) => {
	await openEditor(page);

	await page.getByRole("button", { name: "Data & Variables" }).click();
	await page.getByRole("button", { name: "Convert Value" }).click();
	await page.getByRole("button", { name: "Variables", exact: true }).click();

	const variableRows = page.locator("[data-variable-name]");
	const showErrors = page.getByRole("checkbox", { name: "Show errors" });
	const showOutputs = page.getByRole("checkbox", { name: "Show outputs" });
	await expect(showErrors).not.toBeChecked();
	await expect(showOutputs).toBeChecked();
	await expect(page.locator('[data-variable-name*=".error"]')).toHaveCount(0);

	const search = page.getByRole("textbox", { name: "Search variables" });
	await search.fill("target_type");
	await expect(variableRows).toHaveCount(1);
	await expect(variableRows.first()).toHaveAttribute("data-variable-name", /\.target_type$/);
	await showOutputs.uncheck();
	await expect(variableRows).toHaveCount(0);
	await showOutputs.check();
	await expect(variableRows).toHaveCount(1);

	await search.fill("retryable");
	await expect(page.getByText("No variables match your search and display options.")).toBeVisible();
	await showErrors.click();
	await expect(variableRows).toHaveCount(1);
	await expect(variableRows.first()).toHaveAttribute("data-variable-name", /\.error\.retryable$/);
});

test("variable editors do not insert example values", async ({ page }) => {
	await openEditor(page);

	await page.getByRole("button", { name: "Data & Variables" }).click();
	await page.getByRole("button", { name: "Variable Operation" }).click();
	await expect(page.getByRole("textbox", { name: "Value" })).toHaveValue("");
	await expect(page.getByText(/^Example:/)).toHaveCount(0);

	await page.getByRole("button", { name: "Variable type" }).click();
	await page.getByRole("option", { name: "integer" }).click();
	await expect(page.getByRole("textbox", { name: "Value" })).toHaveValue("");

	await page.getByRole("button", { name: "Operation", exact: true }).click();
	await page.getByRole("option", { name: "Increment" }).click();
	await expect(page.getByRole("textbox", { name: "Amount" })).toHaveValue("");

	await page.getByRole("button", { name: "Operation", exact: true }).click();
	await page.getByRole("option", { name: "Set object field" }).click();
	await expect(page.getByRole("textbox", { name: "Object field path" })).toHaveValue("");
	await expect(page.getByRole("textbox", { name: "Field value" })).toHaveValue("");

	await openProjectSettingsTab(page, "Default Variables");
	await page.getByRole("button", { name: "Add variable" }).click();
	const variableDialog = page.getByRole("dialog");
	await variableDialog.getByRole("combobox", { name: "Type" }).click();
	await page.getByRole("option", { name: "string" }).click();
	await expect(variableDialog.getByRole("textbox", { name: "Default value" })).toHaveValue("");
	await variableDialog.getByRole("button", { name: "Cancel" }).click();
	await page.keyboard.press("Escape");
});

test("persistent variable simulation carries changes into the next run", async ({ page }) => {
	await openEditor(page);

	await openProjectSettingsTab(page, "Default Variables");
	await page.getByRole("button", { name: "Add variable" }).click();
	const variableDialog = page.getByRole("dialog");
	await variableDialog.getByRole("textbox", { name: "Name" }).fill("counter");
	await variableDialog.getByRole("combobox", { name: "Scope" }).click();
	await page.getByRole("option", { name: "persistent" }).click();
	await variableDialog.getByRole("combobox", { name: "Type" }).click();
	await page.getByRole("option", { name: "integer" }).click();
	await variableDialog.getByRole("spinbutton", { name: "Default value" }).fill("0");
	await variableDialog.getByRole("button", { name: "Save" }).click();
	await page.getByRole("button", { name: "Save Settings" }).click();

	await page.getByRole("button", { name: "Manual" }).click();
	await page.getByRole("button", { name: "Data & Variables" }).click();
	await page.getByRole("button", { name: "Variable Operation" }).click();
	await page.getByRole("button", { name: "Operation", exact: true }).click();
	await page.getByRole("option", { name: "Increment" }).click();
	await page.getByRole("combobox", { name: "Variable name" }).fill("counter");
	await page.getByRole("textbox", { name: "Amount" }).fill("1");
	await page.getByRole("button", { name: "Scope", exact: true }).click();
	await page.getByRole("option", { name: "persistent" }).click();

	const manualNode = page.locator(".react-flow__node").filter({ hasText: "Manual Trigger" });
	const variableNode = page.locator(".react-flow__node").filter({ hasText: "Variable Operation" });
	await manualNode.locator(".react-flow__handle.source").first().dispatchEvent("click", { bubbles: true });
	await variableNode.locator(".react-flow__handle.target").first().dispatchEvent("click", { bubbles: true });

	await page.getByRole("button", { name: "Simulator" }).click();
	await page.getByRole("button", { name: "Simulation speed" }).click();
	await page.getByRole("option", { name: "Real time" }).click();
	await page.getByRole("button", { name: "Trigger", exact: true }).click();
	await page.getByRole("button", { name: "Variables", exact: true }).click();
	const counterValue = page.locator('[data-variable-name="counter"] pre');
	await expect(counterValue).toHaveText("1");
	await expect(page.locator(".react-flow__edge.baud-edge-simulated")).toHaveCount(1);
	await expect(manualNode.locator(".baud-script-node")).toHaveCSS("border-color", "rgb(46, 217, 143)");
	await expect(variableNode.locator(".baud-script-node")).toHaveCSS("border-color", "rgb(46, 217, 143)");
	await page.getByRole("button", { name: "Trigger", exact: true }).click();
	await expect(counterValue).toHaveText("2");

	await page.getByRole("button", { name: "Variables", exact: true }).click();
	await page.getByRole("button", { name: "Reset stored values" }).click();
	const resetDialog = page.getByRole("dialog");
	await expect(resetDialog.getByRole("heading", { name: "Reset stored values?" })).toBeVisible();
	await resetDialog.getByRole("button", { name: "Reset stored values" }).click();
	await expect(counterValue).toHaveText("0");

	await page.getByRole("button", { name: "Simulator" }).click();
	await page.getByRole("button", { name: "Trigger", exact: true }).click();
	await page.getByRole("button", { name: "Variables", exact: true }).click();
	await expect(counterValue).toHaveText("1");
});

test("numeric fields autocomplete number variables and suspend literal stepping", async ({ page }) => {
	await openEditor(page);

	await openProjectSettingsTab(page, "Default Variables");
	await page.getByRole("button", { name: "Add variable" }).click();
	const variableDialog = page.getByRole("dialog");
	await variableDialog.getByRole("textbox", { name: "Name" }).fill("distance");
	await variableDialog.getByRole("combobox", { name: "Type" }).click();
	await page.getByRole("option", { name: "integer" }).click();
	await variableDialog.getByRole("spinbutton", { name: "Default value" }).fill("12");
	await variableDialog.getByRole("button", { name: "Save" }).click();
	await page.getByRole("button", { name: "Save Settings" }).click();

	const blockSearch = page.getByRole("textbox", { name: "Search blocks" });
	await blockSearch.fill("Move Mouse");
	await page.getByRole("button", { name: /Move Mouse high/ }).click();
	const xField = page.getByRole("textbox", { name: "X", exact: true });
	await xField.fill("{{dis");
	await expect(page.getByText("{{distance}}", { exact: true })).toBeVisible();
	await xField.press("Enter");

	await expect(xField).toHaveValue("{{distance}}");
	const decreaseX = page.getByRole("button", { name: "Decrease X" });
	const increaseX = page.getByRole("button", { name: "Increase X" });
	await expect(decreaseX).toBeDisabled();
	await expect(increaseX).toBeDisabled();
	await expect(xField).toHaveCSS("text-align", "left");
	const [fieldBox, decreaseBox, increaseBox] = await Promise.all([
		xField.boundingBox(),
		decreaseX.boundingBox(),
		increaseX.boundingBox(),
	]);
	expect(fieldBox).not.toBeNull();
	expect(decreaseBox).not.toBeNull();
	expect(increaseBox).not.toBeNull();
	expect(decreaseBox?.x).toBeGreaterThanOrEqual((fieldBox?.x ?? 0) + (fieldBox?.width ?? 0));
	expect(increaseBox?.x).toBeGreaterThan(decreaseBox?.x ?? 0);
	expect(decreaseBox?.width).toBeLessThanOrEqual(24);
	expect(increaseBox?.width).toBeLessThanOrEqual(24);

	await blockSearch.fill("Delay");
	await page.getByRole("button", { name: /^Delay low/ }).click();
	const amountField = page.getByRole("textbox", { name: "Amount", exact: true });
	await page.getByRole("button", { name: "Increase Amount" }).click();
	await expect(amountField).toHaveValue("1");
	await expect(page.getByRole("button", { name: "Decrease Amount" })).toBeDisabled();

	await amountField.fill("{{system_");
	await expect(page.locator('[data-variable-suggestion="system_date"]')).toHaveCount(0);
	await amountField.fill("{{system_date}}");
	await expect(page.locator('[data-variable-token="system_date"][data-variable-status="type-mismatch"]')).toBeVisible();
	await expect(
		page.getByText(
			'Variable "system_date" has type string; this field accepts float variables. Add a cast such as {{system_date|float}} to convert it.',
			{ exact: true },
		),
	).toBeVisible();

	await page.getByRole("button", { name: "Verify script" }).click();
	await expect(page.getByRole("heading", { name: "Verification" })).toBeVisible();
	await expect(
		page.locator("[data-verification-result] li").filter({
			hasText: /Delay.*Variable "system_date" has type string; this field accepts numeric variables/i,
		}),
	).toBeVisible();
});

test("Switch simulation follows the default output when no case matches", async ({ page }) => {
	await openEditor(page);

	await page.getByRole("button", { name: "Manual" }).click();
	const blockSearch = page.getByRole("textbox", { name: "Search blocks" });
	await blockSearch.fill("Switch");
	await page.getByRole("button", { name: /^Switch low/ }).click();
	await page.getByRole("textbox", { name: "Switch value" }).fill("missing");
	const switchCases = page.getByRole("list", { name: "Switch cases" });
	await switchCases.getByRole("textbox", { name: "Name" }).fill("Expected");
	await switchCases.getByRole("textbox", { name: "Value" }).fill("matched");
	await blockSearch.fill("Log");
	await page.getByRole("button", { name: /^Log low/ }).click();
	await page.getByRole("textbox", { name: "Message" }).fill("default path ran");

	const manualNode = page.locator(".react-flow__node").filter({ hasText: "Manual Trigger" });
	const switchNode = page.locator(".react-flow__node").filter({ hasText: "Switch" });
	const logNode = page.locator(".react-flow__node").filter({ hasText: "Log" });
	await manualNode.locator(".react-flow__handle.source").first().dispatchEvent("click", { bubbles: true });
	await switchNode.locator(".react-flow__handle.target").first().dispatchEvent("click", { bubbles: true });
	await switchNode
		.locator('.react-flow__handle.source[data-handleid="default"]')
		.dispatchEvent("click", { bubbles: true });
	await logNode.locator(".react-flow__handle.target").first().dispatchEvent("click", { bubbles: true });

	await page.getByRole("button", { name: "Simulator" }).click();
	await page.getByRole("button", { name: "Simulation speed" }).click();
	await page.getByRole("option", { name: "Real time" }).click();
	await page.getByRole("button", { name: "Trigger", exact: true }).click();
	await page.getByRole("button", { name: "Simulation", exact: true }).click();

	await expect(page.getByText(/matched no case and selected "default" output/)).toBeVisible();
	await expect(page.getByText(/default path ran/)).toBeVisible();
	await expect(switchNode.locator(".baud-script-node")).toHaveCSS("border-color", "rgb(46, 217, 143)");
	await expect(logNode.locator(".baud-script-node")).toHaveCSS("border-color", "rgb(46, 217, 143)");
});

test("coordinate verification rejects values outside the signed i32 contract", async ({ page }) => {
	await openEditor(page);

	await page.getByRole("textbox", { name: "Search blocks" }).fill("Get Pixel Color");
	await page.getByRole("button", { name: /Get Pixel Color medium/ }).click();
	await page.getByRole("textbox", { name: "Screen X" }).fill("2147483648");
	await page.getByRole("textbox", { name: "Screen Y" }).fill("-2147483649");
	await page.getByRole("button", { name: "Verify script" }).click();

	await expect(
		page.getByText(/Invalid value for x: must be at least -2147483648 and at most 2147483647/),
	).toBeVisible();
	await expect(
		page.getByText(/Invalid value for y: must be at least -2147483648 and at most 2147483647/),
	).toBeVisible();
});

test("negative screen coordinates verify, simulate, export, and import", async ({ page }, testInfo) => {
	await openEditor(page);

	await page.getByRole("button", { name: "Manual" }).click();
	await page.getByRole("textbox", { name: "Search blocks" }).fill("Get Pixel Color");
	await page.getByRole("button", { name: /Get Pixel Color medium/ }).click();
	await page.getByRole("textbox", { name: "Screen X" }).fill("-1920");
	await page.getByRole("textbox", { name: "Screen Y" }).fill("-120");
	await page.getByRole("textbox", { name: "Search blocks" }).fill("Move Mouse");
	await page.getByRole("button", { name: /Move Mouse high/ }).click();
	await page.getByRole("textbox", { name: "X", exact: true }).fill("-1600");
	await page.getByRole("textbox", { name: "Y", exact: true }).fill("-80");

	const manualNode = page.locator(".react-flow__node").filter({ hasText: "Manual Trigger" });
	const pixelNode = page.locator(".react-flow__node").filter({ hasText: "Get Pixel Color" });
	const mouseNode = page.locator(".react-flow__node").filter({ hasText: "Move Mouse" });
	await manualNode.locator(".react-flow__handle.source").first().dispatchEvent("click", { bubbles: true });
	await pixelNode.locator(".react-flow__handle.target").first().dispatchEvent("click", { bubbles: true });
	await pixelNode.locator(".react-flow__handle.source").first().dispatchEvent("click", { bubbles: true });
	await mouseNode.locator(".react-flow__handle.target").first().dispatchEvent("click", { bubbles: true });

	await page.getByRole("button", { name: "Verify script" }).click();
	await expect(page.getByText("Variable writes, calculations, and action configs are valid.")).toBeVisible();
	await expect(page.getByText(/Invalid value for [xy]/)).toHaveCount(0);
	await page.getByRole("button", { name: "Close verification" }).click();

	await page.getByRole("button", { name: "Simulator" }).click();
	await page.getByRole("button", { name: "Simulation speed" }).click();
	await page.getByRole("option", { name: "Real time" }).click();
	await page.getByRole("button", { name: "Trigger", exact: true }).click();
	await page.getByRole("button", { name: "Simulation", exact: true }).click();
	await expect(page.getByText(/Get Pixel Color .* x=-1920, y=-120/)).toBeVisible();
	await expect(page.getByText(/move mouse to x=-1600, y=-80/i)).toBeVisible();

	await page.getByRole("button", { name: "Export package" }).click();
	await page.getByRole("button", { name: "Next" }).click();
	await page.getByRole("button", { name: "Next" }).click();
	await expect(page.getByText("Verification passed. The package is being prepared.")).toBeVisible();
	await expect(page.getByRole("button", { name: "Download package" })).toBeVisible();
	const downloadPromise = page.waitForEvent("download");
	await page.getByRole("button", { name: "Download package" }).click();
	const download = await downloadPromise;
	const packagePath = testInfo.outputPath(download.suggestedFilename());
	await download.saveAs(packagePath);
	await page.getByRole("button", { name: "Close export" }).click();

	const zip = await JSZip.loadAsync(readFileSync(packagePath));
	const programEntry = zip.file("program.json");
	if (!programEntry) throw new Error("Exported package is missing program.json.");
	const program = JSON.parse(await programEntry.async("text"));
	const exportedSteps = program.entry.program.steps as Array<{
		action_type: string;
		config: Record<string, unknown>;
	}>;
	expect(exportedSteps.find((step) => step.action_type === "action.pixel.get")?.config).toMatchObject({
		x: "-1920",
		y: "-120",
	});
	expect(exportedSteps.find((step) => step.action_type === "action.mouse.move")?.config).toMatchObject({
		relative: false,
		x: "-1600",
		y: "-80",
	});

	await page.getByRole("button", { name: "Return to projects" }).click();
	await page.getByRole("button", { name: "Discard" }).click();
	await page.locator('input[type="file"]').setInputFiles(packagePath);
	await expect(page.getByRole("heading", { name: "Project already exists" })).toBeVisible();
	await page.getByRole("button", { name: "Replace" }).click();
	await expect(page.locator(".react-flow__node").filter({ hasText: "Get Pixel Color" })).toHaveCount(1);
	await expect(page.locator(".react-flow__node").filter({ hasText: "Move Mouse" })).toHaveCount(1);
	await page
		.locator(".react-flow__node")
		.filter({ hasText: "Get Pixel Color" })
		.dispatchEvent("click", { bubbles: true });
	await expect(page.getByRole("textbox", { name: "Screen X" })).toHaveValue("-1920");
	await expect(page.getByRole("textbox", { name: "Screen Y" })).toHaveValue("-120");
});

test("hotkey capture accepts plain and modified keys from the shared Windows catalog", async ({ page }) => {
	await openEditor(page);

	await page.getByRole("textbox", { name: "Search blocks" }).fill("Hotkey");
	await page.getByRole("button", { name: /Hotkey medium/ }).click();
	const keyInput = page.getByRole("textbox", { name: "Key" });

	await keyInput.press("a");
	await expect(keyInput).toHaveValue("A");
	await keyInput.press("Control+Shift+b");
	await expect(keyInput).toHaveValue("Ctrl+Shift+B");
	await keyInput.press(";");
	await expect(keyInput).toHaveValue("Semicolon");
	await keyInput.press("F1");
	await expect(keyInput).toHaveValue("F1");

	await page.keyboard.down("k");
	await page.keyboard.down("l");
	await expect(keyInput).toHaveValue("K+L");
	await page.keyboard.up("l");
	await page.keyboard.up("k");

	await page.keyboard.down("F1");
	await page.keyboard.down("t");
	await expect(keyInput).toHaveValue("F1+T");
	await page.keyboard.up("t");
	await page.keyboard.up("F1");
	await page.keyboard.down("Meta");
	await page.keyboard.down("Space");
	await expect(keyInput).toHaveValue("Windows+Space");
	await page.keyboard.up("Space");
	await page.keyboard.up("Meta");

	await page.getByRole("button", { name: "Verify script" }).click();
	await expect(page.getByText("Variable writes, calculations, and action configs are valid.")).toBeVisible();
});

test("keyboard and mouse actions share press hold and release controls", async ({ page }) => {
	await openEditor(page);

	await page.getByRole("textbox", { name: "Search blocks" }).fill("Keyboard");
	await page.getByRole("button", { name: /Keyboard high/ }).click();
	const inspector = page.getByRole("complementary", { name: "Inspector" });
	const keyboardAction = inspector.getByText("Input action", { exact: true }).locator("..").getByRole("button");
	await expect(keyboardAction).toContainText("Press and release");
	await keyboardAction.click();
	await page.getByRole("option", { name: "Press down" }).click();
	await expect(keyboardAction).toContainText("Press down");

	await page.getByRole("textbox", { name: "Search blocks" }).fill("Mouse Click");
	await page.getByRole("button", { name: /Mouse Click high/ }).click();
	const mouseAction = inspector.getByText("Input action", { exact: true }).locator("..").getByRole("button");
	const clickType = inspector.getByText("Click", { exact: true }).locator("..").getByRole("button");
	await expect(mouseAction).toContainText("Press and release");
	await expect(clickType).toBeVisible();

	await mouseAction.click();
	await page.getByRole("option", { name: "Press down" }).click();
	await expect(clickType).toHaveCount(0);

	await mouseAction.click();
	await page.getByRole("option", { name: "Release", exact: true }).click();
	await expect(clickType).toHaveCount(0);

	await mouseAction.click();
	await page.getByRole("option", { name: "Press and release" }).click();
	await expect(clickType).toBeVisible();
});

test("Windows key reference buttons build a key expression", async ({ page }) => {
	await openEditor(page);

	await page.getByRole("textbox", { name: "Search blocks" }).fill("Hotkey");
	await page.getByRole("button", { name: /Hotkey medium/ }).click();
	const keyInput = page.getByRole("textbox", { name: "Key" });
	await expect(keyInput).toHaveValue("");

	const keyReference = page.locator("details").filter({ hasText: "Supported key reference" });
	await keyReference.getByText("Supported key reference", { exact: true }).click();
	await keyReference.getByRole("button", { name: "Add Ctrl to key expression" }).click();
	await expect(keyInput).toHaveValue("Ctrl");
	await keyReference.getByRole("button", { name: "Add Shift to key expression" }).click();
	await expect(keyInput).toHaveValue("Ctrl+Shift");
	await keyReference.getByRole("button", { name: "Add F8 to key expression" }).click();
	await expect(keyInput).toHaveValue("Ctrl+Shift+F8");
});

test("Color Match fields combine a manual input with an anchored color picker", async ({ page }) => {
	await openEditor(page);

	await page.getByRole("button", { name: /Color Match low/ }).click();
	const actualColor = page.getByRole("textbox", { name: "Actual color" });
	const colorSwatch = page.getByRole("button", { name: "Open actual color color picker" });

	await expect(actualColor).toHaveValue("");
	await expect(colorSwatch).toHaveCSS(
		"background-image",
		"repeating-conic-gradient(rgba(114, 125, 149, 0.45) 0deg, rgba(114, 125, 149, 0.45) 25%, rgb(23, 27, 39) 0deg, rgb(23, 27, 39) 50%)",
	);
	const swatchBounds = await colorSwatch.boundingBox();
	const inputBounds = await actualColor.boundingBox();
	if (!swatchBounds || !inputBounds) throw new Error("Color Match input group is not visible.");
	expect(Math.abs(swatchBounds.height - inputBounds.height)).toBeLessThanOrEqual(1);
	expect(Math.abs(swatchBounds.x + swatchBounds.width - inputBounds.x)).toBeLessThanOrEqual(1);

	await colorSwatch.click();
	const picker = page.locator("[data-slot='popover-content']");
	await expect(picker).toBeVisible();
	const selection = picker.getByLabel("Actual color saturation and lightness");
	const selectionBounds = await selection.boundingBox();
	if (!selectionBounds) throw new Error("Color picker selection area is not visible.");
	await selection.click({
		position: { x: selectionBounds.width * 0.75, y: selectionBounds.height * 0.25 },
	});
	await expect(actualColor).not.toHaveValue("");

	await actualColor.fill("rgb(1, 2, 3)");
	await expect(colorSwatch).toHaveCSS("background-color", "rgb(1, 2, 3)");
});

test("verification reports graph errors when the script has no trigger", async ({ page }) => {
	await openEditor(page);

	await page.getByRole("button", { name: "Verify script" }).click();

	await expect(page.getByRole("heading", { name: "Verification" })).toBeVisible();
	const verificationDialog = page.getByRole("dialog");
	const triggerFinding = verificationDialog.getByText(
		"Canvas > Triggers: add at least one trigger node that can start the script.",
	);
	await expect(triggerFinding).toHaveCount(1);
	await expect(triggerFinding).toBeVisible();
	await expect(triggerFinding).toHaveCSS("user-select", "text");
	await expect(triggerFinding.locator("xpath=ancestor::*[@data-verification-result]")).toHaveCSS("user-select", "text");
	await expect(verificationDialog.getByRole("button", { name: "Copy Entry points result" })).toBeVisible();
	await expect(
		verificationDialog.getByText("Package export is blocked by the failed verification checks listed above."),
	).toBeVisible();
	await expect(
		verificationDialog
			.getByText("Verification found errors. Every issue and its location are listed below.", { exact: true })
			.first(),
	).toBeVisible();
});

test("manual trigger creation is limited to one node", async ({ page }) => {
	await openEditor(page);

	await page.getByRole("button", { name: "Manual" }).click();
	await page.getByRole("button", { name: "Manual" }).click();

	await expect(page.getByRole("heading", { name: "Manual Trigger Already Exists" })).toBeVisible();
	await expect(page.getByText("Remove the existing Manual Trigger before adding another one.")).toBeVisible();
});

test("verification warns for medium risk nodes", async ({ page }) => {
	await openEditor(page);

	await page.getByRole("button", { name: "Manual" }).click();
	await page.getByRole("textbox", { name: "Search blocks" }).fill("Clipboard");
	await page.getByRole("button", { name: "Set Clipboard medium" }).click();
	await page.getByRole("button", { name: "Verify script" }).click();

	await expect(page.getByRole("heading", { name: "Verification" })).toBeVisible();
	const verificationDialog = page.getByRole("dialog");
	await expect(verificationDialog.getByText(/Project permissions > .*: this permission has medium risk/)).toBeVisible();
	await expect(
		verificationDialog
			.getByText("Verification passed with warnings. Every warning and its location are listed below.")
			.first(),
	).toBeVisible();
	await expect(page.getByText("Warning", { exact: true })).toBeVisible();
});

test("comment text editing preserves caret position", async ({ page }) => {
	await openEditor(page);

	await page.getByTitle("Add comment").click();
	const commentEditor = page.getByPlaceholder("Write a note...");
	await expect(commentEditor).toHaveCSS("font-size", "14px");
	await page.getByRole("button", { name: "Increase comment font size" }).click();
	await expect(commentEditor).toHaveCSS("font-size", "15px");
	const fontSizeInput = page.getByRole("spinbutton", { name: "Comment font size" });
	await expect(fontSizeInput).toHaveValue("15");
	await fontSizeInput.fill("48");
	await fontSizeInput.press("Enter");
	await expect(commentEditor).toHaveCSS("font-size", "48px");
	await expect(fontSizeInput).toHaveValue("48");
	await fontSizeInput.fill("999");
	await fontSizeInput.press("Enter");
	await expect(commentEditor).toHaveCSS("font-size", "72px");
	await expect(fontSizeInput).toHaveValue("72");
	await fontSizeInput.fill("1");
	await fontSizeInput.press("Enter");
	await expect(commentEditor).toHaveCSS("font-size", "12px");
	await expect(fontSizeInput).toHaveValue("12");
	await fontSizeInput.fill("abc");
	await fontSizeInput.press("Enter");
	await expect(commentEditor).toHaveCSS("font-size", "12px");
	await expect(fontSizeInput).toHaveValue("12");

	const colorControls = page.getByRole("button", { name: /Set comment color to/ });
	await expect(colorControls).toHaveCount(5);
	for (const control of await colorControls.all()) {
		const box = await control.boundingBox();
		if (!box) {
			throw new Error("Comment color control is not visible.");
		}
		expect(box.width).toBeGreaterThanOrEqual(24);
		expect(box.height).toBeGreaterThanOrEqual(24);
	}
	const decreaseFontControl = page.getByRole("button", { name: "Decrease comment font size" });
	const decreaseFontBox = await decreaseFontControl.boundingBox();
	const firstColorBox = await colorControls.first().boundingBox();
	const secondColorBox = await colorControls.nth(1).boundingBox();
	if (!decreaseFontBox || !firstColorBox || !secondColorBox) {
		throw new Error("Comment controls are not visible.");
	}
	expect(decreaseFontBox.x).toBeLessThan(firstColorBox.x);

	const commentNode = page.locator(".baud-comment-flow-node");
	const commentNodeBeforeGapDrag = await commentNode.boundingBox();
	if (!commentNodeBeforeGapDrag) {
		throw new Error("Comment node is not visible.");
	}
	const colorGap = {
		x: (firstColorBox.x + firstColorBox.width + secondColorBox.x) / 2,
		y: firstColorBox.y + firstColorBox.height / 2,
	};
	await page.mouse.move(colorGap.x, colorGap.y);
	await page.mouse.down();
	await page.mouse.move(colorGap.x + 48, colorGap.y + 32);
	await page.mouse.up();
	const commentNodeAfterGapDrag = await commentNode.boundingBox();
	if (!commentNodeAfterGapDrag) {
		throw new Error("Comment node is not visible after using the color controls.");
	}
	expect(commentNodeAfterGapDrag.x).toBeCloseTo(commentNodeBeforeGapDrag.x, 5);
	expect(commentNodeAfterGapDrag.y).toBeCloseTo(commentNodeBeforeGapDrag.y, 5);

	const blueControl = page.getByRole("button", { name: "Set comment color to Blue" });
	await blueControl.click();
	await expect(blueControl).toHaveAttribute("aria-pressed", "true");
	await expect(page.locator(".baud-comment-drag-handle").getByText("Comment", { exact: true })).toHaveCSS(
		"font-size",
		"18px",
	);

	for (const controlName of ["Decrease comment font size", "Increase comment font size", "Delete comment"]) {
		const box = await page.getByRole("button", { name: controlName }).boundingBox();
		if (!box) {
			throw new Error(`${controlName} control is not visible.`);
		}
		if (controlName === "Delete comment") {
			expect(box.width).toBeGreaterThanOrEqual(36);
			expect(box.height).toBeGreaterThanOrEqual(36);
		} else {
			expect(box.width).toBeGreaterThanOrEqual(20);
			expect(box.width).toBeLessThanOrEqual(24);
			expect(box.height).toBeGreaterThanOrEqual(32);
		}
	}
	const deleteIconBox = await page.getByRole("button", { name: "Delete comment" }).locator("svg").boundingBox();
	if (!deleteIconBox) {
		throw new Error("Delete comment icon is not visible.");
	}
	expect(deleteIconBox.width).toBeGreaterThanOrEqual(24);
	expect(deleteIconBox.height).toBeGreaterThanOrEqual(24);
	const resizeControlBox = await page.getByRole("button", { name: "Resize comment" }).boundingBox();
	if (!resizeControlBox) {
		throw new Error("Resize comment control is not visible.");
	}
	expect(resizeControlBox.width).toBeGreaterThanOrEqual(24);
	expect(resizeControlBox.height).toBeGreaterThanOrEqual(24);

	await commentEditor.fill("abcdef");
	await commentEditor.evaluate((element) => {
		if (!(element instanceof HTMLTextAreaElement)) {
			throw new Error("Comment editor is not a textarea.");
		}

		element.setSelectionRange(3, 3);
	});
	await commentEditor.pressSequentially("XYZ");

	await expect(commentEditor).toHaveValue("abcXYZdef");
});

test("comment nodes support node context menu actions", async ({ page }) => {
	await openEditor(page);

	await page.getByTitle("Add comment").click();
	const commentEditors = page.getByPlaceholder("Write a note...");
	await commentEditors.first().fill("Comment menu note");
	await commentEditors.first().evaluate((element) => {
		if (!(element instanceof HTMLTextAreaElement)) {
			throw new Error("Comment editor is not a textarea.");
		}

		element.blur();
	});

	const commentHandles = page.locator(".baud-comment-drag-handle").getByText("Comment", { exact: true });
	await commentHandles.first().click({ button: "right" });
	const nodeMenu = page.getByRole("menu", { name: "Node actions" });
	await expect(nodeMenu).toBeVisible();
	await page.getByRole("menuitem", { name: /^Copy$/ }).click();
	await expect(nodeMenu).toBeHidden();

	const paneBox = await page.locator(".react-flow__pane").boundingBox();
	if (!paneBox) {
		throw new Error("React Flow pane is not visible.");
	}

	await page.locator(".react-flow__pane").dispatchEvent("contextmenu", {
		bubbles: true,
		button: 2,
		cancelable: true,
		clientX: paneBox.x + paneBox.width - 96,
		clientY: paneBox.y + 96,
	});
	const canvasNodeMenu = page.getByRole("dialog", { name: "Add node" });
	await expect(canvasNodeMenu).toBeVisible();
	await expect(page.getByRole("textbox", { name: "Search nodes" })).toBeFocused();
	const pasteMenuItem = page.getByRole("button", { name: "Paste copied node" });
	await expect(pasteMenuItem).toBeEnabled();
	await pasteMenuItem.click();

	await expect(commentEditors).toHaveCount(2);
	await expect(commentEditors.nth(1)).toHaveValue("Comment menu note");

	await commentHandles.first().click({ button: "right" });
	await page.getByRole("menuitem", { name: "Duplicate" }).click();
	await expect(commentEditors).toHaveCount(3);

	await commentHandles.first().click({ button: "right" });
	await page.getByRole("menuitem", { name: "Delete" }).click();
	await expect(commentEditors).toHaveCount(2);
});

test("empty canvas context menu searches and adds nodes", async ({ page }) => {
	await openEditor(page);

	const pane = page.locator(".react-flow__pane");
	const paneBox = await pane.boundingBox();
	if (!paneBox) {
		throw new Error("React Flow pane is not visible.");
	}

	await page.mouse.click(paneBox.x + 100, paneBox.y + paneBox.height / 2, { button: "right" });

	const nodeBrowser = page.getByRole("dialog", { name: "Add node" });
	await expect(nodeBrowser).toBeVisible();
	await expect(nodeBrowser.getByRole("button", { name: "Paste copied node" })).toBeDisabled();
	await expect(nodeBrowser.getByText("Triggers", { exact: true })).toBeVisible();
	await expect(nodeBrowser.getByText("Control Flow", { exact: true })).toBeVisible();

	const search = page.getByRole("textbox", { name: "Search nodes" });
	await search.fill("HTTP Request");
	await nodeBrowser.getByRole("button", { name: /HTTP Request/ }).click();

	await expect(nodeBrowser).toBeHidden();
	const httpNodes = page.locator(".react-flow__node").filter({ hasText: "HTTP Request" });
	await expect(httpNodes).toHaveCount(1);

	await httpNodes.first().click({ button: "right" });
	await page.getByRole("menuitem", { name: /^Copy$/ }).click();
	await pane.dispatchEvent("contextmenu", {
		bubbles: true,
		button: 2,
		cancelable: true,
		clientX: paneBox.x + paneBox.width - 80,
		clientY: paneBox.y + paneBox.height - 80,
	});
	await page.getByRole("button", { name: "Paste copied node" }).click();

	await expect(httpNodes).toHaveCount(2);
	const nodeIds = await httpNodes.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-id")));
	expect(new Set(nodeIds).size).toBe(2);
	for (const nodeId of nodeIds) {
		expect(nodeId).toMatch(/^n-[a-z0-9]+(?:-[a-z0-9]+)?$/);
		expect(nodeId?.length).toBeLessThanOrEqual(16);
	}
});

test("keyboard paste uses the canvas pointer and falls back to the canvas center", async ({ page }) => {
	await openEditor(page);

	const pane = page.locator(".react-flow__pane");
	const paneBox = await pane.boundingBox();
	if (!paneBox) {
		throw new Error("React Flow pane is not visible.");
	}

	await page.mouse.click(paneBox.x + 100, paneBox.y + paneBox.height / 2, { button: "right" });
	await page.getByRole("textbox", { name: "Search nodes" }).fill("HTTP Request");
	await page
		.getByRole("dialog", { name: "Add node" })
		.getByRole("button", { name: /HTTP Request/ })
		.click();
	const httpNodes = page.locator(".react-flow__node").filter({ hasText: "HTTP Request" });
	await expect(httpNodes).toHaveCount(1);
	const sourceNodeId = await httpNodes.first().getAttribute("data-id");
	if (!sourceNodeId) {
		throw new Error("Source HTTP Request node has no id.");
	}
	await page.keyboard.press("Control+c");

	const pointerTarget = await page.evaluate(() => {
		const paneElement = document.querySelector(".react-flow__pane");
		if (!(paneElement instanceof HTMLElement)) {
			return null;
		}

		const bounds = paneElement.getBoundingClientRect();
		for (let y = bounds.bottom - 80; y >= bounds.top + 80; y -= 40) {
			for (let x = bounds.right - 80; x >= bounds.left + 160; x -= 40) {
				const pointedElement = document.elementFromPoint(x, y);
				if (pointedElement?.closest(".react-flow__pane, .react-flow__background")) {
					return { x, y };
				}
			}
		}

		return null;
	});
	if (!pointerTarget) {
		throw new Error("No unobstructed canvas position is available for pointer paste.");
	}
	await page.mouse.move(pointerTarget.x - 20, pointerTarget.y - 20);
	await page.mouse.move(pointerTarget.x, pointerTarget.y);
	await page.keyboard.press("Control+v");

	await expect(httpNodes).toHaveCount(2);
	const pointerPasteNodeId = (await httpNodes.evaluateAll(
		(nodes, sourceId) => nodes.map((node) => node.getAttribute("data-id")).find((nodeId) => nodeId !== sourceId),
		sourceNodeId,
	)) as string | undefined;
	if (!pointerPasteNodeId) {
		throw new Error("Pointer-positioned HTTP Request node has no id.");
	}
	const pointerPasteBox = await page.locator(`.react-flow__node[data-id="${pointerPasteNodeId}"]`).boundingBox();
	if (!pointerPasteBox) {
		throw new Error("Pasted HTTP Request node is not visible.");
	}
	expect(Math.abs(pointerPasteBox.x + pointerPasteBox.width / 2 - pointerTarget.x)).toBeLessThan(4);
	expect(Math.abs(pointerPasteBox.y + pointerPasteBox.height / 2 - pointerTarget.y)).toBeLessThan(40);

	await page.mouse.move(8, 8);
	await page.keyboard.press("Control+v");

	await expect(httpNodes).toHaveCount(3);
	const centeredPasteNodeId = (await httpNodes.evaluateAll(
		(nodes, existingIds) =>
			nodes
				.map((node) => node.getAttribute("data-id"))
				.find((nodeId) => nodeId !== existingIds.source && nodeId !== existingIds.pointerPaste),
		{ pointerPaste: pointerPasteNodeId, source: sourceNodeId },
	)) as string | undefined;
	if (!centeredPasteNodeId) {
		throw new Error("Centered HTTP Request node has no id.");
	}
	const centeredPasteBox = await page.locator(`.react-flow__node[data-id="${centeredPasteNodeId}"]`).boundingBox();
	if (!centeredPasteBox) {
		throw new Error("Centered HTTP Request node is not visible.");
	}
	expect(Math.abs(centeredPasteBox.x + centeredPasteBox.width / 2 - (paneBox.x + paneBox.width / 2))).toBeLessThan(4);
	expect(Math.abs(centeredPasteBox.y + centeredPasteBox.height / 2 - (paneBox.y + paneBox.height / 2))).toBeLessThan(
		40,
	);
});

test("copy and paste preserves a selected graph fragment", async ({ page }) => {
	await openEditor(page);

	const pane = page.locator(".react-flow__pane");
	const paneBox = await pane.boundingBox();
	if (!paneBox) {
		throw new Error("React Flow pane is not visible.");
	}
	const addNode = async (name: string, x: number, y: number) => {
		await page.mouse.click(x, y, { button: "right" });
		const browser = page.getByRole("dialog", { name: "Add node" });
		await browser.getByRole("textbox", { name: "Search nodes" }).fill(name);
		await browser.getByRole("button", { name: new RegExp(name) }).click();
	};

	await addNode("Log", paneBox.x + 100, paneBox.y + paneBox.height / 2);
	await addNode("HTTP Request", paneBox.x + paneBox.width - 100, paneBox.y + paneBox.height / 2);

	const logNodes = page.locator(".react-flow__node").filter({ hasText: "Log" });
	const httpNodes = page.locator(".react-flow__node").filter({ hasText: "HTTP Request" });
	const originalLogId = await logNodes.first().getAttribute("data-id");
	const originalHttpId = await httpNodes.first().getAttribute("data-id");
	if (!originalLogId || !originalHttpId) {
		throw new Error("Source graph nodes have no ids.");
	}

	await logNodes.first().locator(".react-flow__handle.source").first().dispatchEvent("click", { bubbles: true });
	await httpNodes.first().locator(".react-flow__handle.target").first().dispatchEvent("click", { bubbles: true });
	const edges = page.locator(".react-flow__edge");
	await expect(edges).toHaveCount(1);

	await logNodes.first().dispatchEvent("click", { bubbles: true });
	await page.keyboard.down("Control");
	await httpNodes.first().dispatchEvent("click", { bubbles: true, ctrlKey: true });
	await edges.first().dispatchEvent("click", { bubbles: true, ctrlKey: true });
	await page.keyboard.up("Control");
	await expect(page.locator(".react-flow__node.selected")).toHaveCount(2);
	await expect(page.locator(".react-flow__edge.selected")).toHaveCount(1);

	const originalLogBox = await page.locator(`.react-flow__node[data-id="${originalLogId}"]`).boundingBox();
	const originalHttpBox = await page.locator(`.react-flow__node[data-id="${originalHttpId}"]`).boundingBox();
	if (!originalLogBox || !originalHttpBox) {
		throw new Error("Source graph nodes are not visible.");
	}
	expect(Math.abs(originalHttpBox.x - originalLogBox.x)).toBeGreaterThan(100);
	await page.keyboard.press("Control+c");
	await page.mouse.move(paneBox.x + paneBox.width / 2, paneBox.y + paneBox.height - 80);
	await page.keyboard.press("Control+v");

	await expect(logNodes).toHaveCount(2);
	await expect(httpNodes).toHaveCount(2);
	await expect(edges).toHaveCount(2);
	const copiedLogId = (await logNodes.evaluateAll(
		(nodes, sourceId) => nodes.map((node) => node.getAttribute("data-id")).find((id) => id !== sourceId),
		originalLogId,
	)) as string | undefined;
	const copiedHttpId = (await httpNodes.evaluateAll(
		(nodes, sourceId) => nodes.map((node) => node.getAttribute("data-id")).find((id) => id !== sourceId),
		originalHttpId,
	)) as string | undefined;
	if (!copiedLogId || !copiedHttpId) {
		throw new Error("Copied graph nodes have no ids.");
	}

	const copiedLogBox = await page.locator(`.react-flow__node[data-id="${copiedLogId}"]`).boundingBox();
	const copiedHttpBox = await page.locator(`.react-flow__node[data-id="${copiedHttpId}"]`).boundingBox();
	if (!copiedLogBox || !copiedHttpBox) {
		throw new Error("Copied graph nodes are not visible.");
	}
	expect(copiedHttpBox.x - copiedLogBox.x).toBeCloseTo(originalHttpBox.x - originalLogBox.x, 5);
	expect(copiedHttpBox.y - copiedLogBox.y).toBeCloseTo(originalHttpBox.y - originalLogBox.y, 5);

	const selectedNodeIds = await page
		.locator(".react-flow__node.selected")
		.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-id")));
	expect(new Set(selectedNodeIds)).toEqual(new Set([copiedLogId, copiedHttpId]));
	await expect(page.locator(".react-flow__edge.selected")).toHaveCount(1);
	await expect(page.getByRole("group", { name: `Edge from ${copiedLogId} to ${copiedHttpId}` })).toHaveCount(1);

	await page.keyboard.press("Delete");
	await expect(logNodes).toHaveCount(1);
	await expect(httpNodes).toHaveCount(1);
	await expect(edges).toHaveCount(1);

	await page.keyboard.press("Control+z");
	await expect(logNodes).toHaveCount(2);
	await expect(httpNodes).toHaveCount(2);
	await expect(edges).toHaveCount(2);
	await expect(page.getByRole("group", { name: `Edge from ${copiedLogId} to ${copiedHttpId}` })).toHaveCount(1);

	await page.keyboard.press("Control+z");
	await expect(logNodes).toHaveCount(1);
	await expect(httpNodes).toHaveCount(1);
	await expect(edges).toHaveCount(1);

	await page.keyboard.press("Control+Shift+z");
	await expect(logNodes).toHaveCount(2);
	await expect(httpNodes).toHaveCount(2);
	await expect(edges).toHaveCount(2);
	await expect(page.getByRole("group", { name: `Edge from ${copiedLogId} to ${copiedHttpId}` })).toHaveCount(1);
});

test("control click keeps multiple nodes selected and opens the clicked node properties", async ({ page }) => {
	await openEditor(page);

	const pane = page.locator(".react-flow__pane");
	const paneBox = await pane.boundingBox();
	if (!paneBox) {
		throw new Error("React Flow pane is not visible.");
	}
	const addNode = async (name: string, x: number) => {
		await page.mouse.click(x, paneBox.y + paneBox.height / 2, { button: "right" });
		const browser = page.getByRole("dialog", { name: "Add node" });
		await browser.getByRole("textbox", { name: "Search nodes" }).fill(name);
		await browser.getByRole("button", { name: new RegExp(name) }).click();
	};

	await addNode("Log", paneBox.x + 180);
	await addNode("HTTP Request", paneBox.x + paneBox.width / 2);
	await addNode("Delay", paneBox.x + paneBox.width - 180);

	const logNode = page.locator(".react-flow__node").filter({ hasText: "Log" }).first();
	const httpNode = page.locator(".react-flow__node").filter({ hasText: "HTTP Request" }).first();
	const delayNode = page.locator(".react-flow__node").filter({ hasText: "Delay" }).first();

	await logNode.click();
	await page.keyboard.down("Control");
	await httpNode.click();
	await delayNode.click();
	await page.keyboard.up("Control");

	await expect(page.locator(".react-flow__node.selected")).toHaveCount(3);
	await expect(page.getByRole("heading", { name: "Delay" })).toBeVisible();
});

test("a node cannot connect its output to its own input", async ({ page }) => {
	await openEditor(page);

	const pane = page.locator(".react-flow__pane");
	const paneBox = await pane.boundingBox();
	if (!paneBox) {
		throw new Error("React Flow pane is not visible.");
	}

	await page.mouse.click(paneBox.x + paneBox.width / 2, paneBox.y + paneBox.height / 2, { button: "right" });
	const browser = page.getByRole("dialog", { name: "Add node" });
	await browser.getByRole("textbox", { name: "Search nodes" }).fill("Log");
	await browser.getByRole("button", { name: /^Log/ }).click();

	const logNode = page.locator(".react-flow__node").filter({ hasText: "Log" }).first();
	await logNode.locator(".react-flow__handle.source").first().dispatchEvent("click", { bubbles: true });
	await logNode.locator(".react-flow__handle.target").first().dispatchEvent("click", { bubbles: true });

	await expect(page.locator(".react-flow__edge")).toHaveCount(0);
});

test("fan-out execution order can be changed from the edge inspector", async ({ page }) => {
	await openEditor(page);

	await page.getByRole("button", { name: "Manual" }).click();
	await page.getByRole("textbox", { name: "Search blocks" }).fill("Log");
	await page.getByRole("button", { name: /^Log/ }).click();
	await page.getByRole("textbox", { name: "Search blocks" }).fill("HTTP Request");
	await page.getByRole("button", { name: /HTTP Request/ }).click();

	const manualNode = page.locator(".react-flow__node").filter({ hasText: "Manual" }).first();
	const logNode = page.locator(".react-flow__node").filter({ hasText: "Log" }).first();
	const httpNode = page.locator(".react-flow__node").filter({ hasText: "HTTP Request" }).first();
	const sourceHandle = manualNode.locator(".react-flow__handle.source").first();
	const manualNodeId = await manualNode.getAttribute("data-id");
	const httpNodeId = await httpNode.getAttribute("data-id");
	if (!manualNodeId || !httpNodeId) {
		throw new Error("Fan-out graph nodes have no ids.");
	}

	await sourceHandle.dispatchEvent("click", { bubbles: true });
	await logNode.locator(".react-flow__handle.target").first().dispatchEvent("click", { bubbles: true });
	await sourceHandle.dispatchEvent("click", { bubbles: true });
	await httpNode.locator(".react-flow__handle.target").first().dispatchEvent("click", { bubbles: true });

	await expect(page.locator(".react-flow__edge")).toHaveCount(2);
	await page.locator(".react-flow__edge").last().dispatchEvent("click", { bubbles: true });
	const orderList = page.getByRole("list", { name: /Execution order for Manual.*output out/ });
	await expect(orderList).toBeVisible();
	await expect(orderList.locator("li").nth(0)).toContainText("Log");
	await expect(orderList.locator("li").nth(1)).toContainText("HTTP Request");
	await expect(page.locator(".react-flow__edge-text")).toHaveText(["1", "2"]);

	await page.getByRole("button", { name: "Move HTTP Request earlier" }).click();
	await expect(orderList.locator("li").nth(0)).toContainText("HTTP Request");
	await expect(orderList.locator("li").nth(1)).toContainText("Log");
	await expect(page.locator(".react-flow__edge-text")).toHaveText(["2", "1"]);

	await page.keyboard.press("Control+z");
	await expect(page.locator(".react-flow__edge-text")).toHaveText(["1", "2"]);
	await page.locator(".react-flow__edge").last().dispatchEvent("click", { bubbles: true });
	await expect(orderList.locator("li").nth(0)).toContainText("Log");
	await expect(orderList.locator("li").nth(1)).toContainText("HTTP Request");

	await page.keyboard.press("Control+y");
	await expect(page.locator(".react-flow__edge-text")).toHaveText(["2", "1"]);
	await page.locator(".react-flow__edge").last().dispatchEvent("click", { bubbles: true });
	await expect(orderList.locator("li").nth(0)).toContainText("HTTP Request");
	await expect(orderList.locator("li").nth(1)).toContainText("Log");
});

test("asset editor shows content checks without fixed size caps", async ({ page }) => {
	await openEditor(page);

	await page.getByRole("button", { name: "Open asset editor" }).click();

	await expect(page.getByRole("heading", { name: "Asset Editor" })).toBeVisible();
	await expect(page.getByText("Package checks")).toBeVisible();
	await expect(page.getByText("No fixed editor cap")).toBeVisible();
	await expect(page.getByText("content signature")).toBeVisible();
});

test("hostile package import is rejected before loading", async ({ page }, testInfo) => {
	const packagePath = testInfo.outputPath("malformed-package.bbs");
	const zip = new JSZip();
	zip.file("manifest.json", JSON.stringify({ name: "malformed" }));
	zip.file("program.json", "{not valid json");
	zip.file("assets/../evil.txt", "evil");
	writeFileSync(packagePath, await zip.generateAsync({ type: "nodebuffer" }));

	await page.goto("/");
	await page.locator('input[type="file"]').setInputFiles(packagePath);

	await expect(page.getByRole("heading", { name: "Import Rejected" })).toBeVisible();
	await expect(page.getByText("assets/../: package entry path contains an unsafe segment.").first()).toBeVisible();
	await expect(page.getByText("Package Read")).toBeVisible();
});

test("exported package preserves editor metadata and imports back", async ({ page }, testInfo) => {
	await openEditor(page);

	await page.getByRole("button", { name: "Manual" }).click();
	await openProjectSettingsTab(page, "Default Variables");
	await page.getByRole("button", { name: "Add variable" }).click();
	await page.getByRole("textbox", { name: "Name" }).fill("counter");
	await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
	await page.getByRole("combobox", { name: "Scope" }).click();
	await page.getByRole("option", { name: "persistent" }).click();
	await page.getByRole("combobox", { name: "Type" }).click();
	await page.getByRole("option", { name: "integer" }).click();
	await page.getByRole("spinbutton", { name: "Default value" }).fill("10");
	await page.getByRole("button", { name: "Save", exact: true }).click();
	await page.getByRole("button", { name: "Save Settings" }).click();
	await page.getByTitle("Add comment").click();
	await page.getByPlaceholder("Write a note...").fill("Round-trip comment");
	await page.getByRole("button", { name: "Edge style" }).click();
	await page.getByRole("option", { name: "Bezier" }).click();
	await page.getByRole("button", { name: "Export package" }).click();
	await expect(page.getByRole("heading", { name: "Export .bbs" })).toBeVisible();
	await page.getByRole("button", { name: "Next" }).click();
	await page.getByRole("button", { name: "Next" }).click();
	await expect(page.getByText("Verification passed. The package is being prepared.")).toBeVisible();
	await expect(page.getByRole("button", { name: "Download package" })).toBeVisible();

	const downloadPromise = page.waitForEvent("download");
	await page.getByRole("button", { name: "Download package" }).click();
	const download = await downloadPromise;
	const packagePath = testInfo.outputPath(download.suggestedFilename());
	await download.saveAs(packagePath);
	await page.getByRole("button", { name: "Close export" }).click();

	const zip = await JSZip.loadAsync(readFileSync(packagePath));
	const editorEntry = zip.file("editor.json");
	if (!editorEntry) {
		throw new Error("Exported package is missing editor.json.");
	}
	const editorJson = JSON.parse(await editorEntry.async("text"));
	assertEditorMetadata(editorJson);
	const manifestEntry = zip.file("manifest.json");
	if (!manifestEntry) {
		throw new Error("Exported package is missing manifest.json.");
	}
	const manifestJson = JSON.parse(await manifestEntry.async("text"));
	expect(manifestJson.variables).toEqual([
		{
			description: "",
			name: "counter",
			scope: "persistent",
			type: "integer",
			value: 10,
		},
	]);

	await page.getByRole("button", { name: "Return to projects" }).click();
	await page.getByRole("button", { name: "Discard" }).click();
	await page.locator('input[type="file"]').setInputFiles(packagePath);
	await expect(page.getByRole("heading", { name: "Project already exists" })).toBeVisible();
	await page.getByRole("button", { name: "Replace" }).click();
	await expect(page).toHaveURL(new RegExp(`/projects/${manifestJson.id}$`));
	await expect(page.getByText("saved", { exact: true })).toBeVisible();
	await expect(page.getByPlaceholder("Write a note...")).toHaveValue("Round-trip comment");
	await page.getByRole("button", { name: "Variables", exact: true }).click();
	await expect(page.locator('[data-variable-name="counter"]')).toBeVisible();

	await page.getByRole("button", { name: "Return to projects" }).click();
	await page.locator('input[type="file"]').setInputFiles(packagePath);
	await expect(page.getByRole("heading", { name: "Project already exists" })).toBeVisible();
	await page.getByRole("button", { name: "Import copy" }).click();
	await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+$/);
	const copiedProjectId = page.url().split("/").at(-1);
	expect(copiedProjectId).not.toBe(manifestJson.id);

	await page.getByRole("button", { name: "Return to projects" }).click();
	await page.locator('input[type="file"]').setInputFiles(packagePath);
	await expect(page.getByRole("heading", { name: "Project already exists" })).toBeVisible();
	await page.getByRole("button", { name: "Open existing" }).click();
	await expect(page).toHaveURL(new RegExp(`/projects/${manifestJson.id}$`));
});
test("verification modal remains usable on a 1080p-height viewport", async ({ page }) => {
	await page.setViewportSize({ width: 1366, height: 768 });
	await openEditor(page);

	await page.getByRole("button", { name: "Verify script" }).click();

	await expect(page.getByRole("heading", { name: "Verification" })).toBeVisible();
	await expect(page.getByRole("button", { name: "Close verification" })).toBeVisible();
	await page.getByRole("button", { name: "Close verification" }).click();
	await expect(page.getByRole("heading", { name: "Verification" })).toBeHidden();
});

test("package import rejects unmanifested asset files", async ({ page }, testInfo) => {
	const packagePath = testInfo.outputPath("unmanifested-asset-package.bbs");
	const zip = new JSZip();

	addMinimalPackageDocuments(zip);
	zip.file("assets/orphan.txt", "orphaned asset content");
	writeFileSync(packagePath, await zip.generateAsync({ type: "nodebuffer" }));

	await page.goto("/");
	await page.locator('input[type="file"]').setInputFiles(packagePath);

	await expect(page.getByRole("heading", { name: "Import Rejected" })).toBeVisible();
	await expect(page.getByText("assets/orphan.txt: asset file is not declared in manifest.json assets.")).toBeVisible();
});

function addMinimalPackageDocuments(zip: JSZip) {
	zip.file(
		"manifest.json",
		JSON.stringify({
			created_at: "2026-01-01T00:00:00.000Z",
			created_with: "BaudBound Editor Test",
			format_version: 1,
			id: "c86851ce-b2e5-4385-91cb-e0564040cdfb",
			minimum_runner_version: "2.0.0",
			name: "Asset Validation Test",
			script_language_version: 1,
		}),
	);
	const trigger = {
		action_type: "trigger.manual",
		config: {},
		id: "n-trigger",
		runtime_outputs: [],
		type: "manual",
	};
	zip.file(
		"program.json",
		JSON.stringify({
			entry: {
				program: {
					edges: [],
					execution_model: "directed_graph",
					runtime_context: {
						built_in_variables: { syntax: "{{variable_name}}", variables: [] },
						expression_reference: "{{node-id.data_name}}",
						node_outputs: [],
						template_reference: "{{node-id.data_name}}",
						variables: [],
					},
					steps: [],
					type: "block",
				},
				trigger,
				triggers: [trigger],
			},
		}),
	);
	zip.file("permissions.json", JSON.stringify({ declared_permissions: [], risk_level: "low" }));
	zip.file(
		"capabilities.json",
		JSON.stringify({
			required_capabilities: ["trigger.manual"],
			target_runtimes: ["Windows Desktop", "Linux Desktop"],
		}),
	);
}

async function openEditor(page: Page) {
	await page.goto("/");
	await page.getByRole("button", { name: "New project" }).click();
	await page.getByRole("button", { name: "Create project" }).click();
	await expect(page.getByRole("button", { name: "Open asset editor" })).toBeVisible();
}

async function openProjectSettingsTab(page: Page, tab: "Default Variables" | "Secrets" | "Script Settings") {
	await page.getByRole("button", { name: "Open project settings" }).click();
	await page.getByRole("tab", { name: tab }).click();
}

async function addTextScriptSetting(page: Page, name: string, simulationValue: string) {
	await page.getByRole("button", { name: "Add setting" }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByRole("textbox", { name: "Name" }).fill(name);
	await dialog.getByRole("switch", { name: "Use Simulation override" }).click();
	await dialog.getByRole("textbox", { name: "Simulation override" }).fill(simulationValue);
	await dialog.getByRole("button", { name: "Save", exact: true }).click();
}

async function readPanelPreferences(page: Page) {
	return page.evaluate(async () => {
		const request = indexedDB.open("baudbound-editor", 1);
		const database = await new Promise<IDBDatabase>((resolve, reject) => {
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		const transaction = database.transaction("preferences", "readonly");
		const resultRequest = transaction.objectStore("preferences").get("panel-layout.v1");
		const result = await new Promise<{ value?: { collapsed?: unknown } } | undefined>((resolve, reject) => {
			resultRequest.onsuccess = () => resolve(resultRequest.result);
			resultRequest.onerror = () => reject(resultRequest.error);
		});
		database.close();
		return result?.value?.collapsed ?? null;
	});
}

function assertEditorMetadata(editorJson: unknown) {
	expect(editorJson).toMatchObject({
		canvas: {
			edge_style: "bezier",
		},
		comments: [
			expect.objectContaining({
				text: "Round-trip comment",
			}),
		],
	});
}
