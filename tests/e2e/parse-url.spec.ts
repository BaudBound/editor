import { expect, test } from "@playwright/test";
import { parseAbsoluteUrl } from "../../data/nodes/definitions/actions/parse-url";
import {
	createRuntimeOutputFieldReference,
	getVariableReferenceStatus,
	normalizeIndexedVariableReference,
} from "../../data/project/variables";

test("parses standard and custom absolute URLs", () => {
	expect(parseAbsoluteUrl("https://nat.gg:8443/test?param=value1&tag=one&tag=two#result")).toEqual({
		ok: true,
		output: {
			fragment: "result",
			host: "nat.gg",
			path: "/test",
			port: "8443",
			protocol: "https",
			query: "param=value1&tag=one&tag=two",
			query_parameters: [
				{ name: "param", value: "value1" },
				{ name: "tag", value: "one" },
				{ name: "tag", value: "two" },
			],
		},
	});

	expect(parseAbsoluteUrl("ptr://command/move?param=value1")).toEqual({
		ok: true,
		output: {
			fragment: "",
			host: "command",
			path: "/move",
			port: "",
			protocol: "ptr",
			query: "param=value1",
			query_parameters: [{ name: "param", value: "value1" }],
		},
	});
});

test("preserves duplicate parameters and decodes their names and values", () => {
	const result = parseAbsoluteUrl("custom://host/path?name=Baud%20Bound&tag=one&tag=two&empty");
	expect(result.ok).toBe(true);
	if (result.ok) {
		expect(result.output.query_parameters).toEqual([
			{ name: "name", value: "Baud Bound" },
			{ name: "tag", value: "one" },
			{ name: "tag", value: "two" },
			{ name: "empty", value: "" },
		]);
	}
});

test("rejects relative and malformed URLs", () => {
	for (const value of ["", "/relative/path?param=value", "https://[invalid"]) {
		expect(parseAbsoluteUrl(value).ok).toBe(false);
	}
});

test("normalizes valid list indexes for variable reference matching", () => {
	expect(normalizeIndexedVariableReference("node.query_parameters[0].name")).toBe("node.query_parameters[0].name");
	expect(normalizeIndexedVariableReference("node.query_parameters[42].value")).toBe("node.query_parameters[0].value");
	expect(createRuntimeOutputFieldReference("node.query_parameters", "list", "name")).toBe(
		"node.query_parameters[0].name",
	);
});

test("distinguishes known, possible, and invalid nested variable references", () => {
	const variables = [
		{ name: "items", type: "list" as const, value: undefined },
		{ name: "profile", type: "object" as const, value: { name: "BaudBound" } },
		{ name: "profile.name", type: "string" as const, value: "BaudBound" },
		{ name: "message", type: "string" as const, value: "hello" },
	];

	expect(getVariableReferenceStatus("items", variables)).toBe("known");
	expect(getVariableReferenceStatus("items[4].name", variables)).toBe("possible");
	expect(getVariableReferenceStatus("profile.name", variables)).toBe("known");
	expect(getVariableReferenceStatus("profile.repository.url", variables)).toBe("possible");
	expect(getVariableReferenceStatus("profile.name.length", variables)).toBe("invalid");
	expect(getVariableReferenceStatus("message.value", variables)).toBe("invalid");
	expect(getVariableReferenceStatus("missing.value", variables)).toBe("invalid");
});

test("uses available list and object values to confirm nested references", () => {
	const variables = [
		{
			name: "items",
			type: "list" as const,
			value: [{ details: { enabled: true } }],
		},
	];

	expect(getVariableReferenceStatus("items[0].details.enabled", variables)).toBe("known");
	expect(getVariableReferenceStatus("items[1].details.enabled", variables)).toBe("possible");
	expect(getVariableReferenceStatus("items.name", variables)).toBe("invalid");
});
