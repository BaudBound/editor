import { Waypoints } from "lucide-react";
import { defineNode } from "../../node-definition";
import { createRouterPortRow, createRouterRouteRow, summarizeRouterConfig, validateRouterConfig } from "../../router";

export const routerNode = defineNode({
	actionType: "control.router",
	capabilities: ["runtime.router"],
	controlType: "router",
	defaultConfig: () => ({
		inputs: [createRouterPortRow("Input 1", "input")],
		outputs: [createRouterPortRow("Output 1", "output")],
		routes: [createRouterRouteRow("input", "output", 0, "route")],
	}),
	description: "Merge inputs and fan out to outputs through ordered internal routes.",
	group: "control",
	icon: Waypoints,
	kind: "control",
	label: "Router",
	portPolicy: {
		kind: "router-ports",
		inputsKey: "inputs",
		outputsKey: "outputs",
		inputPrefix: "in-",
		outputPrefix: "out-",
	},
	risk: "low",
	summarizeConfig: summarizeRouterConfig,
	validateConfig: validateRouterConfig,
});
