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

test("a whole number can be declared as a float", async () => {
	const { validateManifestContract } = await import("../utils/package-contract.ts");
	const { validateTypedValue } = await import("../data/project/typed-values.ts");

	// JavaScript has one number type and writes 300.0 as `300`, so demanding a
	// decimal part would make a whole float impossible to enter at all. The
	// declaration beside the value is what settles its type.
	assert.equal(validateTypedValue("float", 300), null);
	assert.equal(validateTypedValue("float", 300.5), null);
	assert.equal(validateTypedValue("float", Number.NaN), "Enter a finite number within the supported runtime range.");

	// A value flowing through a run is unaffected: there, 300 is an integer.
	const { validateSimulatedValue } = await import("../utils/value-cast.ts");
	assert.notEqual(validateSimulatedValue(300, "float"), null);
	assert.equal(validateSimulatedValue(300.5, "float"), null);

	// The export check is the one that used to refuse this, so drive it rather
	// than a stand-in: a float setting defaulting to 300 raises no error about
	// its default.
	const settingErrors = (defaultValue: unknown) =>
		validateManifestContract({
			settings: [{ name: "speed", type: "float", description: "", required: false, default_value: defaultValue }],
		}).filter((error) => error.includes("speed") && error.includes("default"));
	assert.deepEqual(settingErrors(300), []);
	assert.deepEqual(settingErrors(300.5), []);
	assert.notDeepEqual(settingErrors("300"), []);
});

test("a declared variable settles the operation's scope and type", async () => {
	const { validatePackageJsonContracts } = await import("../utils/package-contract.ts");

	// The inspector derives scope and type from the declaration and writes them
	// back into the config, so the combination the package check rejects can no
	// longer be produced by editing the node. This pins the rule being relied
	// on: a mismatch is an error, and the derived values are what satisfies it.
	const contract = (variableScope: string, operationScope: string, operationType: string) =>
		validatePackageJsonContracts({
			"manifest.json": {
				variables: [{ name: "counter", scope: variableScope, type: "integer", value: 5, description: "" }],
			},
			"program.json": {
				entry: {
					program: {
						steps: [
							{
								id: "n-1",
								action_type: "runtime.set_variable",
								config: {
									name: "counter",
									operation: "set",
									scope: operationScope,
									valueType: operationType,
									value: "9",
								},
							},
						],
					},
				},
			},
		} as never).filter((error) => error.includes("counter"));

	// What the inspector now produces for a declared persistent integer.
	assert.deepEqual(contract("persistent", "persistent", "integer"), []);
	// What it used to be possible to type by hand.
	assert.notDeepEqual(contract("persistent", "runtime", "integer"), []);
	assert.notDeepEqual(contract("persistent", "persistent", "string"), []);
});

test("a trigger's overlap mode falls back to queue", async () => {
	const { triggerOverlapMode } = await import("../data/nodes/definitions/shared-fields.ts");

	assert.equal(triggerOverlapMode({ data: { config: { overlap: "stop" } } }), "stop");
	assert.equal(triggerOverlapMode({ data: { config: { overlap: "restart" } } }), "restart");
	assert.equal(triggerOverlapMode({ data: { config: { overlap: "skip" } } }), "skip");

	// A script written before the option existed, or carrying a value from a
	// newer editor, keeps today's behaviour rather than being refused.
	assert.equal(triggerOverlapMode({ data: { config: {} } }), "queue");
	assert.equal(triggerOverlapMode({ data: { config: { overlap: "nonsense" } } }), "queue");
	assert.equal(triggerOverlapMode(undefined), "queue");
});

test("every system variable the picker offers is one the runner supplies", async () => {
	const { builtInVariableGroups } = await import("../data/project/built-in-variables.ts");
	// Only the producing code. The file's own tests name every variable too,
	// so reading the whole file would pass even if the producer supplied none.
	const producerFile = readFileSync(
		join(appRoot, "..", "baudbound", "crates", "baudbound-core", "src", "system_variables.rs"),
		"utf8",
	);
	const producer = producerFile.slice(0, producerFile.indexOf("#[cfg(test)]"));
	assert.ok(producer.length > 0, "the producer should be found");

	const offered = (builtInVariableGroups.find((group) => group.id === "system")?.variables ?? []).map(
		(variable) => variable.name,
	);
	assert.ok(offered.length > 0, "the system group should not be empty");

	// The editor offered these long before the runner supplied any of them, so
	// a script reading one printed the braces in production. Anything the
	// picker lists has to exist on the other side.
	for (const name of offered) {
		assert.ok(producer.includes(`"${name}"`), `the runner must supply ${name}`);
	}
});

test("derived parts match what the runner computes", async () => {
	const { derivedPartValue, datetimePartFields, durationPartFields } = await import("../data/project/derived-parts.ts");

	// The same values the runner's derived_part_tests assert, so simulation
	// and production cannot drift apart on the arithmetic.
	const datetime = { type: "datetime", value: "2026-07-03T14:30:45+03:00" };
	assert.equal(derivedPartValue(datetime, "$year"), 2026);
	assert.equal(derivedPartValue(datetime, "$month"), 7);
	assert.equal(derivedPartValue(datetime, "$day"), 3);
	assert.equal(derivedPartValue(datetime, "$hour"), 14, "read in the offset the value carries, not UTC");
	assert.equal(derivedPartValue(datetime, "$minute"), 30);
	assert.equal(derivedPartValue(datetime, "$second"), 45);
	assert.equal(derivedPartValue(datetime, "$weekday"), 5, "3 July 2026 is a Friday");

	// An offset the test machine does not share, so a Date-based implementation
	// converting to the local zone would report a different hour and fail here.
	// The example above cannot catch that when the machine happens to be +03:00.
	const elsewhere = { type: "datetime", value: "2026-07-03T14:30:45-05:00" };
	assert.equal(derivedPartValue(elsewhere, "$hour"), 14);
	assert.equal(derivedPartValue(elsewhere, "$day"), 3);
	assert.equal(derivedPartValue(elsewhere, "$weekday"), 5);

	const duration = { type: "duration", unit: "seconds", value: 90 };
	assert.equal(derivedPartValue(duration, "$days"), 0);
	assert.equal(derivedPartValue(duration, "$hours"), 0);
	assert.equal(derivedPartValue(duration, "$minutes"), 1, "components, not 1.5 minutes");
	assert.equal(derivedPartValue(duration, "$seconds"), 30);
	assert.equal(derivedPartValue(duration, "$total_milliseconds"), 90_000);

	assert.equal(derivedPartValue({ type: "duration", unit: "hours", value: 50 }, "$days"), 2);
	assert.equal(derivedPartValue({ type: "duration", unit: "hours", value: 50 }, "$hours"), 2);

	// Nothing for a value that has no parts, or a malformed one.
	assert.equal(derivedPartValue("just text", "$hour"), undefined);
	assert.equal(derivedPartValue({ type: "datetime", value: "not a date" }, "$hour"), undefined);

	// The field lists are what the picker offers, so they must match the names
	// the computation answers to.
	for (const field of [...datetimePartFields, ...durationPartFields]) {
		const source = field.name.startsWith("$total") || durationPartFields.includes(field) ? duration : datetime;
		assert.notEqual(derivedPartValue(source, field.name), undefined, `${field.name} should compute`);
	}
});
