import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { isSensitiveOrUnboundedPath, isUnboundedWritePath } from "../data/project/file-permissions.ts";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const conformancePath = join(appRoot, "contracts", "path-classification-conformance.json");

type PathCase = { path: string; reason: string; unbounded: boolean };
type PathConformance = { cases: PathCase[]; version: number };

const conformance = JSON.parse(readFileSync(conformancePath, "utf8")) as PathConformance;

test("shared path classification fixtures conform", () => {
	assert.equal(conformance.version, 1);
	assert.ok(conformance.cases.length > 0, "conformance fixtures must not be empty");

	for (const testCase of conformance.cases) {
		// Read and write classification share the same rules. Both are checked so
		// a change to one cannot silently diverge from the other.
		assert.equal(
			isSensitiveOrUnboundedPath(testCase.path),
			testCase.unbounded,
			`read classification for ${JSON.stringify(testCase.path)}: ${testCase.reason}`,
		);
		assert.equal(
			isUnboundedWritePath(testCase.path),
			testCase.unbounded,
			`write classification for ${JSON.stringify(testCase.path)}: ${testCase.reason}`,
		);
	}
});
