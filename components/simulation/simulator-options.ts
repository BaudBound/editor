import type { SimulationOverrideOutcome, SimulationSpeed } from "@/lib/types";

export const outcomeOptions: Array<{ label: string; value: SimulationOverrideOutcome }> = [
	{ label: "Success", value: "success" },
	{ label: "Failed", value: "failed" },
];

export const speedOptions: Array<{ label: string; value: SimulationSpeed }> = [
	{ label: "Real time", value: "realtime" },
	{ label: "Slowdown: 100 ms", value: "slowdown-100" },
	{ label: "Slowdown: 300 ms", value: "slowdown-300" },
	{ label: "Slowdown: 700 ms", value: "slowdown-700" },
];

export function normalizeSimulationSpeed(value: string): SimulationSpeed {
	return speedOptions.some((option) => option.value === value) ? (value as SimulationSpeed) : "realtime";
}
