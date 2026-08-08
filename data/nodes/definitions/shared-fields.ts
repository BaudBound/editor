import type { NodeConfigField } from "../node-definition";
import { triggerOverlapOptions } from "./options";

/**
 * Config fields shared by every trigger.
 *
 * Spread into a trigger's `configFields` rather than copied, so the option
 * list has one definition. The schema generator resolves the spread; see
 * `readConfigFields` in `scripts/generate-node-schemas.mjs`.
 */
export const triggerOverlapFields: NodeConfigField[] = [
	{
		key: "overlap",
		label: "When already running",
		type: "select",
		options: triggerOverlapOptions,
		required: false,
		help: "Queue waits for the active run. Skip drops this activation. Stop cancels the active run and starts nothing, which is how one trigger toggles its own loop. Restart cancels the active run and starts a fresh one.",
	},
];

export const triggerOverlapModes = ["queue", "skip", "stop", "restart"] as const;

export type TriggerOverlapMode = (typeof triggerOverlapModes)[number];

/**
 * Reads a trigger's overlap mode from its config.
 *
 * An absent or unrecognised value is `queue`, matching the runner, so a script
 * written before the option existed keeps its behaviour.
 */
export function triggerOverlapMode(node: { data?: { config?: Record<string, unknown> } } | undefined) {
	const value = node?.data?.config?.overlap;
	return triggerOverlapModes.includes(value as TriggerOverlapMode) ? (value as TriggerOverlapMode) : "queue";
}
