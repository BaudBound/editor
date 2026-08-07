import {
	runtimeIntegerContract,
	runtimeNumberContract,
	validateNumericConfigValue,
} from "@/data/nodes/numeric-validation";
import { formatTypedValueForDisplay, validateTypedValue } from "@/data/project/typed-values";
import { type ListItemType, validateVariableName } from "@/data/project/variables";
import type { JsonValue, ScriptSetting, ScriptSettingType } from "@/lib/types";

const MAX_SCRIPT_SETTING_INPUT_BYTES = 1024 * 1024;
const MAX_SCRIPT_SETTING_CONTAINER_ITEMS = 4096;
const MAX_SCRIPT_SETTING_VALUE_DEPTH = 32;

export function formatScriptSettingValue(type: ScriptSettingType, value: JsonValue, itemType?: ListItemType) {
	return formatTypedValueForDisplay(type, value, itemType);
}

export function parseScriptSettingValue(type: ScriptSettingType, rawValue: string): JsonValue | undefined {
	if (type === "string" || type === "hotkey" || type === "color") {
		return rawValue;
	}
	if (type === "integer" || type === "float") {
		const trimmed = rawValue.trim();
		const contract = type === "integer" ? runtimeIntegerContract : runtimeNumberContract;
		return trimmed && !validateNumericConfigValue(trimmed, contract) ? Number(trimmed) : undefined;
	}
	if (type === "boolean") {
		return rawValue === "true" ? true : rawValue === "false" ? false : undefined;
	}
	try {
		const value = JSON.parse(rawValue) as JsonValue;
		if (type === "list") {
			return Array.isArray(value) ? value : undefined;
		}
		return value !== null && typeof value === "object" && !Array.isArray(value) ? value : undefined;
	} catch {
		return undefined;
	}
}

export function scriptSettingValueError(type: ScriptSettingType, rawValue: string, itemType?: ListItemType) {
	if (new TextEncoder().encode(rawValue).byteLength > MAX_SCRIPT_SETTING_INPUT_BYTES) {
		return `The value cannot exceed ${MAX_SCRIPT_SETTING_INPUT_BYTES} bytes.`;
	}
	const parsed = parseScriptSettingValue(type, rawValue);
	if (parsed !== undefined) {
		return validateTypedValue(type, parsed, itemType) ?? scriptSettingStructureError(parsed);
	}
	if (type === "integer") {
		return "Enter a whole number.";
	}
	if (type === "float") {
		return "Enter a finite number.";
	}
	if (type === "boolean") {
		return "Select true or false.";
	}
	if (type === "hotkey") {
		return "Press a valid Windows key combination.";
	}
	if (type === "color") {
		return "Select a color in #RRGGBB format.";
	}
	return type === "list" ? "Enter a JSON list." : "Enter a JSON object.";
}

export function validateScriptSetting(setting: ScriptSetting, existing: ScriptSetting[], originalName?: string) {
	const name = setting.name.trim();
	const nameError = validateVariableName(name);
	if (nameError) {
		return nameError;
	}
	if (name === "settings") {
		return 'The name "settings" is reserved for Script Settings.';
	}
	if (existing.some((candidate) => candidate.name === name && candidate.name !== originalName)) {
		return `A script setting named "${name}" already exists.`;
	}
	return null;
}

function scriptSettingStructureError(value: JsonValue, depth = 0): string | null {
	if (depth > MAX_SCRIPT_SETTING_VALUE_DEPTH) {
		return `The value cannot exceed ${MAX_SCRIPT_SETTING_VALUE_DEPTH} nested levels.`;
	}
	if (Array.isArray(value)) {
		if (value.length > MAX_SCRIPT_SETTING_CONTAINER_ITEMS) {
			return `A list cannot contain more than ${MAX_SCRIPT_SETTING_CONTAINER_ITEMS} items.`;
		}
		for (const item of value) {
			const error = scriptSettingStructureError(item, depth + 1);
			if (error) return error;
		}
		return null;
	}
	if (value !== null && typeof value === "object") {
		const entries = Object.values(value);
		if (entries.length > MAX_SCRIPT_SETTING_CONTAINER_ITEMS) {
			return `An object cannot contain more than ${MAX_SCRIPT_SETTING_CONTAINER_ITEMS} properties.`;
		}
		for (const item of entries) {
			const error = scriptSettingStructureError(item, depth + 1);
			if (error) return error;
		}
	}
	return null;
}

export function createSimulationScriptSettingValues(settings: ScriptSetting[]) {
	return Object.fromEntries(
		settings.map((setting) => [setting.name, structuredClone(setting.simulationValue ?? setting.defaultValue ?? null)]),
	);
}

export function getScriptSettingSimulationProblems(settings: ScriptSetting[]) {
	return settings.flatMap((setting) =>
		setting.required && setting.simulationValue === undefined && setting.defaultValue === undefined
			? [`Required Script Setting "${setting.name}" has no simulation override or package default.`]
			: [],
	);
}
