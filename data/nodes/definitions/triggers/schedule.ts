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
			variableTypes: "numeric",
			numeric: {
				kind: "float",
				signed: false,
				minimum: "0",
				maximum: "1.7976931348623157e308",
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
			type: "number",
			description: "Configured schedule interval in seconds.",
			example: "n-mr3zyt6f-1.interval_seconds",
		},
		{
			name: "missed_intervals",
			type: "number",
			description: "Number of schedule intervals skipped before this event.",
			example: "n-mr3zyt6f-1.missed_intervals",
		},
		{
			name: "schedule",
			type: "object",
			description: "Configured schedule amount and unit.",
			example: "n-mr3zyt6f-1.schedule.every",
		},
		{
			name: "scheduled_at_unix",
			type: "number",
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
					missed_intervals: context.triggerPayload.missed_intervals ?? 0,
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
