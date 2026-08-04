import { AppWindow } from "lucide-react";
import type { JsonValue } from "@/lib/types";
import type { SimulationContext } from "@/utils/simulation-types";
import type { NodeSimulationApi } from "../../node-definition";
import { defineNode } from "../../node-definition";
import { fallible } from "../runtime-outputs";
import { actionWindow } from "../shared";
import { requiredConfig } from "../validators";

export const openApplicationNode = defineNode({
	actionType: "action.application.open",
	capabilities: actionWindow,
	configFields: [
		{
			key: "application",
			label: "Application",
			nonEmpty: true,
			type: "text",
			usesVariables: true,
			variableTypes: "string",
			help: "Use an app name, app id, bundle id, shortcut path, or desktop entry supported by the target runner.",
		},
		{ key: "arguments", label: "Arguments", type: "string-list", usesVariables: true, variableTypes: "text" },
	],
	defaultConfig: () => ({ application: "", arguments: [] }),
	description: "Launch an installed desktop application without waiting for it or capturing its output.",
	desktopOnly: true,
	fallible: true,
	group: "actions",
	icon: AppWindow,
	kind: "action",
	label: "Open Application",
	permission: { name: "process.run", risk: "dangerous" },
	risk: "dangerous",
	runtimeOutputs: fallible([
		{
			name: "application_id",
			type: "string",
			description: "Resolved application identifier used by the runner.",
			example: "n-mr3zyt6f-16.application_id",
		},
		{
			name: "process_id",
			type: "process_id",
			description: "Started process identifier when the platform exposes one.",
			example: "n-mr3zyt6f-16.process_id",
		},
	]),
	runnerType: "open_application",
	validateConfig: (config) => [requiredConfig(config, "application", "application")].filter(Boolean),
	simulation: {
		createOutput: ({ api, context, node }) => ({
			failed: false,
			outputData: {
				application_id: String(api.resolveTemplate(api.getConfigString(node, "application"), context)) || "application",
				process_id: 4243,
			},
		}),
		describe: ({ api, context, node }) => [
			{
				level: "info",
				message: `[Simulation] Open Application (${node.id}) succeeded. Would open application ${api.formatValue(api.resolveTemplate(api.getConfigString(node, "application"), context))} with arguments ${api.formatValue(resolveArguments(node.data.config.arguments, context, api))}.`,
			},
		],
	},
});

function resolveArguments(value: JsonValue | undefined, context: SimulationContext, api: NodeSimulationApi) {
	return Array.isArray(value)
		? value
				.filter((argument): argument is string => typeof argument === "string")
				.map((argument) => api.resolveTemplate(argument, context))
		: [];
}
