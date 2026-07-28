import { expect, test } from "@playwright/test";
import { renameVariableReferences } from "@/utils/variable-reference-renaming";

test("variable renaming updates exact and nested references throughout structured config", () => {
	const config = {
		body: {
			rows: [
				"{{ inventory }}",
				"{{inventory.items[0].name}}",
				"{{inventory_backup}}",
				"prefix {{inventory.value}} suffix",
			],
		},
		enabled: true,
	};

	expect(renameVariableReferences(config, { from: "inventory", to: "stock" })).toEqual({
		body: {
			rows: ["{{ stock }}", "{{stock.items[0].name}}", "{{inventory_backup}}", "prefix {{stock.value}} suffix"],
		},
		enabled: true,
	});
});

test("variable renaming preserves unchanged config identity", () => {
	const config = { message: "{{other_variable}}" };

	expect(renameVariableReferences(config, { from: "inventory", to: "stock" })).toBe(config);
});
