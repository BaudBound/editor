import { RotateCw } from "lucide-react";
import { defineNode } from "../../node-definition";
import { createConditionRow } from "../rows";
import { validateConditionRowsConfig, validateConditionVariableInputs, validateLoopBodyDoesNotReturn } from "../shared";

export const whileNode = defineNode({
	actionType: "control.while",
	capabilities: ["runtime.while"],
	controlType: "while",
	defaultConfig: () => ({ conditions: [createConditionRow()] }),
	description: "Repeat a branch while conditions pass.",
	group: "control",
	icon: RotateCw,
	kind: "control",
	label: "While",
	portPolicy: { kind: "fixed", inputs: ["input"], outputs: ["done", "loop"] },
	risk: "low",
	runtimeOutputs: [
		{
			name: "index",
			type: "integer",
			description: "Zero-based index for the active while-loop pass.",
			example: "n-mr3zyt6f-7.index",
		},
	],
	validateConfig: (config) => validateConditionRowsConfig(config, "while", true),
	validateVariables: validateConditionVariableInputs,
	validateGraph: ({ context, node }) => validateLoopBodyDoesNotReturn(node.id, context.edges, "loop"),
});
