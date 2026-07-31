import { TextCursorInput } from "lucide-react";
import type { JsonValue } from "@/lib/types";
import { defineNode, withFailureErrorOutput } from "../../node-definition";
import { textTransformOperationOptions } from "../options";
import {
	createTextTransformOperationRow,
	getTextTransformOperationRows,
	type TextTransformOperationRow,
} from "../rows";

const textTransformOperations = textTransformOperationOptions.map((option) => option.value);
const unicodeLetterPattern = /\p{Alphabetic}/u;
const whitespacePattern = /\p{White_Space}/u;
type TextTransformOperation = (typeof textTransformOperations)[number];

export const formatTextNode = defineNode({
	actionType: "action.text.format",
	capabilities: ["action.text"],
	configFields: [{ key: "input", label: "Input", type: "textarea", usesVariables: true, variableTypes: "any" }],
	defaultConfig: () => ({
		input: "",
		operations: [createTextTransformOperationRow()],
	}),
	description: "Run an ordered pipeline of text operations.",
	fallible: true,
	group: "actions",
	icon: TextCursorInput,
	kind: "action",
	label: "Text Transform",
	permission: { name: "text.transform", risk: "low" },
	risk: "low",
	runtimeOutputs: withFailureErrorOutput([
		{
			name: "text",
			type: "string",
			description: "Final text result. Empty when the final operation produces a list.",
		},
		{
			name: "items",
			type: "list",
			description: "Final list result. Empty when the final operation produces text.",
		},
	]),
	runnerType: "format_text",
	sanitizeConfig: sanitizeTextTransformConfig,
	validateConfig: validateTextTransformConfig,
	simulation: {
		createOutput: ({ api, context, node }) => {
			const result = executeTextTransform({
				config: node.data.config,
				resolveTemplate: (value) => api.resolveTemplate(value, context),
			});
			if (!result.ok) {
				return {
					failed: true,
					outputData: {
						error: api.createError(result.error, "TEXT_TRANSFORM_FAILED", "validation", {
							operation_index: result.operationIndex,
						}),
					},
				};
			}
			return { failed: false, outputData: result.output };
		},
		describe: ({ context, failed, node }) => {
			const operations = getTextTransformOperationRows(node.data.config.operations);
			if (failed) {
				return [{ level: "error", message: `[Simulation] Text Transform (${node.id}) failed.` }];
			}
			const output = context.nodeOutputs[node.id] ?? {};
			const result = Array.isArray(output.items) && output.items.length > 0 ? output.items : output.text;
			return [
				{
					level: "info",
					message: `[Simulation] Text Transform (${node.id}) ran ${operations.length} operation${operations.length === 1 ? "" : "s"}. Result: ${truncateText(stringifyItem(result), 160)}.`,
				},
			];
		},
	},
});

type ExecuteTextTransformParams = {
	config: Record<string, JsonValue>;
	resolveTemplate: (value: string) => JsonValue;
};

type TextTransformResult =
	| { ok: true; output: Record<string, JsonValue> }
	| { error: string; ok: false; operationIndex: number };

export function executeTextTransform({ config, resolveTemplate }: ExecuteTextTransformParams): TextTransformResult {
	const operations = getTextTransformOperationRows(config.operations);
	let current = resolveTemplate(configString(config.input));

	try {
		for (const [index, row] of operations.entries()) {
			const result = executeOperation(current, row, resolveTemplate);
			if (!result.ok) {
				return { ...result, operationIndex: index + 1 };
			}
			current = result.value;
		}
		return {
			ok: true,
			output: Array.isArray(current) ? { text: "", items: current } : { text: stringifyItem(current), items: [] },
		};
	} catch (error) {
		return {
			error: error instanceof Error ? error.message : "Text transform failed.",
			ok: false,
			operationIndex: 0,
		};
	}
}

function executeOperation(
	current: JsonValue,
	row: TextTransformOperationRow,
	resolveTemplate: (value: string) => JsonValue,
): { ok: true; value: JsonValue } | { error: string; ok: false } {
	const operation = normalizeTextTransformOperation(row.operation);
	if (!operation) {
		return { error: `Unsupported text transform operation "${row.operation}".`, ok: false };
	}
	if (operation === "template") {
		return { ok: true, value: resolveTemplate(row.template) };
	}
	if (operation === "join") {
		if (!Array.isArray(current)) {
			return { error: "Join requires a list from the input or the previous operation.", ok: false };
		}
		const delimiter = resolveToString(row.delimiter, resolveTemplate);
		if (!delimiter) return { error: "Join delimiter is required.", ok: false };
		return { ok: true, value: current.map(stringifyItem).join(delimiter) };
	}
	if (typeof current !== "string") {
		return {
			error: `${formatOperationName(operation)} requires text from the input or previous operation.`,
			ok: false,
		};
	}

	const search = resolveToString(row.search, resolveTemplate);
	const replacement = resolveToString(row.replacement, resolveTemplate);
	const delimiter = resolveToString(row.delimiter, resolveTemplate);
	const pad = resolveToString(row.pad, resolveTemplate);

	if (operation === "trim") return { ok: true, value: current.trim() };
	if (operation === "uppercase") return { ok: true, value: current.toUpperCase() };
	if (operation === "lowercase") return { ok: true, value: current.toLowerCase() };
	if (operation === "sentence_case") return { ok: true, value: toSentenceCase(current) };
	if (operation === "capitalize_words") return { ok: true, value: capitalizeWords(current) };
	if ((operation === "replace" || operation === "regex_replace") && !search) {
		return { error: "Search text is required.", ok: false };
	}
	if ((operation === "split" || operation === "join") && !delimiter) {
		return { error: "Delimiter is required.", ok: false };
	}
	if (operation === "replace") return { ok: true, value: current.replaceAll(search, replacement) };
	if (operation === "regex_replace") {
		const portabilityError = portableRegexError(search, replacement);
		if (portabilityError) return { error: portabilityError, ok: false };
		return { ok: true, value: current.replace(new RegExp(search, "gu"), replacement) };
	}
	if (operation === "split") return { ok: true, value: current.split(delimiter) };
	if (operation === "substring") {
		const start = parseNonNegativeInteger(resolveToString(row.start, resolveTemplate), "Substring start");
		const rawLength = resolveToString(row.length, resolveTemplate).trim();
		const length = rawLength ? parseNonNegativeInteger(rawLength, "Substring length") : undefined;
		return { ok: true, value: substringByCodePoints(current, start, length) };
	}
	if (operation === "pad_start" || operation === "pad_end") {
		const targetLength = parseNonNegativeInteger(resolveToString(row.targetLength, resolveTemplate), "Target length");
		if (!pad) return { error: "Pad text is required.", ok: false };
		return { ok: true, value: padByCodePoints(current, targetLength, pad, operation === "pad_start") };
	}
	if (operation === "url_encode") return { ok: true, value: encodeURIComponent(current) };
	if (operation === "url_decode") return { ok: true, value: decodeURIComponent(current) };
	if (operation === "base64_encode") return { ok: true, value: encodeBase64(current) };
	if (operation === "base64_decode") return { ok: true, value: decodeBase64(current) };
	if (operation === "json_escape") return { ok: true, value: JSON.stringify(current) };
	if (operation === "json_unescape") {
		const parsed = JSON.parse(current) as JsonValue;
		return { ok: true, value: typeof parsed === "string" ? parsed : stringifyItem(parsed) };
	}
	return { error: `Unsupported text transform operation "${row.operation}".`, ok: false };
}

function validateTextTransformConfig(config: Record<string, JsonValue>) {
	const errors: string[] = [];
	if (!configString(config.input).trim()) errors.push("must define input.");
	if (!Array.isArray(config.operations) || config.operations.length === 0) {
		errors.push("must define at least one text operation.");
		return errors;
	}
	for (const [index, row] of getTextTransformOperationRows(config.operations).entries()) {
		const operation = row.operation;
		const prefix = `operation ${index + 1}`;
		if (!textTransformOperations.includes(operation)) errors.push(`${prefix} is not supported.`);
		for (const field of textTransformValidatedFields) {
			const error = validateTextTransformField(row, field);
			if (error) {
				errors.push(`${prefix}: ${error}`);
			}
		}
	}
	return errors;
}

export function validateTextTransformField(
	row: TextTransformOperationRow,
	field: keyof Omit<TextTransformOperationRow, "id" | "operation">,
) {
	const operation = row.operation;
	const value = row[field];
	if (field === "template" && operation === "template" && !value.trim()) {
		return "Template is required.";
	}
	if (field === "search" && (operation === "replace" || operation === "regex_replace") && !value) {
		return operation === "regex_replace" ? "Regex pattern is required." : "Search text is required.";
	}
	if (field === "search" && operation === "regex_replace" && value) {
		try {
			new RegExp(value, "u");
		} catch {
			return "Regex pattern is invalid.";
		}
		return portableRegexError(value, row.replacement);
	}
	if (field === "delimiter" && (operation === "split" || operation === "join") && !value) {
		return "Delimiter is required.";
	}
	if (field === "start" && operation === "substring") {
		return staticIntegerError(value, "Start");
	}
	if (field === "length" && operation === "substring" && value.trim()) {
		return staticIntegerError(value, "Length");
	}
	if (field === "targetLength" && (operation === "pad_start" || operation === "pad_end")) {
		return staticIntegerError(value, "Target length");
	}
	if (field === "pad" && (operation === "pad_start" || operation === "pad_end") && !value) {
		return "Pad text is required.";
	}
	return "";
}

function sanitizeTextTransformConfig(config: Record<string, JsonValue>) {
	return {
		...(typeof config.customName === "string" ? { customName: config.customName } : {}),
		input: configString(config.input),
		operations: getTextTransformOperationRows(config.operations).map((row) => sanitizeOperation(row)),
	};
}

function sanitizeOperation(row: TextTransformOperationRow) {
	const operation = row.operation;
	const result: Record<string, JsonValue> = { id: row.id, operation };
	if (operation === "template") result.template = row.template;
	if (operation === "replace" || operation === "regex_replace") {
		result.search = row.search;
		result.replacement = row.replacement;
	}
	if (operation === "split" || operation === "join") result.delimiter = row.delimiter;
	if (operation === "substring") {
		result.start = row.start;
		if (row.length.trim()) result.length = row.length;
	}
	if (operation === "pad_start" || operation === "pad_end") {
		result.targetLength = row.targetLength;
		result.pad = row.pad;
	}
	return result;
}

function normalizeTextTransformOperation(value: string): TextTransformOperation | undefined {
	return textTransformOperations.includes(value) ? value : undefined;
}

function staticIntegerError(value: string, label: string) {
	if (!value.trim()) {
		return `${label} is required.`;
	}
	if (/\{\{[^{}]+}}/.test(value)) {
		return "";
	}
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed >= 0 ? "" : `${label} must be a non-negative safe integer.`;
}

const textTransformValidatedFields = [
	"template",
	"search",
	"replacement",
	"delimiter",
	"start",
	"length",
	"targetLength",
	"pad",
] as const satisfies readonly (keyof Omit<TextTransformOperationRow, "id" | "operation">)[];

function parseNonNegativeInteger(value: string, label: string) {
	const normalized = value.trim();
	const parsed = Number(normalized);
	if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${label} must be a non-negative safe integer.`);
	return parsed;
}

function portableRegexError(pattern: string, replacement: string) {
	if (/\(\?(?:[=!]|<[=!]|<[^=!])/.test(pattern)) {
		return "Regular expressions cannot use lookaround or named capture groups because they must work in both the editor and runner.";
	}
	if (/\\[1-9]/.test(pattern)) {
		return "Regular expressions cannot use backreferences in the search pattern because they must work in both the editor and runner.";
	}
	for (let index = 0; index < replacement.length; index += 1) {
		if (replacement[index] !== "$") continue;
		const next = replacement[index + 1];
		if (next === "$") {
			index += 1;
			continue;
		}
		if (next && /[1-9]/.test(next)) {
			while (/[0-9]/.test(replacement[index + 2] ?? "")) index += 1;
			index += 1;
			continue;
		}
		return "Regex replacements support numbered capture groups such as $1. Write a literal $ as $$.";
	}
	return "";
}

function resolveToString(value: string, resolveTemplate: (value: string) => JsonValue) {
	return stringifyItem(resolveTemplate(value));
}

function stringifyItem(value: JsonValue | undefined) {
	if (typeof value === "string") return value;
	if (value === undefined) return "";
	return JSON.stringify(value);
}

function codePointLength(value: string) {
	return Array.from(value).length;
}

function toSentenceCase(value: string) {
	const [first, ...rest] = Array.from(value);
	return first === undefined ? "" : `${first.toUpperCase()}${rest.join("").toLowerCase()}`;
}

function capitalizeWords(value: string) {
	let waitingForFirstLetter = true;
	let result = "";
	for (const character of value) {
		if (whitespacePattern.test(character)) {
			waitingForFirstLetter = true;
			result += character;
		} else if (!unicodeLetterPattern.test(character)) {
			result += character;
		} else {
			result += waitingForFirstLetter ? character.toUpperCase() : character.toLowerCase();
			waitingForFirstLetter = false;
		}
	}
	return result;
}

function substringByCodePoints(value: string, start: number, length?: number) {
	const codePoints = Array.from(value);
	return codePoints.slice(start, length === undefined ? undefined : start + length).join("");
}

function padByCodePoints(value: string, targetLength: number, pad: string, atStart: boolean) {
	const missing = Math.max(0, targetLength - codePointLength(value));
	const padCodePoints = Array.from(pad);
	if (missing === 0 || padCodePoints.length === 0) return value;
	const repeated = Array.from({ length: missing }, (_, index) => padCodePoints[index % padCodePoints.length]).join("");
	return atStart ? `${repeated}${value}` : `${value}${repeated}`;
}

function encodeBase64(value: string) {
	const bytes = new TextEncoder().encode(value);
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

function decodeBase64(value: string) {
	const encoded = value.trim();
	if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
		throw new Error("Invalid Base64 input. Use standard padded Base64 without embedded whitespace.");
	}
	const binary = atob(encoded);
	if (btoa(binary) !== encoded) throw new Error("Invalid Base64 input.");
	return new TextDecoder("utf-8", { fatal: true }).decode(
		Uint8Array.from(binary, (character) => character.charCodeAt(0)),
	);
}

function formatOperationName(operation: string) {
	return operation.replaceAll("_", " ");
}

function truncateText(value: string, maxLength: number) {
	return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}

function configString(value: JsonValue | undefined) {
	if (typeof value === "string") return value;
	if (value === undefined || value === null) return "";
	return String(value);
}
