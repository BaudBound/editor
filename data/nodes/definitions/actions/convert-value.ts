import { ArrowRightLeft } from "lucide-react";
import type { VariableType } from "@/data/project/variables";
import type { JsonValue } from "@/lib/types";
import { defineNode, withFailureErrorOutput } from "../../node-definition";
import type { SelectOption } from "../options";
import { requiredConfig } from "../validators";

const maximumSafeInteger = Number.MAX_SAFE_INTEGER;

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
	if (targetType === "string") {
		return {
			ok: true,
			value: typeof input === "string" ? input : JSON.stringify(input),
		};
	}

	if (targetType === "float" || targetType === "integer") {
		if (typeof input !== "number" && typeof input !== "string") {
			return conversionError(input, targetType);
		}
		const normalized = typeof input === "string" ? input.trim() : "";
		const value =
			typeof input === "number" ? input : decimalNumberPattern.test(normalized) ? Number(normalized) : Number.NaN;
		if (!Number.isFinite(value) || (typeof input === "string" && input.trim() === "")) {
			return { error: `Cannot convert the value to ${targetType}. Expected a finite numeric value.`, ok: false };
		}
		if (targetType === "integer" && (!Number.isInteger(value) || Math.abs(value) > maximumSafeInteger)) {
			return {
				error: `Cannot convert the value to integer. Expected a whole number between -${maximumSafeInteger} and ${maximumSafeInteger}.`,
				ok: false,
			};
		}
		return { ok: true, value };
	}

	if (targetType === "boolean") {
		if (typeof input === "boolean") {
			return { ok: true, value: input };
		}
		if (typeof input === "string") {
			const normalized = input.trim().toLowerCase();
			if (normalized === "true" || normalized === "false") {
				return { ok: true, value: normalized === "true" };
			}
		}
		return { error: "Cannot convert the value to boolean. Expected true or false.", ok: false };
	}

	const parsed = typeof input === "string" ? parseJson(input) : input;
	if (targetType === "list" && Array.isArray(parsed)) {
		return { ok: true, value: parsed };
	}
	if (targetType === "object" && isObject(parsed)) {
		return { ok: true, value: parsed };
	}
	return conversionError(input, targetType);
}

const decimalNumberPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

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

function parseJson(value: string): JsonValue | undefined {
	try {
		return JSON.parse(value) as JsonValue;
	} catch {
		return undefined;
	}
}

function isObject(value: JsonValue | undefined): value is Record<string, JsonValue> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function conversionError(input: JsonValue, targetType: ValueConversionTarget) {
	return {
		error: `Cannot convert ${valueType(input)} to ${targetType}.`,
		ok: false as const,
	};
}
