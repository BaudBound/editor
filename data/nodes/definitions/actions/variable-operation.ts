import { Database } from "lucide-react";
import {
	getClearedVariableValue,
	getVariableOperationFixedType,
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
		{ key: "valueType", label: "Variable type", type: "select", options: variableTypeOptions },
	],
	defaultConfig: () => ({
		operation: "set",
		name: "",
		scope: "runtime",
		valueType: "string",
		value: "",
		fieldPath: "",
	}),
	description: "Set, increment, append, clear, or edit variable values.",
	fallible: true,
	deriveCapabilities: (config) =>
		configString(config.scope) === "runtime"
			? ["runtime.variables"]
			: ["runtime.variables", "runtime.persistent_storage"],
	derivePermissions: (config) => {
		const scope = configString(config.scope);
		if (scope === "persistent") {
			return [{ name: "set_persistent_variable", risk: "medium" }];
		}
		if (scope === "global") {
			return [{ name: "set_global_variable", risk: "high" }];
		}
		return [{ name: "set_local_variable", risk: "low" }];
	},
	group: "actions",
	icon: Database,
	kind: "action",
	label: "Variable Operation",
	permission: { name: "set_local_variable", risk: "low" },
	risk: "low",
	runnerType: "set_variable",
	validateConfig: (config) => {
		const name = configString(config.name);
		const nameError = validateVariableName(name);
		const operation = normalizeVariableOperation(configString(config.operation));
		const rawType = configString(config.valueType);
		const scope = configString(config.scope);
		const fixedType = getVariableOperationFixedType(operation);
		const declaredType = variableTypes.find((type) => type === rawType);
		const valueType = fixedType ?? declaredType;
		const errors = [
			nameError ? `has invalid variable name: ${nameError}` : "",
			["runtime", "persistent", "global"].includes(scope) ? "" : `has invalid variable scope "${scope || "missing"}".`,
			valueType ? "" : `has invalid variable type "${rawType || "missing"}".`,
		];

		if (valueType) {
			const valueError = validateVariableOperationValue(
				operation,
				valueType,
				configString(config.value),
				configString(config.fieldPath),
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
	const operation = normalizeVariableOperation(configString(config.operation));
	const type = getVariableOperationFixedType(operation) ?? normalizeVariableType(configString(config.valueType));
	const scope = configString(config.scope);
	const variables = getVariableStore(scope, context);
	const scopeLabel = scope === "persistent" ? "persistent" : scope === "global" ? "global" : "runtime";
	const currentValue = variables[name];

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
		const value = [...(currentValue ?? []), item];

		return {
			value,
			message: `Appended ${api.formatValue(item)} to list variable "${name}".`,
		};
	}

	if (operation === "set_object_field") {
		const fieldPath = configString(config.fieldPath).trim();
		const fieldValue = api.resolveJsonCompatibleInput(configString(config.value), context);
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

	if (operation === "clear") {
		const value = resolveVariableInput(getClearedVariableValue(type), type, context, api);

		return {
			value,
			message: `Cleared ${scopeLabel} variable "${name}" to ${api.formatValue(value)}.`,
		};
	}

	const value = resolveVariableInput(configString(config.value), type, context, api);
	return {
		value,
		message: `Set ${scopeLabel} variable "${name}" to ${api.formatValue(value)}.`,
	};
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

	if (type === "list" || type === "object" || type === "duration" || type === "datetime" || type === "http_response") {
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
