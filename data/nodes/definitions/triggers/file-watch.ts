import { FileText } from "lucide-react";
import { defineNode } from "../../node-definition";
import { requiredConfig } from "../validators";

export const fileWatchTriggerNode = defineNode({
	actionType: "trigger.file_watch",
	capabilities: ["trigger.file_watch"],
	configFields: [
		{
			key: "path",
			label: "Path",
			type: "text",
			usesVariables: true,
			variableTypes: "string",
			nonEmpty: true,
		},
		{
			key: "recursive",
			label: "Include subdirectories",
			type: "switch",
			required: false,
			help: "Applies when Path is a directory.",
		},
	],
	defaultConfig: () => ({ path: "", recursive: false }),
	description: "Start when a file changes.",
	group: "triggers",
	icon: FileText,
	kind: "trigger",
	label: "File Watch",
	permission: { name: "file.watch.limited", risk: "medium" },
	permissionPathRules: [{ access: "watch", configKey: "path" }],
	risk: "medium",
	runtimeOutputs: [
		{
			name: "path",
			type: "string",
			description: "Changed file path.",
			example: "n-mr3zyt6f-2.path",
		},
		{
			name: "event",
			type: "string",
			description: "File event type reported by the runner.",
			example: "n-mr3zyt6f-2.event",
		},
		{
			name: "watched_path",
			type: "string",
			description: "Configured file or directory path watched by the runner.",
			example: "n-mr3zyt6f-2.watched_path",
		},
	],
	runnerType: "file_watch",
	validateConfig: (config) => [requiredConfig(config, "path", "file watch path")].filter(Boolean),
	simulation: {
		createOutput: ({ api, context, node }) => ({
			failed: false,
			outputData: {
				path: context.triggerPayload.path || api.resolveTemplate(api.getConfigString(node, "path"), context),
				event: context.triggerPayload.event || "modified",
				watched_path:
					context.triggerPayload.watched_path || api.resolveTemplate(api.getConfigString(node, "path"), context),
			},
		}),
		describe: ({ api, context, node }) => {
			const output = context.nodeOutputs[node.id];
			const event = typeof output?.event === "string" ? output.event : "modified";
			const path =
				typeof output?.path === "string"
					? output.path
					: api.formatValue(api.resolveTemplate(api.getConfigString(node, "path"), context));

			return [{ level: "info", message: `[Simulation] File watcher received ${event} event for ${path}.` }];
		},
	},
});
