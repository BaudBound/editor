import {
	runtimeIntegerContract,
	runtimeNumberContract,
	validateNumericConfigValue,
} from "@/data/nodes/numeric-validation";
import { validateWindowsHotkey } from "@/data/nodes/windows-key-contract";
import { typedDatetimeIso } from "@/data/project/datetime";
import {
	type DurationUnit,
	durationUnits,
	type ListItemType,
	listItemTypes,
	type VariableType,
} from "@/data/project/variables";
import type { JsonValue } from "@/lib/types";

export type TypedValueType = VariableType;

export function createEmptyTypedValue(type: TypedValueType, itemType?: ListItemType): JsonValue {
	switch (type) {
		case "string":
		case "keyboard_key":
		case "color":
			return "";
		case "integer":
		case "float":
			return 0;
		case "boolean":
			return false;
		case "object":
			return {};
		case "list":
			return [];
		case "datetime":
			return { type: "datetime", value: new Date().toISOString() };
		case "duration":
			return { type: "duration", unit: "seconds", value: 0 };
		default:
			return itemType ? createEmptyTypedValue(itemType) : "";
	}
}

export function validateTypedValue(type: TypedValueType, value: JsonValue, itemType?: ListItemType): string | null {
	switch (type) {
		case "string":
			return typeof value === "string" ? null : "Enter a text value.";
		case "keyboard_key":
			return typeof value === "string" && !validateWindowsHotkey(value)
				? null
				: "Press a valid Windows key combination.";
		case "color":
			return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? null : "Select a color in #RRGGBB format.";
		case "integer":
			return typeof value === "number" &&
				Number.isFinite(value) &&
				!validateNumericConfigValue(String(value), runtimeIntegerContract)
				? null
				: "Enter a whole number within the supported runtime range.";
		case "float":
			return typeof value === "number" &&
				Number.isFinite(value) &&
				!validateNumericConfigValue(String(value), runtimeNumberContract)
				? null
				: "Enter a finite number within the supported runtime range.";
		case "boolean":
			return typeof value === "boolean" ? null : "Select true or false.";
		case "object":
			return isRecord(value) ? null : "Enter a JSON object.";
		case "list":
			if (!itemType || !listItemTypes.includes(itemType)) {
				return "Select the type used by every list item.";
			}
			if (!Array.isArray(value)) {
				return "The value must be a list.";
			}
			for (const [index, item] of value.entries()) {
				const error = validateTypedValue(itemType, item);
				if (error) {
					return `List item ${index + 1}: ${error}`;
				}
			}
			return null;
		case "datetime":
			return typedDatetimeIso(value) ? null : "Select a valid date and time.";
		case "duration":
			return isRecord(value) &&
				value.type === "duration" &&
				typeof value.value === "number" &&
				Number.isFinite(value.value) &&
				value.value >= 0 &&
				typeof value.unit === "string" &&
				durationUnits.includes(value.unit as DurationUnit)
				? null
				: "Enter a nonnegative duration and select its unit.";
	}
}

export function inferListItemType(value: JsonValue): ListItemType | undefined {
	if (!Array.isArray(value) || value.length === 0) {
		return undefined;
	}
	const inferred = value.map(inferTypedValueType);
	const first = inferred[0];
	return first && inferred.every((type) => type === first) ? first : undefined;
}

export function normalizeListItemType(type: unknown): ListItemType | undefined {
	return typeof type === "string" && listItemTypes.includes(type as ListItemType) ? (type as ListItemType) : undefined;
}

export function formatTypedValue(value: JsonValue | undefined) {
	if (value === undefined) {
		return "Not set";
	}
	return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

export function formatTypedValueForDisplay(
	type: TypedValueType,
	value: JsonValue | undefined,
	itemType?: ListItemType,
): string {
	if (value === undefined) return "Not set";

	switch (type) {
		case "string":
		case "keyboard_key":
		case "color":
			return typeof value === "string" ? value : "Invalid value";
		case "integer":
		case "float":
		case "boolean":
			return String(value);
		case "datetime":
			return typedDatetimeIso(value) ?? "Invalid date and time";
		case "duration": {
			if (
				!isRecord(value) ||
				typeof value.value !== "number" ||
				!Number.isFinite(value.value) ||
				typeof value.unit !== "string" ||
				!durationUnits.includes(value.unit as DurationUnit)
			) {
				return "Invalid duration";
			}
			return `${value.value} ${durationUnitLabel(value.unit as DurationUnit, value.value)}`;
		}
		case "list":
			if (!Array.isArray(value)) return "Invalid list";
			if (value.length === 0) return "No items";
			return value
				.map((item) => formatTypedValueForDisplay(itemType ?? inferTypedValueType(item) ?? "object", item))
				.join("\n");
		case "object":
			return isRecord(value) ? JSON.stringify(value, null, 2) : "Invalid object";
	}
}

export function parseObjectValue(rawValue: string): JsonValue | undefined {
	try {
		const parsed = JSON.parse(rawValue) as JsonValue;
		return isRecord(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

export function inferTypedValueType(value: JsonValue): ListItemType | undefined {
	if (typeof value === "string") return "string";
	if (typeof value === "number" && Number.isFinite(value)) return Number.isInteger(value) ? "integer" : "float";
	if (typeof value === "boolean") return "boolean";
	if (!isRecord(value)) return undefined;
	if (value.type === "datetime" && typeof value.value === "string") return "datetime";
	if (value.type === "duration" && typeof value.value === "number") return "duration";
	return "object";
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function durationUnitLabel(unit: DurationUnit, amount: number) {
	return amount === 1 ? unit.replace(/s$/, "") : unit;
}
