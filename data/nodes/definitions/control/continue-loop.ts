import { SkipForward } from "lucide-react";
import { defineNode } from "../../node-definition";
import { validateLoopControlPlacement } from "../shared";

export const continueLoopNode = defineNode({
	actionType: "control.continue_loop",
	capabilities: ["runtime.continue_loop"],
	controlType: "continue_loop",
	description: "Skip the remaining steps in the current iteration of the innermost active loop.",
	group: "control",
	icon: SkipForward,
	kind: "control",
	label: "Continue Loop",
	portPolicy: { kind: "fixed", inputs: ["input"], outputs: [] },
	risk: "low",
	validateGraph: ({ context, node }) =>
		validateLoopControlPlacement(node.id, context.nodes, context.edges, "Continue Loop"),
});
