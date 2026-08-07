import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	splitCast,
	validateNumericComparisonInput,
	validateVariableInput,
	validateVariableReferenceTypes,
} from "../data/nodes/config-field-validation.ts";
import { validateConditionVariableInputs } from "../data/nodes/definitions/shared.ts";
import { variableTypes } from "../data/project/variables.ts";
import { castSimulatedValue, validateSimulatedValue } from "../utils/value-cast.ts";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const vocabularyPath = join(appRoot, "contracts", "type-vocabulary.json");
const vocabulary = JSON.parse(readFileSync(vocabularyPath, "utf8")) as {
	types: Record<string, unknown>;
	version: number;
};

test("editor variable types match the shared vocabulary", () => {
	assert.equal(vocabulary.version, 1);
	assert.deepEqual([...variableTypes].sort(), Object.keys(vocabulary.types).sort());
});

test("deleted type names are gone", () => {
	for (const deleted of [
		"number",
		"file_content",
		"file_path",
		"http_headers",
		"process_id",
		"exit_code",
		"http_status_code",
		"duration_ms",
	]) {
		assert.ok(!(variableTypes as readonly string[]).includes(deleted), `${deleted} must be removed`);
	}
});

test("simulator agrees with the shared type fixtures", () => {
	const conformancePath = join(appRoot, "contracts", "type-conformance.json");
	const conformance = JSON.parse(readFileSync(conformancePath, "utf8")) as {
		cases: { reason: string; type: string; valid: boolean; value: unknown }[];
		version: number;
	};
	assert.equal(conformance.version, 1);

	for (const testCase of conformance.cases) {
		assert.equal(
			validateSimulatedValue(testCase.value, testCase.type) === null,
			testCase.valid,
			`${JSON.stringify(testCase.value)} as ${testCase.type}: ${testCase.reason}`,
		);
	}
});

test("cast suffix splits outside quotes", () => {
	assert.deepEqual(splitCast("item"), { reference: "item", target: null });
	assert.deepEqual(splitCast("item|string"), { reference: "item", target: "string" });
	assert.deepEqual(splitCast(" item | string "), { reference: "item", target: "string" });
	assert.deepEqual(splitCast('node["a|b"]'), { reference: 'node["a|b"]', target: null });
});

test("simulator agrees with the shared cast fixtures", () => {
	const conformance = JSON.parse(readFileSync(join(appRoot, "contracts", "cast-conformance.json"), "utf8")) as {
		cases: { error?: boolean; reason: string; result?: unknown; target: string; value: unknown }[];
		version: number;
	};
	assert.equal(conformance.version, 1);

	for (const testCase of conformance.cases) {
		const outcome = castSimulatedValue(testCase.value, testCase.target);
		if (testCase.error) {
			assert.equal(outcome.ok, false, `${JSON.stringify(testCase.value)} to ${testCase.target}: ${testCase.reason}`);
		} else {
			assert.equal(outcome.ok, true, `${JSON.stringify(testCase.value)} to ${testCase.target}: ${testCase.reason}`);
			if (outcome.ok) {
				assert.deepEqual(outcome.value, testCase.result, testCase.reason);
			}
		}
	}
});

test("a cast satisfies a field of the cast target type", () => {
	const variables = [{ name: "item", type: "integer" as const }];

	// Uncast, an integer does not satisfy a string field.
	assert.notEqual(validateVariableReferenceTypes("{{item}}", variables, "string"), "");
	// Cast, it does.
	assert.equal(validateVariableReferenceTypes("{{item|string}}", variables, "string"), "");
	// A cast to the wrong type is still rejected.
	assert.notEqual(validateVariableReferenceTypes("{{item|list}}", variables, "string"), "");
	// An unknown target is rejected.
	assert.notEqual(validateVariableReferenceTypes("{{item|int}}", variables, "string"), "");
});

test("a cast target is not treated as part of the variable name", () => {
	// The availability check runs before the type check, so if it looks the
	// reference up with the cast suffix still attached it reports every cast as
	// an unknown variable and the type check never runs.
	const variables = [{ name: "n-convert.value", type: "integer", readOnly: true }] as const;

	assert.equal(validateVariableInput("{{n-convert.value|string}}", variables, "any"), "");
	assert.equal(validateVariableInput("before {{n-convert.value|string}} after", variables, "any"), "");

	// The reference, not the whole expression, is named when it is missing.
	const missing = validateVariableInput("{{absent|string}}", variables, "any");
	assert.match(missing, /"absent"/);
	assert.doesNotMatch(missing, /\|string/);

	// An unknown target is still reported as such.
	assert.match(validateVariableInput("{{n-convert.value|nonsense}}", variables, "any"), /Unknown cast target/);
});

test("a numeric comparison accepts either numeric type", () => {
	// The operators read both sides as numbers, so requiring one of the two
	// would reject comparing a counter against a threshold.
	const variables = [
		{ name: "counter", type: "integer", readOnly: false },
		{ name: "ratio", type: "float", readOnly: false },
		{ name: "name", type: "string", readOnly: false },
	] as const;

	assert.equal(validateNumericComparisonInput("{{counter}}", variables), "");
	assert.equal(validateNumericComparisonInput("{{ratio}}", variables), "");
	assert.equal(validateNumericComparisonInput("5", variables), "");

	// Something that is not a number at all is still reported here rather than
	// only once the script runs.
	assert.match(validateNumericComparisonInput("{{name}}", variables), /needs an integer or a float/);

	// A cast decides the type, and a cast to a non numeric type is refused.
	assert.equal(validateNumericComparisonInput("{{name|float}}", variables), "");
	assert.match(validateNumericComparisonInput("{{counter|color}}", variables), /needs a number/);
});

test("verification agrees with the inspector about numeric comparisons", () => {
	// The inspector and the export verification validate conditions through
	// different entry points. When only one of them was taught that a
	// comparison takes either numeric type, a script looked fine while being
	// edited and then failed on export.
	const variables = [{ name: "n-convert.value", type: "integer", readOnly: true }] as const;
	const condition = (operator: string, extra: Record<string, string> = {}) => ({
		conditions: [{ id: "condition-1", left: "{{n-convert.value}}", operator, right: "0", ...extra }],
	});

	for (const operator of [">", ">=", "<", "<="]) {
		assert.deepEqual(validateConditionVariableInputs(condition(operator), variables), []);
	}
	assert.deepEqual(validateConditionVariableInputs(condition("is_between", { rightEnd: "10" }), variables), []);

	// A value that is not numeric at all is still reported.
	const wrong = validateConditionVariableInputs(
		{ conditions: [{ id: "condition-1", left: "{{name}}", operator: ">", right: "0" }] },
		[{ name: "name", type: "string" }],
	);
	assert.equal(wrong.length, 1);
	assert.match(wrong[0] ?? "", /needs an integer or a float/);
});

test("a value read out of an object is castable and says so", () => {
	// An HTTP response body is an object, so nothing can know the type of a
	// field inside it until the script runs. A cast is the only way through,
	// and the message has to name it or the author is left at a dead end.
	const variables = [{ name: "n-http.json", type: "object" as const }];

	const uncast = validateVariableReferenceTypes("{{n-http.json.ip}}", variables, "string");
	assert.notEqual(uncast, "");
	assert.match(uncast, /\{\{n-http\.json\.ip\|string\}\}/);

	assert.equal(validateVariableReferenceTypes("{{n-http.json.ip|string}}", variables, "string"), "");
	assert.equal(validateVariableReferenceTypes("Your ip is {{n-http.json.ip|string}}", variables, "string"), "");
	// The cast still has to produce what the field accepts.
	assert.notEqual(validateVariableReferenceTypes("{{n-http.json.ip|integer}}", variables, "string"), "");
});
