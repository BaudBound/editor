import { CircleStop } from "lucide-react";
import { defineNode } from "../../node-definition";
import { validateLoopControlPlacement } from "../shared";

export const breakLoopNode = defineNode({
	actionType: "control.break_loop",
	capabilities: ["runtime.break_loop"],
	controlType: "break_loop",
	description: "Exit the innermost active Repeat, While, or For Each loop.",
	group: "control",
	icon: CircleStop,
	kind: "control",
	label: "Break Loop",
	portPolicy: { kind: "fixed", inputs: ["input"], outputs: [] },
	risk: "low",
	validateGraph: ({ context, node }) =>
		validateLoopControlPlacement(node.id, context.nodes, context.edges, "Break Loop"),
});
