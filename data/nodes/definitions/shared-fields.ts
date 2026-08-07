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
