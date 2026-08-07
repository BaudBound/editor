import { Clock } from "lucide-react";
import { defineNode } from "../../node-definition";
import { timeUnitOptions } from "../options";
import { staticPositiveDurationConfig } from "../validators";

export const scheduleTriggerNode = defineNode({
	actionType: "trigger.schedule",
	capabilities: ["trigger.schedule"],
	configFields: [
		{
			key: "every",
			label: "Every",
			type: "number",
			usesVariables: true,
			variableTypes: "integer",
			numeric: {
				// A whole count of the chosen unit. Milliseconds is the
				// smallest unit and the runner refuses anything below one of
				// them, so every interval it will accept can be written
				// exactly without a fraction.
				kind: "integer",
				signed: false,
				minimum: "0",
				maximum: "9007199254740991",
				minimumInclusive: false,
				maximumInclusive: true,
			},
			validate: (config) => staticPositiveDurationConfig(config, "every", "unit", "schedule interval", true),
		},
		{ key: "unit", label: "Unit", type: "select", options: timeUnitOptions },
	],
	defaultConfig: () => ({ every: "", unit: "minutes" }),
	description: "Run on a time schedule.",
	group: "triggers",
	icon: Clock,
	kind: "trigger",
	label: "Schedule",
	risk: "low",
	runtimeOutputs: [
		{
			name: "interval_seconds",
			// A quarter second schedule is 0.25 seconds, so this is a float
			// whatever the interval is. Making the type follow the value would
			// leave the same output an integer on one schedule and a float on
			// the next.
			type: "float",
			description: "Configured schedule interval in seconds.",
			example: "n-mr3zyt6f-1.interval_seconds",
		},
		{
			name: "schedule",
			type: "object",
			description: "Configured schedule amount and unit.",
			example: "n-mr3zyt6f-1.schedule.every",
		},
		{
			name: "scheduled_at_unix",
			type: "integer",
			description: "Unix timestamp in seconds when the schedule event was created.",
			example: "n-mr3zyt6f-1.scheduled_at_unix",
		},
	],
	runnerType: "schedule",
	simulation: {
		createOutput: ({ api, context, node }) => {
			const every = Number(api.getConfigString(node, "every"));
			const unit = api.getConfigString(node, "unit") || "seconds";
			return {
				failed: false,
				outputData: {
					interval_seconds:
						context.triggerPayload.interval_seconds ??
						scheduleIntervalSeconds(Number.isFinite(every) ? every : 0, unit),
					schedule: context.triggerPayload.schedule ?? { every, unit },
					scheduled_at_unix: context.triggerPayload.scheduled_at_unix ?? Math.floor(Date.now() / 1000),
				},
			};
		},
	},
});

function scheduleIntervalSeconds(every: number, unit: string) {
	const multipliers: Record<string, number> = {
		milliseconds: 0.001,
		seconds: 1,
		minutes: 60,
		hours: 3600,
		days: 86400,
	};
	return every * (multipliers[unit] ?? 1);
}
