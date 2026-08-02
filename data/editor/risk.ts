import type { RiskLevel, ScriptNodeData } from "@/lib/types";

const dangerRiskTone = {
	color: "#e62d3e",
	backgroundColor: "rgb(230 45 62 / 0.1)",
	borderColor: "rgb(230 45 62 / 0.32)",
};

export const riskTone: Record<RiskLevel, { backgroundColor: string; borderColor: string; color: string }> = {
	low: {
		color: "#3ecf8e",
		backgroundColor: "rgb(62 207 142 / 0.1)",
		borderColor: "rgb(62 207 142 / 0.32)",
	},
	medium: {
		color: "#f5a623",
		backgroundColor: "rgb(245 166 35 / 0.1)",
		borderColor: "rgb(245 166 35 / 0.32)",
	},
	high: dangerRiskTone,
	dangerous: dangerRiskTone,
};

export const kindAccentClassName = {
	trigger: "bg-baud-blue",
	control: "bg-baud-purple",
	action: "bg-baud-red",
} satisfies Record<ScriptNodeData["kind"], string>;
