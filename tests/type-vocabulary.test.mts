import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { variableTypes } from "../data/project/variables.ts";
import { validateSimulatedValue } from "../utils/simulation.ts";

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
