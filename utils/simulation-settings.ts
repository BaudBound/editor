import type { Node } from "@xyflow/react";
import type { ScriptNodeData, SimulationSettings } from "@/lib/types";

export function getSimulationStepDelay(speed: SimulationSettings["speed"]) {
	const slowdownMs = Number(speed.match(/^slowdown-(100|300|700)$/)?.[1] ?? 0);
	return slowdownMs;
}

export function getSimulationTriggers(nodes: Node<ScriptNodeData>[]) {
	return nodes.filter((node) => node.data.kind === "trigger");
}
