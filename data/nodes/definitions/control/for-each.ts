import { Repeat2 } from "lucide-react";
import { validateListExpression } from "../../list-expression";
import { defineNode } from "../../node-definition";
import { validateLoopBodyDoesNotReturn } from "../shared";

export const forEachNode = defineNode({
	actionType: "control.for_each",
	capabilities: ["runtime.for_each"],
	configFields: [
		{
			key: "items",
			label: "Items",
			type: "textarea",
			usesVariables: true,
			variableTypes: "list",
			validate: (config) => validateListExpression(config.items, "Items"),
		},
	],
	controlType: "for_each",
	defaultConfig: () => ({ items: "" }),
	description: "Loop through every item in a list.",
	group: "control",
	icon: Repeat2,
	kind: "control",
	label: "For Each",
	portPolicy: { kind: "fixed", inputs: ["input"], outputs: ["done", "loop"] },
	risk: "low",
	runtimeOutputs: [
		{
			name: "item",
			type: "object",
			description: "Current list item for the active iteration.",
			example: "n-mr3zyt6f-8.item",
		},
		{
			name: "index",
			type: "number",
			description: "Zero-based index for the active iteration.",
			example: "n-mr3zyt6f-8.index",
		},
	],
	validateGraph: ({ context, node }) => validateLoopBodyDoesNotReturn(node.id, context.edges, "loop"),
});
