import { Repeat2 } from "lucide-react";
import { defineNode } from "../../node-definition";
import { validateLoopBodyDoesNotReturn } from "../shared";
import { staticPositiveNumberConfig } from "../validators";

export const repeatNode = defineNode({
	actionType: "control.repeat",
	capabilities: ["runtime.repeat"],
	configFields: [
		{
			key: "count",
			label: "Repeat count",
			type: "number",
			usesVariables: true,
			variableTypes: "integer",
			numeric: {
				kind: "integer",
				signed: false,
				minimum: "1",
				maximum: "18446744073709551615",
				minimumInclusive: true,
				maximumInclusive: true,
			},
		},
	],
	controlType: "repeat",
	defaultConfig: () => ({ count: "" }),
	description: "Repeat a block of steps.",
	group: "control",
	icon: Repeat2,
	kind: "control",
	label: "Repeat",
	portPolicy: { kind: "fixed", inputs: ["input"], outputs: ["done", "repeat"] },
	risk: "low",
	validateConfig: (config) => [staticPositiveNumberConfig(config, "count", "repeat count")].filter(Boolean),
	validateGraph: ({ context, node }) => validateLoopBodyDoesNotReturn(node.id, context.edges, "repeat"),
});
