import { MessageSquareWarning } from "lucide-react";
import type { JsonValue } from "@/lib/types";
import type { SimulationSideEffect } from "@/utils/simulation-types";
import { defineNode } from "../../node-definition";
import { desktopDialogSizeOptions, messageBoxButtonOptions, messageBoxTypeOptions } from "../options";
import { configString, requiredConfig } from "../validators";
import { preserveDesktopDialogTimeout, resolveDesktopDialogTimeout } from "./desktop-dialog-timeout";

const supportedMessageBoxButtons = new Set(messageBoxButtonOptions.map((option) => option.value));
const supportedMessageBoxTypes = new Set(messageBoxTypeOptions.map((option) => option.value));
const supportedDialogSizes = new Set(desktopDialogSizeOptions.map((option) => option.value));

export const messageBoxNode = defineNode({
	actionType: "action.message_box",
	capabilities: ["action.message_box"],
	configFields: [
		{ key: "type", label: "Type", type: "select", options: messageBoxTypeOptions },
		{ key: "buttons", label: "Buttons", type: "select", options: messageBoxButtonOptions },
		{ key: "dialogSize", label: "Window size", type: "select", options: desktopDialogSizeOptions },
		{
			key: "title",
			label: "Title",
			type: "text",
			usesVariables: true,
			variableTypes: "string",
			nonEmpty: true,
		},
		{
			key: "message",
			label: "Message",
			type: "textarea",
			usesVariables: true,
			variableTypes: "string",
			nonEmpty: true,
		},
		{
			key: "timeoutSeconds",
			label: "Timeout (seconds)",
			type: "number",
			numeric: {
				kind: "float",
				signed: false,
				minimum: "0",
				maximum: "86400",
				minimumInclusive: false,
				maximumInclusive: true,
			},
			usesVariables: true,
			variableTypes: "float",
			required: false,
		},
	],
	defaultConfig: () => ({
		type: "info",
		buttons: "ok",
		dialogSize: "medium",
		title: "",
		message: "",
		timeoutSeconds: "",
	}),
	description: "Show a BaudBound message dialog in a separate desktop window.",
	desktopOnly: true,
	fallible: true,
	group: "actions",
	icon: MessageSquareWarning,
	kind: "action",
	label: "Message Dialog",
	portPolicy: {
		kind: "fixed",
		inputs: ["input"],
		outputs: ["ok", "cancel", "confirm", "yes", "no", "timed_out", "failed"],
	},
	derivePorts: (config) => ({
		inputs: [{ id: "input", label: "input" }],
		outputs: [
			...getMessageBoxPortButtons(configString(config, "buttons")).map((id) => ({ id, label: id })),
			...(configString(config, "timeoutSeconds").trim() ? [{ id: "timed_out", label: "timed_out" }] : []),
			{ id: "failed", label: "failed" },
		],
	}),
	permission: { name: "messageBox.show", risk: "medium" },
	risk: "medium",
	runtimeOutputs: [
		{
			name: "button",
			type: "string",
			description: "Configured button selected by the user, or timeout when the dialog expires.",
			example: "n-mr3zyt6f-18.button",
		},
	],
	runnerType: "show_message_box",
	sanitizeConfig: (config) =>
		preserveDesktopDialogTimeout(config, {
			type: configString(config, "type"),
			buttons: configString(config, "buttons"),
			dialogSize: configString(config, "dialogSize"),
			title: configString(config, "title"),
			message: configString(config, "message"),
			...(typeof config.customName === "string" ? { customName: config.customName } : {}),
		}),
	supportedTargetRuntimes: ["Windows Desktop", "Linux Desktop"],
	validateConfig: (config) =>
		[
			requiredConfig(config, "title", "message box title"),
			requiredConfig(config, "message", "message box message"),
			supportedMessageBoxTypes.has(configString(config, "type") || "info")
				? ""
				: "message dialog type must use a supported level.",
			supportedMessageBoxButtons.has(configString(config, "buttons") || "ok")
				? ""
				: "message dialog buttons must use a supported button set.",
			supportedDialogSizes.has(configString(config, "dialogSize"))
				? ""
				: "Window size must be Small, Medium, or Large.",
		].filter(Boolean),
	simulation: {
		afterExecute: ({ context, node, sideEffectResults }) => {
			const result = sideEffectResults.find((entry) => entry.type === "message_box" && entry.nodeId === node.id);
			if (result) {
				context.nodeOutputs[node.id] = { button: result.button };
			}
			return result
				? [
						{
							level: "info" as const,
							message: `[Simulation] Message Dialog (${node.id}) returned "${result.button}".`,
						},
					]
				: [];
		},
		createOutput: ({ api, context, node }) => {
			const resolved = resolveSimulationMessageBox(api, context, node);
			return typeof resolved === "string"
				? {
						failed: true,
						outputData: { error: api.createError(resolved, "MESSAGE_DIALOG_INVALID", "validation") },
					}
				: { failed: false, outputData: {} as Record<string, JsonValue> };
		},
		describe: ({ api, context, failed, node }) => {
			const resolved = resolveSimulationMessageBox(api, context, node);
			return [
				{
					level: failed || typeof resolved === "string" ? "error" : "info",
					message:
						failed || typeof resolved === "string"
							? `[Simulation] Message Dialog (${node.id}) failed validation.`
							: `[Simulation] Message Dialog (${node.id}) opened a ${resolved.variant} dialog titled "${resolved.title}".`,
				},
			];
		},
		sideEffects: ({ api, context, node }) => {
			const resolved = resolveSimulationMessageBox(api, context, node);
			return typeof resolved === "string" ? [] : [resolved];
		},
	},
});

type SimulationApi = Parameters<NonNullable<NonNullable<typeof messageBoxNode.simulation>["sideEffects"]>>[0]["api"];
type SimulationContext = Parameters<
	NonNullable<NonNullable<typeof messageBoxNode.simulation>["sideEffects"]>
>[0]["context"];
type SimulationNode = Parameters<NonNullable<NonNullable<typeof messageBoxNode.simulation>["sideEffects"]>>[0]["node"];

function resolveSimulationMessageBox(
	api: SimulationApi,
	context: SimulationContext,
	node: SimulationNode,
): Extract<SimulationSideEffect, { type: "message_box" }> | string {
	const title = api.resolveTemplate(api.getConfigString(node, "title"), context);
	if (typeof title !== "string" || !title.trim()) return "Message Dialog title must resolve to non-empty text.";
	const message = api.resolveTemplate(api.getConfigString(node, "message"), context);
	if (typeof message !== "string" || !message.trim()) return "Message Dialog message must resolve to non-empty text.";
	const timeout = resolveDesktopDialogTimeout(node.data.config.timeoutSeconds, (template) =>
		api.resolveTemplate(template, context),
	);
	if (typeof timeout === "string") return timeout;

	return {
		type: "message_box",
		nodeId: node.id,
		title,
		message,
		variant: normalizeMessageBoxVariant(api.getConfigString(node, "type")),
		buttons: getMessageBoxButtons(api.getConfigString(node, "buttons")),
		dialogSize: requireDialogSize(api.getConfigString(node, "dialogSize")),
		...(timeout === undefined ? {} : { timeoutSeconds: timeout }),
	};
}

function getMessageBoxButtons(value: string) {
	switch (value) {
		case "ok_cancel":
			return ["cancel", "ok"];
		case "cancel_confirm":
			return ["cancel", "confirm"];
		case "yes_no":
			return ["no", "yes"];
		case "yes_no_cancel":
			return ["cancel", "no", "yes"];
		case "ok":
			return ["ok"];
		default:
			throw new Error(`Message Dialog received an unsupported button set: ${JSON.stringify(value)}.`);
	}
}

function getMessageBoxPortButtons(value: string) {
	try {
		return getMessageBoxButtons(value || "ok");
	} catch {
		return ["ok"];
	}
}

function normalizeMessageBoxVariant(value: string): Extract<SimulationSideEffect, { type: "message_box" }>["variant"] {
	if (value === "warning" || value === "error") {
		return value;
	}

	return "info";
}

function requireDialogSize(value: string): Extract<SimulationSideEffect, { type: "message_box" }>["dialogSize"] {
	if (value === "small" || value === "medium" || value === "large") return value;
	throw new Error(`Message Dialog received an unsupported window size: ${JSON.stringify(value)}.`);
}
