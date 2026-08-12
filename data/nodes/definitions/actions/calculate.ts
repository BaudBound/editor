import { Calculator } from "lucide-react";
import { evaluateCalculationExpression, validateCalculationExpression } from "@/data/project/calculation";
import type { NodeExecutionResult } from "@/utils/simulation-types";
import { defineNode } from "../../node-definition";
import { calculationResultTypeOptions } from "../options";
import { fallible } from "../runtime-outputs";

type CalculationResultType = "automatic" | "integer" | "float";

export const calculateNode = defineNode({
	actionType: "action.calculate",
	capabilities: ["action.calculate"],
	configFields: [
		{
			key: "expression",
			label: "Expression",
			type: "textarea",
			usesVariables: true,
			variableTypes: ["integer", "float"],
			validate: (config) =>
				validateCalculationExpression(typeof config.expression === "string" ? config.expression : ""),
		},
		{
			key: "resultType",
			label: "Result type",
			type: "select",
			options: calculationResultTypeOptions,
			required: false,
		},
	],
	defaultConfig: () => ({ expression: "", resultType: "automatic" }),
	description: "Calculate a numeric expression and expose the result.",
	fallible: true,
	group: "actions",
	icon: Calculator,
	kind: "action",
	label: "Calculate",
	permission: { name: "calculate", risk: "low" },
	risk: "low",
	deriveRuntimeOutputs: (config) =>
		fallible([
			{
				name: "result",
				type: calculationOutputType(config.resultType),
				description: calculationOutputDescription(config.resultType),
				example: "n-mr3zyt6f-18.result",
			},
		]),
	runnerType: "calculate",
	simulation: {
		createOutput: ({ api, context, node }): NodeExecutionResult => {
			const expression = String(api.resolveTemplate(api.getConfigString(node, "expression"), context));
			const result = evaluateCalculationExpression(expression);
			if (!result.ok) {
				return {
					failed: true,
					outputData: {
						error: api.createError(result.message, "CALCULATION_FAILED", "validation", { expression }),
					},
				};
			}
			const resultType = calculationResultType(node.data.config.resultType);
			if (resultType === "integer" && !Number.isSafeInteger(result.value)) {
				return {
					failed: true,
					outputData: {
						error: api.createError(
							"Integer result type requires a whole safe integer result.",
							"CALCULATION_FAILED",
							"validation",
							{ expression },
						),
					},
				};
			}
			return { failed: false, outputData: { result: result.value } };
		},
		describe: ({ api, context, node }) => {
			const output = context.nodeOutputs[node.id];
			const expression = api.formatValue(api.resolveTemplate(api.getConfigString(node, "expression"), context));
			return [
				{
					level: "info",
					message:
						typeof output?.result === "number"
							? `[Simulation] Calculated ${expression} = ${output.result}.`
							: `[Simulation] Would calculate ${expression}.`,
				},
			];
		},
	},
});

function calculationResultType(value: unknown): CalculationResultType {
	return value === "integer" || value === "float" ? value : "automatic";
}

function calculationOutputType(value: unknown) {
	return calculationResultType(value) === "integer" ? "integer" : "float";
}

function calculationOutputDescription(value: unknown) {
	switch (calculationResultType(value)) {
		case "integer":
			return "Whole-number result of the evaluated expression.";
		case "float":
			return "Floating-point result of the evaluated expression.";
		default:
			return "Numeric result; whole safe results are emitted as integers, otherwise as floats.";
	}
}
