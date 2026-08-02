import type { Node } from "@xyflow/react";
import type { SelectOption } from "@/data/nodes/definitions/options";
import type { JsonValue, ScriptNodeData } from "@/lib/types";

const connectionReferencePattern = /^\{\{([^{}.\s]+)\.connection_id}}$/;

export function createWebSocketConnectionOptions(nodes: Node<ScriptNodeData>[]): SelectOption[] {
	return nodes
		.filter((node) => node.data.actionType === "trigger.websocket")
		.map((node) => {
			const customName = configString(node.data.config.customName).trim();
			const path = configString(node.data.config.path).trim();
			return {
				label: `${customName || node.data.label} (${path || node.id})`,
				value: createWebSocketConnectionReference(node.id),
			};
		})
		.sort((left, right) => left.label.localeCompare(right.label));
}

export function createWebSocketConnectionReference(triggerNodeId: string) {
	return `{{${triggerNodeId}.connection_id}}`;
}

export function getWebSocketConnectionTriggerId(value: JsonValue | undefined) {
	if (typeof value !== "string") {
		return null;
	}

	return value.trim().match(connectionReferencePattern)?.[1] ?? null;
}

export function websocketPathConfigFromInput(value: string) {
	const path = value.replace(/^\/+/, "");
	return path ? `/${path}` : "";
}

export function websocketPathInputFromConfig(value: JsonValue | undefined) {
	return configString(value).replace(/^\/+/, "");
}

function configString(value: JsonValue | undefined) {
	if (typeof value === "string") {
		return value;
	}
	if (value === undefined || value === null) {
		return "";
	}
	return String(value);
}
