import { Keyboard } from "lucide-react";
import { defineNode } from "../../node-definition";
import { validateWindowsKeyTemplate } from "../../windows-key-contract";
import { triggerOverlapFields } from "../shared-fields";
import { configString, requiredConfig } from "../validators";

export const hotkeyTriggerNode = defineNode({
	actionType: "trigger.hotkey",
	capabilities: ["trigger.hotkey"],
	configFields: [
		...triggerOverlapFields,
		{
			key: "key",
			label: "Key",
			nonEmpty: true,
			type: "text",
			usesVariables: true,
			variableTypes: "hotkey",
			validate: (config) => {
				const key = configString(config, "key").trim();
				return key ? validateWindowsKeyTemplate(key) : "";
			},
		},
	],
	defaultConfig: () => ({ overlap: "queue", key: "" }),
	description: "Start from a desktop hotkey.",
	desktopOnly: true,
	group: "triggers",
	icon: Keyboard,
	kind: "trigger",
	label: "Hotkey",
	risk: "medium",
	runtimeOutputs: [
		{
			name: "key",
			type: "hotkey",
			description: "Captured hotkey expression.",
			example: "n-mr3zyt6f-4.key",
		},
		{
			name: "timestamp",
			type: "string",
			description: "Unix timestamp in milliseconds when the hotkey was pressed.",
			example: "n-mr3zyt6f-4.timestamp",
		},
	],
	runnerType: "hotkey",
	supportedTargetRuntimes: ["Windows Desktop"],
	validateConfig: (config) => [requiredConfig(config, "key", "hotkey")].filter(Boolean),
	simulation: {
		createOutput: ({ api, context, node }) => ({
			failed: false,
			outputData: {
				key: context.triggerPayload.key || api.resolveTemplate(api.getConfigString(node, "key"), context),
				timestamp: context.triggerPayload.timestamp || Date.now().toString(),
			},
		}),
	},
});
