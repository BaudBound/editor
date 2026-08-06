import { ArrowRightLeft } from "lucide-react";
import type { VariableType } from "@/data/project/variables";
import type { JsonValue } from "@/lib/types";
import { castSimulatedValue } from "@/utils/value-cast";
import { defineNode, withFailureErrorOutput } from "../../node-definition";
import type { SelectOption } from "../options";
import { requiredConfig } from "../validators";

export const valueConversionOptions: SelectOption[] = [
	{ label: "String", value: "string" },
	{ label: "Integer", value: "integer" },
	{ label: "Float", value: "float" },
	{ label: "Boolean", value: "boolean" },
	{ label: "Object", value: "object" },
	{ label: "List", value: "list" },
	{ label: "Color", value: "color" },
	{ label: "Keyboard Key", value: "keyboard_key" },
	{ label: "Datetime", value: "datetime" },
	{ label: "Duration", value: "duration" },
];

type ValueConversionTarget = VariableType;

export const convertValueNode = defineNode({
	actionType: "action.value.convert",
	capabilities: ["action.value"],
	configFields: [
		{
			key: "value",
			label: "Value",
			type: "textarea",
			usesVariables: true,
			variableTypes: "any",
			nonEmpty: true,
		},
		{ key: "targetType", label: "Convert to", type: "select", options: valueConversionOptions },
	],
	defaultConfig: () => ({ value: "", targetType: "string" }),
	description:
		"Convert a value to a string, an integer, a float, a boolean, an object, a list, a color, a keyboard key, a datetime, or a duration.",
	fallible: true,
	group: "actions",
	icon: ArrowRightLeft,
	kind: "action",
	label: "Convert Value",
	permission: { name: "value.convert", risk: "low" },
	risk: "low",
	runnerType: "convert_value",
	deriveRuntimeOutputs: (config) =>
		withFailureErrorOutput([
			{
				name: "value",
				type: normalizeTargetType(config.targetType),
				description: `Value converted to ${formatTargetType(normalizeTargetType(config.targetType))}.`,
			},
			{
				name: "source_type",
				type: "string",
				description: "Type of the input before conversion.",
			},
			{
				name: "target_type",
				type: "string",
				description: "Requested conversion type.",
			},
		]),
	sanitizeConfig: (config) => ({
		...(typeof config.customName === "string" ? { customName: config.customName } : {}),
		value: config.value ?? "",
		targetType: normalizeTargetType(config.targetType),
	}),
	validateConfig: (config) => {
		const errors = [requiredConfig(config, "value", "a value")];
		if (!valueConversionOptions.some((option) => option.value === config.targetType)) {
			errors.push("conversion target is not supported.");
		}
		return errors.filter(Boolean);
	},
	simulation: {
		createOutput: ({ api, context, node }) => {
			const targetType = normalizeTargetType(node.data.config.targetType);
			const input = api.resolveTemplate(String(node.data.config.value ?? ""), context);
			const result = convertValue(input, targetType);
			if (!result.ok) {
				const outputData: Record<string, JsonValue> = {
					error: api.createError(result.error, "VALUE_CONVERSION_FAILED", "validation", {
						source_type: valueType(input),
						target_type: targetType,
					}),
				};
				return {
					failed: true,
					outputData,
				};
			}
			const outputData: Record<string, JsonValue> = {
				value: result.value,
				source_type: valueType(input),
				target_type: targetType,
			};
			return {
				failed: false,
				outputData,
			};
		},
	},
});

export function convertValue(
	input: JsonValue,
	targetType: ValueConversionTarget,
): { ok: true; value: JsonValue } | { error: string; ok: false } {
	// Delegates to the simulator's conversion, which is asserted against the
	// same shared fixture as the runner. Keeping a second implementation here
	// meant the node silently refused the four types it had never been taught,
	// while the runner converted them.
	const outcome = castSimulatedValue(input, targetType);
	return outcome.ok ? { ok: true, value: outcome.value as JsonValue } : { error: outcome.error, ok: false };
}

function normalizeTargetType(value: JsonValue | undefined): ValueConversionTarget {
	const target = String(value ?? "");
	return valueConversionOptions.some((option) => option.value === target)
		? (target as ValueConversionTarget)
		: "string";
}

function formatTargetType(target: ValueConversionTarget) {
	return target === "integer" ? "a whole number" : target;
}

function valueType(value: JsonValue) {
	if (value === null) return "null";
	if (Array.isArray(value)) return "list";
	return typeof value;
}
