import { expect, test } from "@playwright/test";
import regexConformance from "../../contracts/regex-conformance.json";
import { executeTextTransform, formatTextNode } from "../../data/nodes/definitions/actions/format-text";
import type { JsonValue } from "../../lib/types";

const variables: Record<string, JsonValue> = {
	paddingLength: 3,
	items: ["one", "two"],
};

const resolveTemplate = (value: string): JsonValue => {
	const reference = /^\{\{\s*([^{}]+?)\s*}}$/.exec(value);
	return reference ? (variables[reference[1]] ?? value) : value;
};

function pipeline(input: JsonValue, operations: JsonValue[]) {
	return { input, operations } as Record<string, JsonValue>;
}

test("editor runs text operations sequentially", async () => {
	const result = await executeTextTransform({
		config: pipeline("  hello WORLD  ", [
			{ id: "trim", operation: "trim" },
			{ id: "case", operation: "sentence_case" },
			{ id: "replace", operation: "replace", search: "world", replacement: "BaudBound" },
		]),
		resolveTemplate,
	});

	expect(result).toEqual({
		ok: true,
		output: { items: [], text: "Hello BaudBound" },
	});
});

test("editor passes list output between split and join operations", async () => {
	const result = await executeTextTransform({
		config: pipeline("one,two,three", [
			{ id: "split", operation: "split", delimiter: "," },
			{ id: "join", operation: "join", delimiter: " | " },
		]),
		resolveTemplate,
	});

	expect(result).toEqual({
		ok: true,
		output: { items: [], text: "one | two | three" },
	});
});

test("editor returns list output when split is the final operation", async () => {
	const result = await executeTextTransform({
		config: pipeline("one,two", [{ id: "split", operation: "split", delimiter: "," }]),
		resolveTemplate,
	});

	expect(result).toEqual({
		ok: true,
		output: { items: ["one", "two"], text: "" },
	});
});

test("editor rejects incompatible pipeline values", async () => {
	const result = await executeTextTransform({
		config: pipeline("text", [
			{ id: "split", operation: "split", delimiter: "," },
			{ id: "trim", operation: "trim" },
		]),
		resolveTemplate,
	});
	expect(result.ok).toBe(false);
});

test("editor rejects non-portable and empty operation values", async () => {
	const cases: JsonValue[][] = [
		[{ id: "replace", operation: "replace", search: "", replacement: "x" }],
		[{ id: "split", operation: "split", delimiter: "" }],
		[{ id: "pad", operation: "pad_start", targetLength: "3", pad: "" }],
		[{ id: "lookahead", operation: "regex_replace", search: "(?=t)", replacement: "x" }],
		[{ id: "whole", operation: "regex_replace", search: "(t)", replacement: "$0" }],
		[{ id: "unsafe", operation: "substring", start: "9007199254740992" }],
		[{ id: "unknown", operation: "not_supported" }],
	];

	for (const operations of cases) {
		const result = await executeTextTransform({
			config: pipeline("text", operations),
			resolveTemplate,
		});
		expect(result.ok, JSON.stringify(operations)).toBe(false);
	}
});

test("editor trims safe integer fields and supports numbered regex captures", async () => {
	expect(
		await executeTextTransform({
			config: pipeline("abcd", [{ id: "substring", operation: "substring", start: " 1 ", length: " 2 " }]),
			resolveTemplate,
		}),
	).toEqual({ ok: true, output: { items: [], text: "bc" } });

	expect(
		await executeTextTransform({
			config: pipeline("first:last", [
				{
					id: "regex",
					operation: "regex_replace",
					search: "([^:]+):([^:]+)",
					replacement: "$2, $1",
				},
			]),
			resolveTemplate,
		}),
	).toEqual({ ok: true, output: { items: [], text: "last, first" } });
});

test("matches the shared linear-time regex replacement fixtures", async () => {
	for (const fixture of regexConformance.replacement_cases) {
		const result = await executeTextTransform({
			config: pipeline(fixture.input, [
				{
					id: fixture.name,
					operation: "regex_replace",
					replacement: fixture.replacement,
					search: fixture.pattern,
				},
			]),
			resolveTemplate,
		});
		expect(result, fixture.name).toEqual({ ok: true, output: { items: [], text: fixture.output } });
	}
});

test("text transform export retains only ordered operation fields", () => {
	const config = formatTextNode.sanitizeConfig?.({
		customName: "Normalize title",
		input: "{{test}}",
		operations: [
			{
				id: "trim",
				operation: "trim",
				search: "unused",
			},
			{
				id: "replace",
				operation: "replace",
				search: "old",
				replacement: "new",
				delimiter: "unused",
			},
		],
	});

	expect(config).toEqual({
		customName: "Normalize title",
		input: "{{test}}",
		operations: [
			{ id: "trim", operation: "trim" },
			{ id: "replace", operation: "replace", replacement: "new", search: "old" },
		],
	});
});
