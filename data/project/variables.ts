import type { Node } from "@xyflow/react";
import { runtimeNumberContract, validateNumericConfigValue } from "@/data/nodes/numeric-validation";
import { typedDatetimeIso } from "@/data/project/datetime";
import { userIdentifierPattern } from "@/data/project/user-identifier";
import type { JsonValue, RuntimeDataType, ScriptNodeData } from "@/lib/types";

export const variableTypes = [
	"string",
	"integer",
	"float",
	"boolean",
	"object",
	"list",
	"color",
	"keyboard_key",
	"datetime",
	"duration",
] as const;

export type VariableType = (typeof variableTypes)[number];

// A list element can be any type except a list, so nesting stays one level.
export const listItemTypes = variableTypes.filter((type) => type !== "list");

export type ListItemType = Exclude<VariableType, "list">;

export const durationUnits = ["milliseconds", "seconds", "minutes", "hours", "days"] as const;

export type DurationUnit = (typeof durationUnits)[number];

export const variableScopes = ["runtime", "persistent", "global"] as const;

export type VariableScope = (typeof variableScopes)[number];

export const variableOperations = [
	"set",
	"increment",
	"toggle_boolean",
	"append_list",
	"remove_list_items",
	"set_object_field",
	"remove_object_field",
	"merge_object",
	"clear",
	"delete",
] as const;

export type VariableOperation = (typeof variableOperations)[number];

export const reservedVariablePrefixes = ["manifest_", "system_"] as const;

export type EditorVariableScope = VariableScope | "secret" | "setting" | "manifest" | "system" | "node_output";

export type EditorVariableSource = "user" | "built_in" | "node_output" | "secret" | "setting";

export type EditorVariable<TValue extends JsonValue | undefined = JsonValue | undefined> = {
	description?: string;
	name: string;
	preTrigger?: boolean;
	read_only: boolean;
	scope: EditorVariableScope;
	source: EditorVariableSource;
	token: string;
	type: VariableType | RuntimeDataType;
	value?: TValue;
};

export type VariableReferenceCandidate = Pick<EditorVariable, "name" | "preTrigger" | "type" | "value">;

export type VariableReferenceStatus = "invalid" | "known" | "possible";

export const variableTypeDefinitions: Record<VariableType, { description: string; example: string }> = {
	string: {
		description: "Plain text. Variables are allowed inside the text.",
		example: "server ok",
	},
	number: {
		description: "A finite numeric value.",
		example: "42",
	},
	boolean: {
		description: "A true or false value.",
		example: "true",
	},
	object: {
		description: "A JSON object.",
		example: formatJson({ status: "ok", count: 1 }),
	},
	list: {
		description: "A JSON array.",
		example: formatJson(["api", "db", "cache"]),
	},
	datetime: {
		description: "A JSON datetime object with an ISO-8601 value.",
		example: formatJson({ type: "datetime", value: "2026-07-02T12:00:00Z" }),
	},
	duration: {
		description: "A JSON duration object with a unit and numeric value.",
		example: formatJson({ type: "duration", unit: "seconds", value: 10 }),
	},
	file_path: {
		description: "A file path string. Relative paths are resolved by the runner.",
		example: "./logs/output.txt",
	},
};

export const variableScopeDefinitions: Record<VariableScope, string> = {
	runtime: "Exists only during one script run.",
	persistent: "Stored between runs.",
	global: "Configured globally and available to scripts.",
};

export const variableOperationDefinitions: Record<
	VariableOperation,
	{ description: string; label: string; valueLabel: string }
> = {
	set: {
		label: "Set",
		valueLabel: "Value",
		description: "Create or replace the variable value.",
	},
	increment: {
		label: "Increment",
		valueLabel: "Amount",
		description: "Add a numeric amount to an existing or newly created number variable.",
	},
	toggle_boolean: {
		label: "Toggle boolean",
		valueLabel: "Toggle value",
		description: "Change true to false or false to true. A missing variable starts as false and becomes true.",
	},
	append_list: {
		label: "Append list",
		valueLabel: "Item",
		description: "Append one item to a list variable. The target variable type must be list.",
	},
	remove_list_items: {
		label: "Remove matching list items",
		valueLabel: "Matching item",
		description: "Remove the first or every list item that exactly matches the provided value.",
	},
	set_object_field: {
		label: "Set object field",
		valueLabel: "Field value",
		description: "Set a nested field inside an object variable. Missing object fields may be created by the runner.",
	},
	remove_object_field: {
		label: "Remove object field",
		valueLabel: "Field value",
		description: "Remove a nested field or list position using an object field path.",
	},
	merge_object: {
		label: "Merge object",
		valueLabel: "Object to merge",
		description: "Shallow merge an object into the variable. Incoming fields replace fields with the same name.",
	},
	clear: {
		label: "Clear",
		valueLabel: "Clear value",
		description: "Reset an existing variable to the empty value derived from its current type.",
	},
	delete: {
		label: "Delete variable",
		valueLabel: "Delete value",
		description: "Remove the variable completely instead of keeping an empty value.",
	},
};

export function getVariableOperationFixedType(operation: VariableOperation): VariableType | null {
	if (operation === "increment") {
		return "number";
	}

	if (operation === "toggle_boolean") {
		return "boolean";
	}

	if (operation === "append_list" || operation === "remove_list_items") {
		return "list";
	}

	if (operation === "set_object_field" || operation === "remove_object_field" || operation === "merge_object") {
		return "object";
	}

	return null;
}

export function validateVariableOperationValue(
	operation: VariableOperation,
	type: VariableType,
	value: string,
	path = "",
	itemType?: ListItemType,
	fieldValueType?: VariableType,
	fieldItemType?: ListItemType,
) {
	if (operation === "clear" || operation === "delete" || operation === "toggle_boolean") {
		return "";
	}

	const compatibilityMessage = validateVariableOperationType(operation, type);
	if (compatibilityMessage) {
		return compatibilityMessage;
	}

	if (operation === "increment") {
		return validateVariableValue("number", value).replace("Number variables", "Increment amount");
	}

	if (operation === "append_list" || operation === "remove_list_items") {
		return "";
	}

	if (operation === "remove_object_field") {
		return validateObjectFieldPath(path);
	}

	if (operation === "set_object_field") {
		const pathMessage = validateObjectFieldPath(path);
		if (pathMessage) {
			return pathMessage;
		}
		if (!fieldValueType) {
			return "Select the object field value type.";
		}
		return validateVariableValue(fieldValueType, value, fieldItemType);
	}

	if (operation === "merge_object") {
		return validateVariableValue("object", value);
	}

	return validateVariableValue(type, value, itemType);
}

export function validateVariableOperationType(operation: VariableOperation, type: VariableType) {
	if (operation === "increment" && type !== "number") {
		return "Increment can only be used with number variables.";
	}

	if ((operation === "append_list" || operation === "remove_list_items") && type !== "list") {
		return `${variableOperationDefinitions[operation].label} can only be used with list variables.`;
	}

	const fixedType = getVariableOperationFixedType(operation);
	if (fixedType && type !== fixedType) {
		return `${variableOperationDefinitions[operation].label} can only be used with ${fixedType} variables.`;
	}

	return "";
}

export function validateObjectFieldPath(path: string) {
	const trimmed = path.trim();

	if (!trimmed) {
		return "Object field path is required.";
	}

	return /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*|\[(?:0|[1-9][0-9]*)\])*$/.test(trimmed)
		? ""
		: "Object field path must use dot fields and numeric indexes, for example profile.name or users[0].name.";
}

export function normalizeVariableOperation(value: string): VariableOperation {
	return variableOperations.includes(value as VariableOperation) ? (value as VariableOperation) : "set";
}

export function validateVariableValue(type: VariableType, value: string, itemType?: ListItemType): string {
	const trimmed = value.trim();

	if (isTemplateReference(trimmed)) {
		return "";
	}

	if (type === "string") {
		return "";
	}

	if (type === "number") {
		return validateNumericConfigValue(trimmed, runtimeNumberContract)
			? "Number variables must be a finite decimal number within the supported runtime range, for example 42."
			: "";
	}

	if (type === "boolean") {
		return trimmed === "true" || trimmed === "false" ? "" : "Boolean variables must be true or false.";
	}

	if (type === "file_path") {
		return trimmed.length > 0 ? "" : "File path variables must not be empty.";
	}

	const parsed = parseJson(trimmed);
	if (!parsed.ok) {
		return "This variable type must be valid JSON.";
	}

	if (type === "list") {
		if (!Array.isArray(parsed.value)) {
			return "List variables must be a JSON array.";
		}
		if (!itemType || !listItemTypes.includes(itemType)) {
			return "Select the type used by every list item.";
		}
		for (const [index, item] of parsed.value.entries()) {
			const itemError = validateListItemValue(itemType, item as JsonValue);
			if (itemError) {
				return `List item ${index + 1}: ${itemError}`;
			}
		}
		return "";
	}

	if (type === "object") {
		return isRecord(parsed.value) ? "" : "Object variables must be a JSON object.";
	}

	if (!isRecord(parsed.value)) {
		return "This variable type must be a JSON object.";
	}

	if (type === "duration") {
		return parsed.value.type === "duration" &&
			typeof parsed.value.unit === "string" &&
			durationUnits.includes(parsed.value.unit as DurationUnit) &&
			typeof parsed.value.value === "number" &&
			Number.isFinite(parsed.value.value) &&
			parsed.value.value >= 0
			? ""
			: "Duration variables must include a supported unit and a nonnegative finite value.";
	}

	if (type === "datetime") {
		return typedDatetimeIso(parsed.value as JsonValue)
			? ""
			: "Datetime variables must include type and a valid RFC 3339 value field.";
	}

	return "";
}

function validateListItemValue(type: ListItemType, value: JsonValue): string {
	if (type === "string") {
		return typeof value === "string" ? "" : "Enter a text value.";
	}
	if (type === "file_path") {
		return typeof value === "string" && value.trim() ? "" : "Enter a file path.";
	}
	if (type === "number") {
		return typeof value === "number" &&
			Number.isFinite(value) &&
			!validateNumericConfigValue(String(value), runtimeNumberContract)
			? ""
			: "Enter a finite number within the supported runtime range.";
	}
	if (type === "boolean") {
		return typeof value === "boolean" ? "" : "Select true or false.";
	}
	if (type === "object") {
		return isRecord(value) ? "" : "Enter a JSON object.";
	}
	return validateVariableValue(type, JSON.stringify(value));
}

export function validateVariableName(name: string) {
	const trimmed = name.trim();

	if (!trimmed) {
		return "Variable name is required.";
	}

	if (!userIdentifierPattern.test(trimmed)) {
		return "Variable names may contain only letters A-Z, letters a-z, numbers 0-9, hyphens, and underscores.";
	}

	if (trimmed === "settings") {
		return 'The name "settings" is reserved for Script Settings.';
	}

	const reservedPrefix = reservedVariablePrefixes.find((prefix) => trimmed.startsWith(prefix));
	return reservedPrefix ? `Variable names starting with "${reservedPrefix}" are reserved.` : "";
}

export function validateWritableVariableName(name: string, readOnlyNames: ReadonlySet<string>) {
	const validationMessage = validateVariableName(name);
	if (validationMessage) {
		return validationMessage;
	}

	const normalizedName = normalizeVariableReferenceName(name);
	return readOnlyNames.has(normalizedName) ? `Variable "${normalizedName}" is read-only and cannot be changed.` : "";
}

export function normalizeVariableReferenceName(name: string) {
	const trimmed = name.trim();
	const templateMatch = trimmed.match(/^\{\{\s*([^{}]+?)\s*\}\}$/);

	return templateMatch ? templateMatch[1].trim() : trimmed;
}

export function normalizeIndexedVariableReference(name: string) {
	return name.replace(/\[(?:0|[1-9]\d*)\]/g, "[0]");
}

export function getVariableReferenceStatus(
	reference: string,
	variables: readonly VariableReferenceCandidate[],
): VariableReferenceStatus {
	const trimmedReference = reference.trim();
	const normalizedReference = normalizeIndexedVariableReference(trimmedReference);
	if (!normalizedReference) {
		return "invalid";
	}

	const normalizedVariables = variables.map((variable) => ({
		...variable,
		normalizedName: normalizeIndexedVariableReference(variable.name),
	}));
	if (normalizedVariables.some((variable) => variable.normalizedName === normalizedReference)) {
		return "known";
	}

	const parent = normalizedVariables
		.filter(
			(variable) =>
				normalizedReference.startsWith(`${variable.normalizedName}.`) ||
				normalizedReference.startsWith(`${variable.normalizedName}[`),
		)
		.sort((left, right) => right.normalizedName.length - left.normalizedName.length)[0];
	if (!parent) {
		return "invalid";
	}

	const usesOriginalParent =
		trimmedReference.startsWith(`${parent.name}.`) || trimmedReference.startsWith(`${parent.name}[`);
	const path = usesOriginalParent
		? trimmedReference.slice(parent.name.length)
		: normalizedReference.slice(parent.normalizedName.length);
	const parts = parseVariableReferencePath(path);
	if (!parts || !canContainNestedValues(parent.type, parent.value)) {
		return "invalid";
	}

	if (parent.value === undefined || parent.value === null) {
		return "possible";
	}

	let current: JsonValue | undefined = parent.value;
	for (const part of parts) {
		if (current === undefined || current === null || typeof current !== "object") {
			return "invalid";
		}

		if (Array.isArray(current)) {
			if (typeof part !== "number") {
				return "invalid";
			}
			if (part >= current.length) {
				return "possible";
			}
			current = current[part];
			continue;
		}

		const key = String(part);
		if (!(key in current)) {
			return "possible";
		}
		current = current[key];
	}

	return "known";
}

export function createRuntimeOutputFieldReference(outputName: string, outputType: RuntimeDataType, fieldName: string) {
	return outputType === "list" ? `${outputName}[0].${fieldName}` : `${outputName}.${fieldName}`;
}

export function createNodeOutputVariables(nodes: Node<ScriptNodeData>[]): EditorVariable[] {
	return nodes.flatMap((node) =>
		(node.data.runtimeOutputs ?? []).flatMap((output) => {
			const outputName = `${node.id}.${output.name}`;
			const outputVariable: EditorVariable = {
				description: output.description,
				name: outputName,
				read_only: true,
				scope: "node_output",
				source: "node_output",
				token: `{{${outputName}}}`,
				type: output.type,
				value: undefined,
			};
			const fieldVariables =
				output.fields?.map((field) => {
					const fieldName = createRuntimeOutputFieldReference(outputName, output.type, field.name);
					return {
						description: field.description,
						name: fieldName,
						read_only: true,
						scope: "node_output",
						source: "node_output",
						token: `{{${fieldName}}}`,
						type: field.type,
						value: undefined,
					} satisfies EditorVariable;
				}) ?? [];

			return [outputVariable, ...fieldVariables];
		}),
	);
}

export function createConfiguredVariableDefinitions(nodes: Node<ScriptNodeData>[]): EditorVariable[] {
	const variables = new Map<string, EditorVariable>();

	for (const node of nodes) {
		if (node.data.actionType !== "runtime.set_variable") {
			continue;
		}

		const name = normalizeVariableReferenceName(configString(node.data.config.name));
		if (!name || validateVariableName(name)) {
			continue;
		}

		const operation = normalizeVariableOperation(configString(node.data.config.operation));
		if (operation === "clear" || operation === "delete") {
			continue;
		}

		const fixedType = getVariableOperationFixedType(operation);
		variables.set(name, {
			description: `Written by Variable Operation node ${node.id} using ${variableOperationDefinitions[operation].label}.`,
			name,
			read_only: false,
			scope: normalizeVariableScope(configString(node.data.config.scope)),
			source: "user",
			token: `{{${name}}}`,
			type: fixedType ?? normalizeVariableType(configString(node.data.config.valueType)),
			value: undefined,
		});
	}

	return [...variables.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function createDerivedVariableMetadataDefinitions(variables: EditorVariable[]): EditorVariable[] {
	return variables.flatMap((variable) => {
		if (variable.name.includes(".$")) {
			return [];
		}

		return derivedVariableMetadataFields.map((field) => {
			const name = `${variable.name}.${field.name}`;
			return {
				description: `${field.description} Derived from ${variable.name}.`,
				name,
				read_only: true,
				scope: variable.scope,
				source: variable.source,
				token: `{{${name}}}`,
				type: field.type,
				value: getDerivedVariableMetadataValue(variable.value, field.name),
			} satisfies EditorVariable;
		});
	});
}

const derivedVariableMetadataFields = [
	{
		name: "$length",
		type: "number",
		description: "Length for strings, item count for lists, key count for objects.",
	},
	{
		name: "$count",
		type: "number",
		description: "Alias for $length.",
	},
	{
		name: "$type",
		type: "string",
		description: "Current value type.",
	},
	{
		name: "$is_empty",
		type: "boolean",
		description: "Whether the value is empty, null, or missing.",
	},
] as const;

function getDerivedVariableMetadataValue(
	value: JsonValue | undefined,
	field: (typeof derivedVariableMetadataFields)[number]["name"],
) {
	if (value === undefined) {
		return undefined;
	}

	if (field === "$length" || field === "$count") {
		return getValueLength(value);
	}

	if (field === "$type") {
		return getValueType(value);
	}

	return isValueEmpty(value);
}

function getValueLength(value: JsonValue | undefined) {
	if (typeof value === "string" || Array.isArray(value)) {
		return value.length;
	}

	if (value && typeof value === "object") {
		return Object.keys(value).length;
	}

	return 0;
}

function getValueType(value: JsonValue | undefined) {
	if (Array.isArray(value)) {
		return "list";
	}

	if (value === null) {
		return "null";
	}

	if (value === undefined) {
		return "missing";
	}

	return typeof value;
}

function isValueEmpty(value: JsonValue | undefined) {
	if (value === undefined || value === null) {
		return true;
	}

	if (typeof value === "string" || Array.isArray(value)) {
		return value.length === 0;
	}

	if (typeof value === "object") {
		return Object.keys(value).length === 0;
	}

	return false;
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

function normalizeVariableScope(value: string): VariableScope {
	return variableScopes.includes(value as VariableScope) ? (value as VariableScope) : "runtime";
}

function normalizeVariableType(value: string): VariableType {
	return variableTypes.includes(value as VariableType) ? (value as VariableType) : "string";
}

function parseJson(value: string): { ok: true; value: unknown } | { ok: false } {
	try {
		return { ok: true, value: JSON.parse(value) };
	} catch {
		return { ok: false };
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canContainNestedValues(type: EditorVariable["type"], value: JsonValue | undefined) {
	return type === "list" || type === "object" || type === "http_headers" || Array.isArray(value) || isRecord(value);
}

function parseVariableReferencePath(path: string): Array<number | string> | null {
	const parts: Array<number | string> = [];
	const pattern = /\.([A-Za-z_$][A-Za-z0-9_$]*)|\[((?:0|[1-9][0-9]*))\]/gy;
	let cursor = 0;

	while (cursor < path.length) {
		pattern.lastIndex = cursor;
		const match = pattern.exec(path);
		if (!match || match.index !== cursor) {
			return null;
		}

		parts.push(match[1] ?? Number(match[2]));
		cursor = pattern.lastIndex;
	}

	return parts.length > 0 ? parts : null;
}

function isTemplateReference(value: string) {
	return /^\{\{\s*[^{}]+\s*\}\}$/.test(value);
}

function formatJson(value: unknown) {
	return JSON.stringify(value, null, 2);
}
