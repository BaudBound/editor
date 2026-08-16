import { Database } from "lucide-react";
import { typedDatetimeIso } from "@/data/project/datetime";
import type { VariableReferenceCandidate } from "@/data/project/variables";
import {
	getVariableOperationFixedType,
	type ListItemType,
	listItemTypes,
	normalizeVariableOperation,
	normalizeVariableReferenceName,
	type VariableType,
	validateVariableName,
	validateVariableOperationValue,
	variableTypes,
} from "@/data/project/variables";
import type { JsonValue } from "@/lib/types";
import type { SimulationContext } from "@/utils/simulation-types";
import { validateVariableInput } from "../../config-field-validation";
import { defineNode, type NodeSimulationApi } from "../../node-definition";
import { variableOperationOptions } from "../options";

export const variableOperationNode = defineNode({
	actionType: "runtime.set_variable",
	capabilities: ["runtime.variables"],
	// No Scope or Variable type control. Both belong to the declaration, which
	// is the only place they live now, so asking for them again on the node
	// offered an author a second answer that could contradict the first.
	configFields: [
		{ key: "operation", label: "Operation", type: "select", options: variableOperationOptions },
		{ key: "name", label: "Variable name", identifier: true, type: "text" },
	],
	defaultConfig: () => ({
		operation: "set",
		name: "",
		value: "",
		fieldPath: "",
		fieldValueType: "string",
		fieldItemType: "string",
		removeMode: "all",
	}),
	description: "Create, change, merge, clear, or reset variable values.",
	fallible: true,
	// Both read the declared scope rather than the node, which no longer has
	// one. An undeclared name yields the least privileged answer here; the
	// package contract refuses the write outright, so this is never the only
	// thing standing between a script and a permission it did not ask for.
	deriveCapabilities: (_config, declaredScope) =>
		declaredScope === "persistent" || declaredScope === "global"
			? ["runtime.variables", "runtime.persistent_storage"]
			: ["runtime.variables"],
	derivePermissions: (_config, declaredScope) => {
		if (declaredScope === "persistent") {
			return [{ name: "variable.persistent.set", risk: "medium" }];
		}
		if (declaredScope === "global") {
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
		// Neither scope nor type is checked here any more. The node does not
		// carry them: it names a declared variable, and the declaration settles
		// both. What this can still catch is a name that is not a legal
		// identifier, and an operation's own options.
		const fixedType = getVariableOperationFixedType(operation);
		const itemType = normalizeListItemType(configString(config.itemType));
		const fieldValueType = normalizeVariableTypeOrUndefined(configString(config.fieldValueType));
		const fieldItemType = normalizeListItemType(configString(config.fieldItemType));
		const valueType = fixedType;
		const errors = [
			nameError ? `has invalid variable name: ${nameError}` : "",
			operation === "remove_list_items" && !["first", "all"].includes(configString(config.removeMode))
				? `has invalid removal mode "${configString(config.removeMode) || "missing"}".`
				: "",
		];

		if (operation !== "clear" && operation !== "reset" && valueType) {
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
	validateVariables: validateVariableOperationVariables,
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
			// The declaration, like applyVariableOperation above. Reading the
			// node here and the declaration there would put the value in one
			// store and read it from another the moment the two disagreed.
			const variables = getVariableStore(declaredScope(name, context), context);
			variables[name] = result.value;

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

function validateVariableOperationVariables(
	config: Record<string, JsonValue>,
	variables: readonly VariableReferenceCandidate[],
) {
	const operation = normalizeVariableOperation(configString(config.operation));
	if (["clear", "reset", "toggle_boolean", "remove_object_field"].includes(operation)) return [];
	const targetName = normalizeVariableReferenceName(configString(config.name));
	const declaredTargetType = normalizeVariableTypeOrUndefined(
		configString(variables.find((variable) => variable.name === targetName)?.type),
	);
	// Increment applies to either an integer or a float variable. There is no
	// single exact-match contract for that, so accept either numeric type.
	const targetType =
		operation === "increment"
			? (["integer", "float"] as const)
			: operation === "merge_object"
				? "object"
				: operation === "set_object_field"
					? normalizeVariableType(configString(config.fieldValueType))
					: operation === "append_list" || operation === "remove_list_items"
						? "any"
						: (declaredTargetType ?? "any");
	const error = validateVariableInput(configString(config.value), variables, targetType);
	return error ? [`value: ${error}`] : [];
}

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
	// The declaration settles the type, as it does on the runner. An operation
	// that implies one still wins, because that is a property of the operation
	// rather than of the variable.
	const declared = context.declaredVariables[name];
	const type = getVariableOperationFixedType(operation) ?? normalizeVariableType(declared?.type ?? "");
	const itemType = normalizeListItemType(declared?.itemType ?? "");
	const fieldValueType = normalizeVariableType(configString(config.fieldValueType));
	const fieldItemType = normalizeListItemType(configString(config.fieldItemType));
	// From the declaration, matching the runner. A node no longer settles this.
	const scope = declaredScope(name, context);
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

	// Reset restores the declared default. Deleting the variable is not on
	// offer any more: a declaration is what makes a variable exist, so a run
	// cannot remove one and leave the rest of the script reading a name that
	// nothing declares.
	if (operation === "reset") {
		const value = structuredClone(declared.value);
		return {
			value,
			message: `Reset ${scopeLabel} variable "${name}" to its declared value ${api.formatValue(value)}.`,
		};
	}

	// Clear empties the variable for its declared type, whatever it holds now.
	// It used to derive the empty value from the current one, which made the
	// result depend on what happened to be stored rather than on what the
	// variable is.
	if (operation === "clear") {
		const value = getClearedSimulationValue(type);

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
	// scope, valueType and itemType are absent, not merely unused: they belong
	// to the declaration, the runner and simulator both read them from there,
	// and the node schema refuses a config that carries them.
	const base = ["customName", "operation", "name"];
	const operationKeys: Record<ReturnType<typeof normalizeVariableOperation>, string[]> = {
		set: ["value"],
		increment: ["value"],
		toggle_boolean: [],
		append_list: ["value"],
		remove_list_items: ["value", "removeMode"],
		set_object_field: ["fieldPath", "fieldValueType", "fieldItemType", "value"],
		remove_object_field: ["fieldPath"],
		merge_object: ["value"],
		clear: [],
		reset: [],
	};
	return new Set([...base, ...operationKeys[operation]]);
}

/** The scope a declared variable lives in, or runtime when it is undeclared. */
function declaredScope(name: string, context: SimulationContext) {
	return context.declaredVariables[name]?.scope ?? "runtime";
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
		if (type === "string" || type === "color" || type === "hotkey") return typeof value === "string";
		if (type === "integer") return typeof value === "number" && Number.isInteger(value);
		if (type === "float") return typeof value === "number" && Number.isFinite(value);
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
			return typedDatetimeIso(value) !== null;
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

/**
 * The empty value for a type — what Clear writes.
 *
 * Not createEmptyTypedValue, which gives a datetime the current instant: right
 * for a new declaration, wrong for clearing, where the empty datetime is the
 * epoch. Exported so the shared clear and reset fixtures can check it against
 * what the runner does.
 */
export function getClearedSimulationValue(type: VariableType): JsonValue {
	switch (type) {
		case "integer":
		case "float":
			return 0;
		case "boolean":
			return false;
		case "list":
			return [];
		case "object":
			return {};
		case "datetime":
			return { type: "datetime", value: "1970-01-01T00:00:00.000Z" };
		case "duration":
			return { type: "duration", unit: "seconds", value: 0 };
		// A color is a JSON string, but "" is not a color. Black is its empty
		// value, which is what the runner writes.
		case "color":
			return "#000000";
		default:
			return "";
	}
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

	if (type === "integer" || type === "float") {
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
