import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	splitCast,
	validateVariableInput,
	validateVariableReferenceTypes,
} from "../data/nodes/config-field-validation.ts";
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
