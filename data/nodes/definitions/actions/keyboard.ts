import { Keyboard } from "lucide-react";
import { defineNode } from "../../node-definition";
import { validateWindowsKeyTemplate } from "../../windows-key-contract";
import { inputActionOptions } from "../options";
import { actionKeyboard } from "../shared";
import { configOption, configString, requiredConfig } from "../validators";

const inputActions = inputActionOptions.map((option) => option.value);

export const keyboardNode = defineNode({
	actionType: "action.keyboard",
	capabilities: actionKeyboard,
	configFields: [
		{
			key: "inputAction",
			label: "Input action",
			type: "select",
			options: inputActionOptions,
			required: false,
			help: "Press and release performs a normal key press. Press down holds the keys until a matching Release action or the run ends.",
		},
		{
			key: "key",
			label: "Key",
			nonEmpty: true,
			type: "text",
			usesVariables: true,
			variableTypes: "keyboard_key",
			validate: (config) => {
				const key = configString(config, "key").trim();
				return key ? validateWindowsKeyTemplate(key) : "";
			},
		},
	],
	defaultConfig: () => ({ inputAction: "press", key: "" }),
	description: "Press, hold, or release a Windows key or key chord.",
	desktopOnly: true,
	fallible: true,
	group: "actions",
	icon: Keyboard,
	kind: "action",
	label: "Keyboard",
	permission: { name: "keyboard.control", risk: "high" },
	risk: "high",
	runnerType: "press_key",
	supportedTargetRuntimes: ["Windows Desktop"],
	validateConfig: (config) => {
		const actionError = config.inputAction ? configOption(config, "inputAction", "input action", inputActions) : "";
		return [actionError, requiredConfig(config, "key", "keyboard key")].filter(Boolean);
	},
	simulation: {
		describe: ({ api, context, node }) => {
			const inputAction = api.getConfigString(node, "inputAction") || "press";
			const actionLabel =
				inputAction === "down" ? "press and hold" : inputAction === "up" ? "release" : "press and release";
			return [
				{
					level: "info",
					message: `[Simulation] Keyboard (${node.id}) succeeded. Would ${actionLabel} keys ${api.resolveTemplate(api.getConfigString(node, "key"), context)}.`,
				},
			];
		},
	},
});
