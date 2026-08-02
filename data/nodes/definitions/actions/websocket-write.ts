import { Send } from "lucide-react";
import { getWebSocketConnectionTriggerId } from "@/data/project/websocket";
import type { JsonValue } from "@/lib/types";
import { defineNode } from "../../node-definition";
import { fallible } from "../runtime-outputs";
import { requiredConfig } from "../validators";

export const websocketWriteNode = defineNode({
	actionType: "action.websocket.write",
	capabilities: ["action.websocket"],
	configFields: [
		{
			key: "connectionId",
			label: "Connection",
			nonEmpty: true,
			type: "text",
			usesVariables: true,
			variableTypes: "string",
			help: "WebSocket Trigger connection used for this message.",
		},
		{
			key: "message",
			label: "Message",
			type: "textarea",
			usesVariables: true,
			variableTypes: "text",
			nonEmpty: true,
		},
	],
	defaultConfig: () => ({
		connectionId: "",
		message: "",
	}),
	description: "Send a message to an active WebSocket connection.",
	fallible: true,
	group: "actions",
	icon: Send,
	kind: "action",
	label: "WebSocket Write",
	permission: { name: "websocket.write", risk: "medium" },
	risk: "medium",
	runtimeOutputs: fallible([
		{
			name: "connection_id",
			type: "string",
			description: "WebSocket connection id targeted by the write.",
			example: "n-mr3zyt6f-24.connection_id",
		},
		{
			name: "message",
			type: "string",
			description: "Message sent to the connection.",
			example: "n-mr3zyt6f-24.message",
		},
		{
			name: "bytes",
			type: "number",
			description: "UTF-8 byte length of the sent message.",
			example: "n-mr3zyt6f-24.bytes",
		},
	]),
	runnerType: "websocket_write",
	validateConfig: (config) => {
		const connectionRequired = requiredConfig(config, "connectionId", "WebSocket connection");
		return [
			connectionRequired,
			!connectionRequired && !getWebSocketConnectionTriggerId(config.connectionId)
				? "WebSocket connection must reference a WebSocket Trigger."
				: "",
			requiredConfig(config, "message", "WebSocket message"),
		].filter(Boolean);
	},
	validateGraph: ({ context, node }) => {
		const triggerNodeId = getWebSocketConnectionTriggerId(node.data.config.connectionId);
		if (!triggerNodeId) {
			return [];
		}
		const trigger = context.nodes.find(
			(otherNode) => otherNode.id === triggerNodeId && otherNode.data.actionType === "trigger.websocket",
		);
		if (!trigger) {
			return [`${node.id} references WebSocket Trigger ${triggerNodeId}, but that trigger does not exist.`];
		}
		return canReachNode(trigger.id, node.id, context.edges)
			? []
			: [`${node.id} uses the connection from ${trigger.id}, but that WebSocket Trigger cannot reach this node.`];
	},
	simulation: {
		createOutput: ({ api, context, node }) => {
			const connectionId = String(api.resolveTemplate(api.getConfigString(node, "connectionId"), context)).trim();
			const message = String(api.resolveTemplate(api.getConfigString(node, "message"), context));

			if (!connectionId) {
				const outputData: Record<string, JsonValue> = {
					error: api.createError(
						"WebSocket Write requires a connection id.",
						"WEBSOCKET_CONNECTION_ID_MISSING",
						"validation",
						{ node_id: node.id },
						false,
					),
				};

				return {
					failed: true,
					outputData,
				};
			}

			const outputData: Record<string, JsonValue> = {
				connection_id: connectionId,
				message,
				bytes: new TextEncoder().encode(message).length,
			};

			return {
				failed: false,
				outputData,
			};
		},
		describe: ({ api, context, failed, node }) => {
			const output = context.nodeOutputs[node.id] ?? {};
			if (failed) {
				const error =
					output.error && typeof output.error === "object" && !Array.isArray(output.error) ? output.error : {};
				return [
					{
						level: "error",
						message: `[Simulation] WebSocket Write (${node.id}) failed. ${String(error.message ?? "Message was not sent.")}`,
					},
				];
			}

			return [
				{
					level: "info",
					message: `[Simulation] WebSocket Write (${node.id}) sent ${String(output.bytes ?? "?")} bytes to connection ${api.formatValue(output.connection_id ?? "")}. Message: ${truncateMessage(String(output.message ?? ""))}`,
				},
			];
		},
	},
});

function truncateMessage(value: string) {
	return value.length > 180 ? `${value.slice(0, 179)}...` : value;
}

function canReachNode(startNodeId: string, targetNodeId: string, edges: { source: string; target: string }[]) {
	const visited = new Set<string>();
	const queue = [startNodeId];

	while (queue.length > 0) {
		const nodeId = queue.shift();
		if (!nodeId || visited.has(nodeId)) {
			continue;
		}
		if (nodeId === targetNodeId) {
			return true;
		}
		visited.add(nodeId);
		for (const edge of edges) {
			if (edge.source === nodeId) {
				queue.push(edge.target);
			}
		}
	}

	return false;
}
