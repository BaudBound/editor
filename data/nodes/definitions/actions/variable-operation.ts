import { Database } from "lucide-react";
import {
	getVariableOperationFixedType,
	type ListItemType,
	listItemTypes,
	normalizeVariableOperation,
	type VariableType,
	validateVariableName,
	validateVariableOperationValue,
	variableTypes,
} from "@/data/project/variables";
import type { JsonValue } from "@/lib/types";
import type { SimulationContext } from "@/utils/simulation-types";
import { defineNode, type NodeSimulationApi } from "../../node-definition";
import { variableOperationOptions, variableScopeOptions, variableTypeOptions } from "../options";

export const variableOperationNode = defineNode({
	actionType: "runtime.set_variable",
	capabilities: ["runtime.variables"],
	configFields: [
		{ key: "operation", label: "Operation", type: "select", options: variableOperationOptions },
		{ key: "name", label: "Variable name", type: "text" },
		{ key: "scope", label: "Scope", type: "select", options: variableScopeOptions },
		{ key: "valueType", label: "Variable type", type: "select", options: variableTypeOptions, required: false },
	],
	defaultConfig: () => ({
		operation: "set",
		name: "",
		scope: "runtime",
		valueType: "string",
		itemType: "string",
		value: "",
		fieldPath: "",
		fieldValueType: "string",
		fieldItemType: "string",
		removeMode: "all",
	}),
	description: "Create, change, merge, clear, or delete variable values.",
	fallible: true,
	deriveCapabilities: (config) =>
		configString(config.scope) === "runtime"
			? ["runtime.variables"]
			: ["runtime.variables", "runtime.persistent_storage"],
	derivePermissions: (config) => {
		const scope = configString(config.scope);
		if (scope === "persistent") {
			return [{ name: "variable.persistent.set", risk: "medium" }];
		}
		if (scope === "global") {
			return [{ name: "variable.global.set", risk: "high" }];
		}
		return [{ name: "variable.local.set", risk: "low" }];
	},
	group: "actions",
	icon: Database,
	kind: "action",
	label: "Variable Operation",
	permission: { name: "variable.local.set", risk: "low" },
	risk: "low",
	runnerType: "set_variable",
	sanitizeConfig: (config) => {
		const operation = normalizeVariableOperation(configString(config.operation));
		const allowedKeys = getVariableOperationConfigKeys(operation);
		return Object.fromEntries(Object.entries(config).filter(([key]) => allowedKeys.has(key)));
	},
	validateConfig: (config) => {
		const name = configString(config.name);
		const nameError = validateVariableName(name);
		const operation = normalizeVariableOperation(configString(config.operation));
		const rawType = configString(config.valueType);
		const scope = configString(config.scope);
		const fixedType = getVariableOperationFixedType(operation);
		const declaredType = variableTypes.find((type) => type === rawType);
		const valueType = fixedType ?? declaredType;
		const itemType = normalizeListItemType(configString(config.itemType));
		const fieldValueType = normalizeVariableTypeOrUndefined(configString(config.fieldValueType));
		const fieldItemType = normalizeListItemType(configString(config.fieldItemType));
		const errors = [
			nameError ? `has invalid variable name: ${nameError}` : "",
			["runtime", "persistent", "global"].includes(scope) ? "" : `has invalid variable scope "${scope || "missing"}".`,
			operation !== "set" || valueType ? "" : `has invalid variable type "${rawType || "missing"}".`,
			operation === "remove_list_items" && !["first", "all"].includes(configString(config.removeMode))
				? `has invalid removal mode "${configString(config.removeMode) || "missing"}".`
				: "",
		];

		if (operation !== "clear" && operation !== "delete" && valueType) {
			const valueError = validateVariableOperationValue(
				operation,
				valueType,
				configString(config.value),
				configString(config.fieldPath),
				itemType,
				fieldValueType,
				fieldItemType,
			);
			if (valueError) {
				errors.push(valueError);
			}
		}

		return errors.filter(Boolean);
	},
	simulation: {
		createOutput: ({ api, context, node }) => {
			try {
				applyVariableOperation(node.data.config, context, api);
				return { failed: false, outputData: {} as Record<string, JsonValue> };
			} catch (error) {
				const message = error instanceof Error ? error.message : "Variable operation failed.";
				return {
					failed: true,
					outputData: {
						error: api.createError(message, "VARIABLE_OPERATION_FAILED", "validation", {
							operation: api.getConfigString(node, "operation"),
							variable: api.getConfigString(node, "name"),
						}),
					},
				};
			}
		},
		afterExecute: ({ api, context, failed, node }) => {
			if (failed) {
				return [];
			}

			const name = api.getConfigString(node, "name").trim();
			if (!name) {
				return [];
			}

			const result = applyVariableOperation(node.data.config, context, api);
			const scope = api.getConfigString(node, "scope");
			const variables = getVariableStore(scope, context);
			if (result.deleted) {
				delete variables[name];
			} else {
				variables[name] = result.value;
			}

			return [
				{
					level: "info",
					message: `[Simulation] ${result.message}`,
				},
			];
		},
		describe: ({ api, failed, node }) => [
			{
				level: failed ? "error" : "info",
				message: failed
					? `[Simulation] Variable Operation (${node.id}) failed.`
					: `[Simulation] Variable Operation (${node.id}) succeeded. Preparing to ${api.getConfigString(node, "operation").replaceAll("_", " ")} ${api.getConfigString(node, "name")}.`,
			},
		],
	},
});

type VariableOperationSimulationApi = {
	formatValue: (value: JsonValue) => string;
	getConfigString: NodeSimulationApi["getConfigString"];
	parseJsonValue: (value: string) => JsonValue | undefined;
	resolveJsonCompatibleInput: (value: string, context: SimulationContext) => JsonValue;
	resolveTemplate: (value: string, context: SimulationContext) => JsonValue;
};

function applyVariableOperation(
	config: Record<string, JsonValue>,
	context: SimulationContext,
	api: VariableOperationSimulationApi,
) {
	const name = configString(config.name).trim();
	const nameError = validateVariableName(name);
	if (nameError) {
		throw new Error(nameError);
	}
	const operation = normalizeVariableOperation(configString(config.operation));
	const type = getVariableOperationFixedType(operation) ?? normalizeVariableType(configString(config.valueType));
	const itemType = normalizeListItemType(configString(config.itemType));
	const fieldValueType = normalizeVariableType(configString(config.fieldValueType));
	const fieldItemType = normalizeListItemType(configString(config.fieldItemType));
	const scope = configString(config.scope);
	const variables = getVariableStore(scope, context);
	const scopeLabel = scope === "persistent" ? "persistent" : scope === "global" ? "global" : "runtime";
	const currentValue = variables[name];

	if (operation === "toggle_boolean") {
		if (currentValue !== undefined && typeof currentValue !== "boolean") {
			throw new Error(`Toggling requires existing variable "${name}" to be a boolean.`);
		}
		const value = !(currentValue ?? false);
		return {
			value,
			message: `Toggled ${scopeLabel} boolean variable "${name}" to ${api.formatValue(value)}.`,
		};
	}

	if (operation === "increment") {
		const amount = parseFiniteNumber(api.resolveTemplate(configString(config.value), context), "Increment value");
		const currentNumber =
			currentValue === undefined ? 0 : parseFiniteNumber(currentValue, `Existing variable "${name}"`);
		const value = currentNumber + amount;
		if (!Number.isFinite(value)) throw new Error(`Incrementing variable "${name}" produced a non-finite number.`);

		return {
			value,
			message: `Incremented ${scopeLabel} variable "${name}" by ${api.formatValue(amount)} to ${api.formatValue(value)}.`,
		};
	}

	if (operation === "append_list") {
		const item = api.resolveJsonCompatibleInput(configString(config.value), context);
		if (currentValue !== undefined && !Array.isArray(currentValue)) {
			throw new Error(`Appending requires existing variable "${name}" to be a list.`);
		}
		validateListAppend(currentValue ?? [], item, name);
		const value = [...(currentValue ?? []), item];

		return {
			value,
			message: `Appended ${api.formatValue(item)} to list variable "${name}".`,
		};
	}

	if (operation === "remove_list_items") {
		if (!Array.isArray(currentValue)) {
			throw new Error(`Removing matching items requires existing variable "${name}" to be a list.`);
		}
		const item = api.resolveJsonCompatibleInput(configString(config.value), context);
		const removeMode = configString(config.removeMode);
		if (removeMode !== "first" && removeMode !== "all") {
			throw new Error(`Removal mode must be "first" or "all".`);
		}
		let removedCount = 0;
		const value = currentValue.filter((entry) => {
			if (!jsonValuesEqual(entry, item) || (removeMode === "first" && removedCount > 0)) {
				return true;
			}
			removedCount += 1;
			return false;
		});
		return {
			value,
			message: `Removed ${removedCount} matching ${removedCount === 1 ? "item" : "items"} from ${scopeLabel} list variable "${name}". New value: ${api.formatValue(value)}.`,
		};
	}

	if (operation === "set_object_field") {
		const fieldPath = configString(config.fieldPath).trim();
		const fieldValue = api.resolveJsonCompatibleInput(configString(config.value), context);
		validateSimulationValue(fieldValue, fieldValueType, fieldItemType, "Object field value");
		if (
			currentValue !== undefined &&
			(!currentValue || typeof currentValue !== "object" || Array.isArray(currentValue))
		) {
			throw new Error(`Setting an object field requires existing variable "${name}" to be an object.`);
		}
		const value = setObjectPathValue(currentValue, fieldPath, fieldValue);

		return {
			value,
			message: `Set object field "${name}.${fieldPath}" to ${api.formatValue(fieldValue)}.`,
		};
	}

	if (operation === "remove_object_field") {
		const fieldPath = configString(config.fieldPath).trim();
		if (!currentValue || typeof currentValue !== "object" || Array.isArray(currentValue)) {
			throw new Error(`Removing an object field requires existing variable "${name}" to be an object.`);
		}
		const value = cloneJson(currentValue);
		const removed = removeObjectPathValue(value, fieldPath);
		return {
			value,
			message: removed
				? `Removed object field "${name}.${fieldPath}". New value: ${api.formatValue(value)}.`
				: `Object field "${name}.${fieldPath}" was not present. Value was unchanged: ${api.formatValue(value)}.`,
		};
	}

	if (operation === "merge_object") {
		const incoming = api.resolveJsonCompatibleInput(configString(config.value), context);
		validateSimulationValue(incoming, "object", undefined, "Object to merge");
		if (
			currentValue !== undefined &&
			(!currentValue || typeof currentValue !== "object" || Array.isArray(currentValue))
		) {
			throw new Error(`Merging requires existing variable "${name}" to be an object.`);
		}
		const value = {
			...(currentValue && typeof currentValue === "object" && !Array.isArray(currentValue) ? currentValue : {}),
			...(incoming as Record<string, JsonValue>),
		};
		return {
			value,
			message: `Merged ${api.formatValue(incoming)} into ${scopeLabel} object variable "${name}". New value: ${api.formatValue(value)}.`,
		};
	}

	if (operation === "delete") {
		return {
			deleted: true,
			value: null,
			message:
				currentValue === undefined
					? `${scopeLabel[0].toUpperCase()}${scopeLabel.slice(1)} variable "${name}" was already missing.`
					: `Deleted ${scopeLabel} variable "${name}".`,
		};
	}

	if (operation === "clear") {
		const value = getClearedSimulationValue(currentValue, name);

		return {
			value,
			message: `Cleared ${scopeLabel} variable "${name}" to ${api.formatValue(value)}.`,
		};
	}

	const value = resolveVariableInput(configString(config.value), type, context, api);
	validateSimulationValue(value, type, itemType, "Variable value");
	return {
		value,
		message: `Set ${scopeLabel} variable "${name}" to ${api.formatValue(value)}.`,
	};
}

function getVariableOperationConfigKeys(operation: ReturnType<typeof normalizeVariableOperation>) {
	const base = ["customName", "operation", "name", "scope"];
	const operationKeys: Record<ReturnType<typeof normalizeVariableOperation>, string[]> = {
		set: ["valueType", "itemType", "value"],
		increment: ["value"],
		toggle_boolean: [],
		append_list: ["value"],
		remove_list_items: ["value", "removeMode"],
		set_object_field: ["fieldPath", "fieldValueType", "fieldItemType", "value"],
		remove_object_field: ["fieldPath"],
		merge_object: ["value"],
		clear: [],
		delete: [],
	};
	return new Set([...base, ...operationKeys[operation]]);
}

function getVariableStore(scope: string, context: SimulationContext) {
	if (scope === "persistent") {
		return context.persistentVariables;
	}

	if (scope === "global") {
		return context.globalVariables;
	}

	return context.runtimeVariables;
}

function normalizeVariableType(value: string): VariableType {
	return variableTypes.includes(value as VariableType) ? (value as VariableType) : "string";
}

function normalizeVariableTypeOrUndefined(value: string): VariableType | undefined {
	return variableTypes.includes(value as VariableType) ? (value as VariableType) : undefined;
}

function normalizeListItemType(value: string): ListItemType | undefined {
	return listItemTypes.includes(value as ListItemType) ? (value as ListItemType) : undefined;
}

function validateSimulationValue(
	value: JsonValue,
	type: VariableType | undefined,
	itemType: ListItemType | undefined,
	label: string,
) {
	if (!type) {
		throw new Error(`${label} type is required.`);
	}
	const valid = (() => {
		if (type === "string" || type === "file_path") return typeof value === "string";
		if (type === "number") return typeof value === "number" && Number.isFinite(value);
		if (type === "boolean") return typeof value === "boolean";
		if (type === "object") return !!value && typeof value === "object" && !Array.isArray(value);
		if (type === "list") {
			return (
				Array.isArray(value) &&
				!!itemType &&
				value.every((item) => {
					try {
						validateSimulationValue(item, itemType, undefined, label);
						return true;
					} catch {
						return false;
					}
				})
			);
		}
		if (type === "datetime") {
			return (
				!!value &&
				typeof value === "object" &&
				!Array.isArray(value) &&
				value.type === "datetime" &&
				typeof value.value === "string" &&
				!Number.isNaN(Date.parse(value.value))
			);
		}
		return (
			!!value &&
			typeof value === "object" &&
			!Array.isArray(value) &&
			value.type === "duration" &&
			typeof value.value === "number" &&
			Number.isFinite(value.value) &&
			value.value >= 0 &&
			typeof value.unit === "string" &&
			["milliseconds", "seconds", "minutes", "hours", "days"].includes(value.unit)
		);
	})();
	if (!valid) {
		throw new Error(`${label} does not match declared type "${type}".`);
	}
}

function validateListAppend(list: JsonValue[], item: JsonValue, name: string) {
	const itemKind = getListItemKind(item);
	if (!itemKind) {
		throw new Error(`Appending to list variable "${name}" requires a supported non-null, non-list item.`);
	}
	const existingKinds = new Set(list.map(getListItemKind));
	if (existingKinds.has(undefined) || existingKinds.size > 1) {
		throw new Error(`Existing list variable "${name}" contains mixed or unsupported item types.`);
	}
	const existingKind = existingKinds.values().next().value;
	if (existingKind && existingKind !== itemKind) {
		throw new Error(
			`Appending to list variable "${name}" requires ${existingKind} items, but the new item is ${itemKind}.`,
		);
	}
}

function getListItemKind(value: JsonValue) {
	if (typeof value === "string") return "string";
	if (typeof value === "number" && Number.isFinite(value)) return "number";
	if (typeof value === "boolean") return "boolean";
	if (!value || Array.isArray(value) || typeof value !== "object") return undefined;
	if (value.type === "datetime") return "datetime";
	if (value.type === "duration") return "duration";
	return "object";
}

function getClearedSimulationValue(value: JsonValue | undefined, name: string): JsonValue {
	if (value === undefined) {
		throw new Error(`Clearing requires existing variable "${name}".`);
	}
	if (typeof value === "string") return "";
	if (typeof value === "number") return 0;
	if (typeof value === "boolean") return false;
	if (Array.isArray(value)) return [];
	if (!value || typeof value !== "object") {
		throw new Error(`Existing variable "${name}" has an unsupported value type.`);
	}
	if (value.type === "datetime") {
		return { type: "datetime", value: "1970-01-01T00:00:00.000Z" };
	}
	if (value.type === "duration") {
		return { type: "duration", unit: "seconds", value: 0 };
	}
	return {};
}

function resolveVariableInput(
	value: string,
	type: VariableType,
	context: SimulationContext,
	api: VariableOperationSimulationApi,
): JsonValue {
	const resolved = api.resolveTemplate(value, context);
	if (typeof resolved !== "string") {
		return resolved;
	}

	if (type === "number") {
		return parseFiniteNumber(resolved, "Variable value");
	}

	if (type === "boolean") {
		if (resolved.trim().toLowerCase() === "true") return true;
		if (resolved.trim().toLowerCase() === "false") return false;
		throw new Error("Variable value must be true or false.");
	}

	if (type === "list" || type === "object" || type === "duration" || type === "datetime") {
		const parsed = api.parseJsonValue(resolved);
		if (parsed === undefined) throw new Error(`Variable value must be valid JSON for type "${type}".`);
		if (type === "list" && !Array.isArray(parsed)) throw new Error("Variable value must be a JSON list.");
		if (type !== "list" && (!parsed || typeof parsed !== "object" || Array.isArray(parsed))) {
			throw new Error(`Variable value must be a JSON object for type "${type}".`);
		}
		return parsed;
	}

	return resolved;
}

function parseFiniteNumber(value: JsonValue | undefined, label: string) {
	const normalized = typeof value === "string" ? value.trim() : "";
	const parsed =
		typeof value === "number" ? value : decimalNumberPattern.test(normalized) ? Number(normalized) : Number.NaN;
	if (!Number.isFinite(parsed)) throw new Error(`${label} must be a finite number.`);
	return parsed;
}

const decimalNumberPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

function setObjectPathValue(currentValue: JsonValue | undefined, path: string, value: JsonValue): JsonValue {
	const root =
		currentValue && typeof currentValue === "object" && !Array.isArray(currentValue) ? cloneJson(currentValue) : {};
	const parts = parseObjectPath(path);
	let cursor: Record<string, JsonValue> | JsonValue[] = root;

	for (let index = 0; index < parts.length; index += 1) {
		const part = parts[index];
		const isLast = index === parts.length - 1;

		if (isLast) {
			setPathContainerValue(cursor, part, value);
			break;
		}

		const nextPart = parts[index + 1];
		const existing = getPathContainerValue(cursor, part);
		const nextValue =
			existing && typeof existing === "object" ? cloneJson(existing) : typeof nextPart === "number" ? [] : {};

		setPathContainerValue(cursor, part, nextValue);
		cursor = nextValue as Record<string, JsonValue> | JsonValue[];
	}

	return root;
}

function removeObjectPathValue(currentValue: JsonValue, path: string) {
	const parts = parseObjectPath(path);
	let cursor: JsonValue = currentValue;

	for (let index = 0; index < parts.length - 1; index += 1) {
		const part = parts[index];
		if (!cursor || typeof cursor !== "object") {
			return false;
		}
		cursor = Array.isArray(cursor) ? cursor[Number(part)] : cursor[String(part)];
	}

	if (!cursor || typeof cursor !== "object") {
		return false;
	}
	const finalPart = parts.at(-1);
	if (finalPart === undefined) {
		return false;
	}
	if (Array.isArray(cursor)) {
		const itemIndex = Number(finalPart);
		if (!Number.isInteger(itemIndex) || itemIndex < 0 || itemIndex >= cursor.length) {
			return false;
		}
		cursor.splice(itemIndex, 1);
		return true;
	}
	if (!Object.hasOwn(cursor, String(finalPart))) {
		return false;
	}
	delete cursor[String(finalPart)];
	return true;
}

function jsonValuesEqual(left: JsonValue, right: JsonValue): boolean {
	if (left === right) {
		return true;
	}
	if (Array.isArray(left) && Array.isArray(right)) {
		return left.length === right.length && left.every((item, index) => jsonValuesEqual(item, right[index]));
	}
	if (
		left &&
		right &&
		typeof left === "object" &&
		typeof right === "object" &&
		!Array.isArray(left) &&
		!Array.isArray(right)
	) {
		const leftKeys = Object.keys(left);
		const rightKeys = Object.keys(right);
		return (
			leftKeys.length === rightKeys.length &&
			leftKeys.every((key) => Object.hasOwn(right, key) && jsonValuesEqual(left[key], right[key]))
		);
	}
	return false;
}

function getPathContainerValue(container: Record<string, JsonValue> | JsonValue[], key: string | number) {
	return Array.isArray(container) ? container[Number(key)] : container[String(key)];
}

function setPathContainerValue(
	container: Record<string, JsonValue> | JsonValue[],
	key: string | number,
	value: JsonValue,
) {
	if (Array.isArray(container)) {
		container[Number(key)] = value;
		return;
	}

	container[String(key)] = value;
}

function parseObjectPath(path: string): Array<string | number> {
	const normalized = path.trim();
	if (
		!/^[A-Za-z_][A-Za-z0-9_]*(?:\[(?:0|[1-9][0-9]*)\])*(?:\.[A-Za-z_][A-Za-z0-9_]*(?:\[(?:0|[1-9][0-9]*)\])*)*$/.test(
			normalized,
		)
	) {
		throw new Error(`Invalid object field path "${path}".`);
	}
	const parts = [...normalized.matchAll(/[A-Za-z_][A-Za-z0-9_]*|\[(0|[1-9][0-9]*)\]/g)].map((match) =>
		match[1] === undefined ? match[0] : Number(match[1]),
	);
	const oversizedIndex = parts.find((part) => typeof part === "number" && part >= 100_000);
	if (oversizedIndex !== undefined) {
		throw new Error(`Object field path index ${oversizedIndex} exceeds the maximum supported index 99999.`);
	}
	return parts;
}

function cloneJson<T extends JsonValue>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

function configString(value: JsonValue | undefined) {
	if (typeof value === "string") {
		return value;
	}

	if (value === undefined || value === null) {
		return "";
	}

	return String(value);
}
