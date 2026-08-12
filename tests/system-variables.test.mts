import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	createSimulationBuiltInVariableValues,
	liveSystemFieldValues,
	MANIFEST_NAMESPACE,
	type ManifestVariableSource,
	SETTINGS_NAMESPACE,
	SYSTEM_NAMESPACE,
} from "../data/project/built-in-variables.ts";
import type { ScriptSetting } from "../lib/types.ts";
import { createEditorVariableRegistry, createVariablePanelEntries } from "../utils/editor-variables.ts";

const appRoot = fileURLToPath(new URL("..", import.meta.url));

const PROJECT_ID = "6db0f09c-2d76-4ea3-bb6b-9a093a04d8f7";
const CREATED_AT = "2026-07-03T14:30:00.000Z";

/** Enough of a project for the built-in resolvers to answer. */
function manifestSource(): ManifestVariableSource {
	return {
		identity: { id: PROJECT_ID, createdAt: CREATED_AT },
		settings: {
			author: "Tester",
			description: "",
			minimumRunnerVersion: "2.0.0",
			// Deliberately not the id. The resolver used to return this for
			// `@manifest.id`, so a name that could be mistaken for one would
			// have hidden the bug.
			name: "BRB-Timer",
			repositoryUrl: "https://example.com/repository.json",
			source: "",
			tags: ["utility", "timer"],
			targetRuntimes: ["Windows Desktop"],
			version: "1.0.0",
			website: "",
		},
	};
}

function systemObject(): Record<string, unknown> {
	const values = createSimulationBuiltInVariableValues(manifestSource());
	return values[SYSTEM_NAMESPACE] as Record<string, unknown>;
}

function manifestObject(): Record<string, unknown> {
	const values = createSimulationBuiltInVariableValues(manifestSource());
	return values[MANIFEST_NAMESPACE] as Record<string, unknown>;
}

test("@manifest.id is the project id, not the project name", () => {
	// It resolved to `settings.name` because the resolvers were handed only the
	// settings, and the id does not live there. A script reading its own id got
	// the name in the editor and a real id in a run, and the two are used for
	// different things: the id owns the script's stored variables and secrets.
	const manifest = manifestObject();

	assert.equal(manifest.id, PROJECT_ID);
	assert.notEqual(manifest.id, manifestSource().settings.name);
	assert.equal(manifest.name, "BRB-Timer", "the name is still the name");
});

test("@manifest carries the creation time and the tags", () => {
	const manifest = manifestObject();

	assert.deepEqual(manifest.tags, ["utility", "timer"]);
	// A datetime object rather than a bare string, so the component paths and
	// the format patterns read it like any other datetime.
	assert.deepEqual(manifest.created_at, { type: "datetime", value: CREATED_AT });

	// The repository a script is published to stays out: it is distribution
	// plumbing, and `source` already says where the script came from.
	assert.equal("repository_url" in manifest, false);
	assert.equal(manifest.source, "");
});

test("@system is a plain object that already holds the live fields", () => {
	// The clock used to be answered per reference and left out of the object,
	// so `{{@system.datetime}}` resolved while `{{@system}}` and
	// `{{@system.$count}}` reported an object two fields short of the runner's.
	const system = systemObject();

	assert.ok("datetime" in system, "the object must carry the clock");
	assert.ok("uptime" in system, "the object must carry the uptime");
	assert.deepEqual(Object.keys(system).includes("run_started_at"), true);
});

test("the Variables tab always has namespace objects without flattening script settings", () => {
	const scriptSettings: ScriptSetting[] = [
		{
			description: "The service endpoint.",
			name: "endpoint",
			required: false,
			simulationValue: "https://simulation.example",
			type: "string",
		},
	];
	const registry = createEditorVariableRegistry(manifestSource(), [], [], [], [], scriptSettings);
	const panel = createVariablePanelEntries(manifestSource(), [], [], [], [], scriptSettings);

	assert.ok(registry.some((variable) => variable.name === `${SETTINGS_NAMESPACE}.endpoint`));
	assert.ok(panel.some((variable) => variable.name === MANIFEST_NAMESPACE));
	assert.ok(panel.some((variable) => variable.name === SYSTEM_NAMESPACE));
	assert.deepEqual(panel.find((variable) => variable.name === SETTINGS_NAMESPACE)?.value, {
		endpoint: "https://simulation.example",
	});
	assert.equal(
		panel.some((variable) => variable.name === `${SETTINGS_NAMESPACE}.endpoint`),
		false,
	);
	assert.equal(
		panel.some((variable) => variable.name === "settings"),
		false,
	);
});

test("the live fields carry the shapes their declared types promise", () => {
	const system = systemObject();

	// A datetime is an object with a type and an offset-carrying value, which
	// is what the format patterns and the component paths both read.
	const datetime = system.datetime as { type: string; value: string };
	assert.equal(datetime.type, "datetime");
	assert.match(datetime.value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);

	const uptime = system.uptime as { type: string; unit: string; value: number };
	assert.equal(uptime.type, "duration");
	assert.equal(typeof uptime.value, "number");
	assert.ok(uptime.unit.length > 0, "a duration must name its unit");
});

test("a later reading of the live fields moves the clock forward", () => {
	// The whole reason these are rewritten per node execution: read once per
	// run they reported the same value until the run ended, which made the
	// clock useless in exactly the scripts that loop or delay.
	const earlier = liveSystemFieldValues(new Date("2026-07-03T14:30:00Z"));
	const later = liveSystemFieldValues(new Date("2026-07-03T14:30:05Z"));

	assert.notEqual(earlier.datetime.value, later.datetime.value);
});

test("a reference into @system resolves the live fields and counts them", async () => {
	// The simulator reaches a field by walking the object with this same
	// function, so resolving through it is the behaviour a `{{@system.…}}`
	// reference gets. It used to be answered by a separate interception that
	// ran before the object was consulted at all, which is why the object and
	// the reference could disagree.
	const { getPathValue } = await import("../utils/simulation.ts");
	const system = systemObject() as never;

	const datetime = getPathValue(system, "datetime") as { type: string } | undefined;
	assert.equal(datetime?.type, "datetime", "a direct field reference must resolve");
	assert.equal(typeof getPathValue(system, "datetime.value"), "string");
	assert.equal((getPathValue(system, "uptime") as { type: string } | undefined)?.type, "duration");

	// The metadata is computed from the object, so it only agrees with the
	// runner once the live fields are actually in there.
	const count = getPathValue(system, "$count");
	assert.equal(count, Object.keys(systemObject()).length);
	assert.ok((count as number) >= 15, `the count must include the live fields, got ${count}`);
});

test("liveSystemFieldValues names every field it claims and no other", () => {
	// Anything added here has to be a field the picker offers, or a script
	// would meet a key the editor never told it about.
	assert.deepEqual(Object.keys(liveSystemFieldValues()).toSorted(), ["datetime", "uptime"]);
});

/**
 * The runner's live-field producer, when the runner repository sits beside this
 * one. Editor CI clones this repository alone, so this skips there rather than
 * fail, matching the cross-repo guards in type-vocabulary.
 */
function runnerLiveSystemFields(): string | null {
	const path = join(appRoot, "..", "baudbound", "crates", "baudbound-runtime", "src", "execution", "initial_state.rs");
	if (!existsSync(path)) return null;
	const source = readFileSync(path, "utf8");
	const start = source.indexOf("pub(super) fn live_system_fields()");
	return start === -1 ? null : source.slice(start);
}

test("the editor refreshes exactly the fields the runner refreshes", async () => {
	// The two sides drifted once already: the runner wrote these into the
	// object per node execution while the editor answered them per reference,
	// so a simulated `{{@system}}` disagreed with a real one. Holding the sets
	// together is what stops the same split happening again.
	const producer = runnerLiveSystemFields();
	if (producer === null) return;
	assert.ok(producer.length > 0, "the producer should be found");

	for (const field of Object.keys(liveSystemFieldValues())) {
		assert.ok(producer.includes(`"${field}"`), `the runner must also refresh ${field}`);
	}

	// And nothing the runner refreshes may be missing here, which is the
	// direction that would leave a simulated object short again.
	for (const field of ["datetime", "uptime"]) {
		if (!producer.includes(`"${field}"`)) continue;
		assert.ok(field in liveSystemFieldValues(), `the editor must also refresh ${field}`);
	}
});
