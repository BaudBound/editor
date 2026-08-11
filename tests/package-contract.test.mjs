import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const contractsRoot = join(appRoot, "contracts");
const schemasRoot = contractsRoot;
const runnerCapabilityContractPath = join(contractsRoot, "runner", "node-capabilities.json");
const runnerPermissionContractPath = join(contractsRoot, "runner", "node-permissions.json");
const runnerPortContractPath = join(contractsRoot, "runner", "node-ports.json");
const runnerNumericContractPath = join(contractsRoot, "runner", "node-numeric-fields.json");
const editorKeyboardContractPath = join(appRoot, "data", "nodes", "windows-key-contract.json");
const runnerKeyboardContractPath = join(contractsRoot, "runner", "windows-keyboard-keys.json");
const colorMatchCasesPath = join(contractsRoot, "runner", "color-match-cases.json");
const conditionEqualityCasesPath = join(contractsRoot, "runner", "condition-equality-cases.json");

test("Windows keyboard contract excludes unsupported modifier aliases and matches the generated runner contract", () => {
	const editorContract = JSON.parse(read(editorKeyboardContractPath));
	const runnerContract = JSON.parse(read(runnerKeyboardContractPath));
	const modifierNames = editorContract.modifiers.flatMap((modifier) => [modifier.canonical, ...modifier.aliases]);

	assert.deepEqual(runnerContract, editorContract);
	assert.deepEqual(
		editorContract.modifiers.map((modifier) => modifier.canonical),
		["Ctrl", "Alt", "Shift", "Windows"],
	);
	for (const unsupported of ["Meta", "Cmd", "Command", "Option", "Super"]) {
		assert.equal(
			modifierNames.some((name) => name.toLowerCase() === unsupported.toLowerCase()),
			false,
			`${unsupported} must not be exposed by the Windows keyboard contract`,
		);
	}
});

test("editor color matching follows the shared Rust parity matrix", async () => {
	const { evaluateColorMatch } = await loadColorMatcher();
	const cases = JSON.parse(read(colorMatchCasesPath));

	for (const testCase of cases) {
		const evaluation = evaluateColorMatch(
			testCase.actual,
			testCase.expected,
			testCase.mode,
			testCase.tolerance_percent,
		);
		assert.equal(evaluation.ok, true, testCase.name);
		assert.equal(evaluation.value.matches, testCase.matches, testCase.name);
		assert.ok(
			Math.abs(evaluation.value.difference_percent - testCase.difference_percent) < 1e-12,
			`${testCase.name}: ${evaluation.value.difference_percent}`,
		);
	}
});

test("editor risk colors use the shared production severity palette", () => {
	const riskSource = read(join(appRoot, "data", "editor", "risk.ts"));
	const badgeSource = read(join(appRoot, "components", "ui", "badge.tsx"));

	assert.match(riskSource, /low:\s*\{[\s\S]*?color:\s*"#3ecf8e"/);
	assert.match(riskSource, /medium:\s*\{[\s\S]*?color:\s*"#f5a623"/);
	assert.match(riskSource, /const dangerRiskTone = \{[\s\S]*?color:\s*"#e62d3e"/);
	assert.match(riskSource, /high:\s*dangerRiskTone/);
	assert.match(riskSource, /dangerous:\s*dangerRiskTone/);
	assert.match(badgeSource, /high:\s*"border-baud-danger\/30 bg-baud-danger\/10 text-baud-danger"/);
	assert.match(badgeSource, /dangerous:\s*"border-baud-danger\/30 bg-baud-danger\/10 text-baud-danger"/);
	assert.doesNotMatch(badgeSource, /dangerous:[^\n]*baud-purple/);
});

test("editor condition equality follows the shared Rust parity matrix", async () => {
	const { conditionValuesEqual } = await loadConditionComparison();
	const cases = JSON.parse(read(conditionEqualityCasesPath));

	for (const testCase of cases) {
		assert.equal(
			conditionValuesEqual(testCase.left, testCase.right),
			testCase.expected,
			`${testCase.name} produced an unexpected result`,
		);
	}
});

test("calculate and for-each reject arbitrary input while accepting variable expressions", async () => {
	const { validateCalculationExpression } = await loadCalculationUtilities();
	const { validateListExpression } = await loadListExpressionUtilities();

	assert.equal(validateCalculationExpression("round({{settings.amount}} * 2)"), "");
	assert.match(validateCalculationExpression("{{settings.amount}} random text"), /trailing tokens|must be called/);
	assert.match(validateCalculationExpression("{{broken"), /invalid variable reference/);
	assert.equal(validateListExpression("[1, 2, 3]", "Items"), "");
	assert.equal(validateListExpression("{{settings.items}}", "Items"), "");
	assert.match(validateListExpression('{"not":"a list"}', "Items"), /must be a JSON list/);
	assert.match(validateListExpression("arbitrary text", "Items"), /valid JSON list syntax/);
});

test("datetime values use selectable timezones while retaining UTC storage", async () => {
	const { datetimeInTimeZoneToIso, formatDatetimeForTimeZone, formatTypedDatetimeForTemporalInput, typedDatetimeIso } =
		await loadDatetimeUtilities();

	assert.equal(datetimeInTimeZoneToIso("2026-01-15T12:00:00", "UTC"), "2026-01-15T12:00:00.000Z");
	assert.equal(datetimeInTimeZoneToIso("2026-01-15T12:00:00", "Europe/Helsinki"), "2026-01-15T10:00:00.000Z");
	assert.equal(datetimeInTimeZoneToIso("2026-07-15T12:00:00", "Europe/Helsinki"), "2026-07-15T09:00:00.000Z");
	assert.equal(formatDatetimeForTimeZone("2026-07-15T09:00:00.000Z", "Europe/Helsinki"), "2026-07-15T12:00:00");
	assert.equal(datetimeInTimeZoneToIso("2026-03-29T03:30:00", "Europe/Helsinki"), null);
	const typedDatetime = { type: "datetime", value: "2026-08-03T12:30:15Z" };
	assert.equal(typedDatetimeIso(typedDatetime), typedDatetime.value);
	assert.equal(formatTypedDatetimeForTemporalInput(typedDatetime, "datetime", "UTC"), "2026-08-03T12:30:15");
	assert.equal(formatTypedDatetimeForTemporalInput({ type: "datetime", value: "invalid" }, "datetime", "UTC"), null);
	assert.equal(formatTypedDatetimeForTemporalInput({ type: "datetime", value: "2026-02-30T12:30:15Z" }, "date"), null);

	const typedValueSource = read(join(appRoot, "data", "project", "typed-values.ts"));
	assert.match(
		typedValueSource,
		/case "datetime":\s*return \{ type: "datetime", value: new Date\(\)\.toISOString\(\) \};/,
	);
});

test("editor supports the complete If / Else condition operator set", async () => {
	const { compareConditionValues } = await loadConditionComparison();
	const cases = [
		["BaudBound", "equals_ignore_case", "baudbound", true],
		["BaudBound", "contains_ignore_case", "BOUN", true],
		// These test the type. Text that reads as a number is still text, so
		// is_numeric is exactly is_integer or is_float.
		[42, "is_numeric", null, true],
		[42.5, "is_numeric", null, true],
		["42.5", "is_numeric", null, false],
		["42px", "is_numeric", null, false],
		[42, "is_integer", null, true],
		[42.5, "is_integer", null, false],
		["42", "is_integer", null, false],
		[42.5, "is_float", null, true],
		[42, "is_float", null, false],
		["42.5", "is_float", null, false],
		["text", "is_string", null, true],
		[true, "is_boolean", null, true],
		[[1, 2], "is_list", null, true],
		[{ name: "BaudBound" }, "is_object", null, true],
		[{ name: "BaudBound" }, "has_key", "name", true],
		[{}, "has_key", "toString", false],
		[[1, 2], "contains_item", "2", true],
	];

	for (const [left, operator, right, expected] of cases) {
		assert.equal(await compareConditionValues(left, operator, right), expected, operator);
	}
	assert.equal(await compareConditionValues(5, "is_between", 1, 5), true, "inclusive range end");
	assert.equal(await compareConditionValues(1, "is_between", 1, 5), true, "inclusive range start");
	assert.equal(await compareConditionValues(6, "is_between", 1, 5), false, "outside range");

	const optionsSource = read(join(appRoot, "data", "nodes", "definitions", "options.ts"));
	for (const operator of [
		"is_between",
		"equals_ignore_case",
		"contains_ignore_case",
		"has_key",
		"contains_item",
		"is_numeric",
		"is_integer",
		"is_float",
		"is_string",
		"is_boolean",
		"is_list",
		"is_object",
		"is_null_or_missing",
	]) {
		assert.match(optionsSource, new RegExp(`value: "${operator}"`), operator);
	}
	for (const removedOperator of [
		"!=",
		"does_not_contain",
		"length_equals",
		"length_greater_than",
		"length_less_than",
		"is_text",
		"is_defined",
		"is_missing",
		"is_not_empty",
	]) {
		assert.doesNotMatch(optionsSource, new RegExp(`value: "${removedOperator}"`), removedOperator);
	}
});

test("condition schemas reject retired operators and require both range bounds", () => {
	const programSchema = JSON.parse(read(join(schemasRoot, "program.schema.json")));
	const operators = programSchema.$defs.conditionOperator.enum;
	assert.ok(operators.includes("is_between"));
	assert.ok(operators.includes("is_null_or_missing"));
	assert.ok(operators.includes("is_string"));

	for (const removedOperator of [
		"!=",
		"does_not_contain",
		"length_equals",
		"length_greater_than",
		"length_less_than",
		"is_null",
		"is_text",
		"is_defined",
		"is_missing",
		"is_not_empty",
	]) {
		assert.equal(operators.includes(removedOperator), false, removedOperator);
	}

	const rangeRule = programSchema.$defs.conditionRow.allOf.find(
		(rule) => rule.if?.properties?.operator?.const === "is_between",
	);
	assert.deepEqual(rangeRule.then.required, ["rightEnd"]);
	assert.equal(rangeRule.then.properties.right.minLength, 1);
	assert.equal(rangeRule.then.properties.rightEnd.minLength, 1);

	const ifSchema = JSON.parse(read(join(schemasRoot, "nodes", "control-if.schema.json")));
	assert.equal(
		ifSchema.$defs.config.properties.conditions.$ref,
		"https://schemas.baudbound.app/program.schema.json#/$defs/conditionRows",
	);
	const whileSchema = JSON.parse(read(join(schemasRoot, "nodes", "control-while.schema.json")));
	assert.equal(
		whileSchema.$defs.config.properties.conditions.$ref,
		"https://schemas.baudbound.app/program.schema.json#/$defs/conditionRows",
	);
});

test("editor color matching rejects malformed inputs without coercion", async () => {
	const { evaluateColorMatch } = await loadColorMatcher();
	const invalidCases = [
		["#fff", "#000000", "per_channel", 0],
		["rgb(256, 0, 0)", "#000000", "per_channel", 0],
		["rgb(1.5, 0, 0)", "#000000", "per_channel", 0],
		[{ r: 0, g: 0 }, "#000000", "per_channel", 0],
		[{ r: 0, g: 0, b: 0, a: 255 }, "#000000", "per_channel", 0],
		["#000000", "#000000", "unsupported", 0],
		["#000000", "#000000", "per_channel", -0.1],
		["#000000", "#000000", "per_channel", 100.1],
		["#000000", "#000000", "per_channel", Number.POSITIVE_INFINITY],
	];

	for (const [actual, expected, mode, tolerance] of invalidCases) {
		const evaluation = evaluateColorMatch(actual, expected, mode, tolerance);
		assert.equal(evaluation.ok, false, JSON.stringify({ actual, expected, mode, tolerance }));
		assert.ok(evaluation.error.length > 0);
	}
});

test("schemas are valid JSON", () => {
	for (const filePath of readJsonFiles(schemasRoot)) {
		assert.doesNotThrow(() => JSON.parse(read(filePath)), filePath);
	}
});

test("manifest metadata is bounded and untrusted links are validated", () => {
	const manifestSchema = JSON.parse(read(join(schemasRoot, "manifest.schema.json")));
	const contractSource = read(join(appRoot, "utils", "package-contract.ts"));

	assert.equal(manifestSchema.additionalProperties, false);
	assert.equal(manifestSchema.properties.name.maxLength, 128);
	assert.equal(manifestSchema.properties.description.maxLength, 4096);
	assert.equal(manifestSchema.properties.author.maxLength, 128);
	assert.equal(manifestSchema.properties.website.maxLength, 2048);
	assert.equal(manifestSchema.properties.source.maxLength, 2048);
	assert.equal(manifestSchema.properties.tags.maxItems, 32);
	assert.equal(manifestSchema.properties.assets.maxItems, 256);
	assert.equal(manifestSchema.properties.variables.maxItems, 256);
	assert.equal(manifestSchema.properties.secrets.maxItems, 256);
	assert.equal(manifestSchema.properties.settings.maxItems, 256);
	assert.match(contractSource, /absolute HTTP or HTTPS URL/);
	assert.match(contractSource, /unsupported control characters/);
	assert.match(contractSource, /maximumDefaultValueBytes/);
});

test("script repository schema is strict and bounded", () => {
	const schema = JSON.parse(read(join(schemasRoot, "repository.schema.json")));

	assert.equal(schema.additionalProperties, false);
	assert.deepEqual(schema.required, ["format", "format_version", "name", "scripts"]);
	assert.equal(schema.properties.format.const, "baudbound.repository");
	assert.equal(schema.properties.format_version.const, 1);
	assert.equal(schema.properties.scripts.maxItems, 1000);
	assert.equal(schema.$defs.script.additionalProperties, false);
	assert.equal(schema.$defs.release.additionalProperties, false);
	assert.equal(schema.$defs.release.properties.sha256.pattern, "^[0-9a-f]{64}$");
	assert.equal(schema.$defs.release.properties.size.minimum, 1);
	assert.equal(schema.$defs.release.properties.release_notes.maxLength, 8_000);
});

test("repository and package URLs must be public and anonymous", async () => {
	const { getAnonymousPublicHttpsUrlError, getDirectPackageUrlError, getRepositoryUrlError } =
		await loadScriptRepositoryUtilities();

	assert.equal(getRepositoryUrlError("https://example.com/repository.json"), "");
	assert.equal(getDirectPackageUrlError("https://example.com/releases/example.bbs"), "");
	for (const value of [
		"https://user:password@example.com/repository.json",
		"https://example.com/repository.json?token=secret",
		"https://example.com/repository.json?",
		"https://example.com/repository.json#release",
	]) {
		assert.notEqual(getRepositoryUrlError(value), "", value);
	}
	assert.notEqual(getAnonymousPublicHttpsUrlError("https://example.com/download%3Ftoken=secret"), "");
});

test("package filenames contain a safe script name and exact version", async () => {
	const { createScriptPackageFilename } = await loadScriptRepositoryUtilities();

	assert.equal(createScriptPackageFilename("Inventory Scanner", "1.2.0"), "inventory-scanner-1.2.0.bbs");
	assert.equal(createScriptPackageFilename("  Files / Reports  ", "2.0.0-beta.1"), "files-reports-2.0.0-beta.1.bbs");
	assert.equal(createScriptPackageFilename("CON", "1.0.0"), "script-con-1.0.0.bbs");
	assert.equal(createScriptPackageFilename("测试", "1.0.0"), "untitled-script-1.0.0.bbs");
	assert.ok(createScriptPackageFilename("a".repeat(500), "1.0.0").length <= 240);
	assert.throws(() => createScriptPackageFilename("Example", ""), /Script version is required/);
});

test("repository generation preserves other scripts and replaces the matching script", async () => {
	const { createScriptRepositoryDocument } = await loadScriptRepositoryUtilities();
	const createDocument = (scriptId, name, version, existingRepository) =>
		createScriptRepositoryDocument({
			bytes: new Uint8Array([1, 2, 3]),
			capabilities: [{ name: "runtime.variables" }],
			existingRepository,
			packageUrl: `https://example.com/packages/${scriptId}/${name.toLowerCase()}-${version}.bbs`,
			permissions: [{ name: "variable.local.set", risk: "low" }],
			projectSettings: {
				author: "Example Author",
				description: `${name} description`,
				minimumRunnerVersion: "2.0.0",
				name,
				repositoryUrl: "https://example.com/repository.json",
				source: "https://example.com/source",
				tags: ["example"],
				targetRuntimes: ["Windows Desktop"],
				version,
				website: "https://example.com",
			},
			releaseNotes: `${name} ${version}`,
			repositoryDescription: "Example scripts",
			repositoryHomepage: "https://example.com",
			repositoryName: "Example repository",
			riskLevel: "low",
			scriptId,
			publishedAt: new Date("2026-07-24T12:00:00.000Z"),
		});

	const firstId = "00000000-0000-4000-8000-000000000001";
	const secondId = "00000000-0000-4000-8000-000000000002";
	const first = await createDocument(firstId, "First", "1.0.0");
	const withSecond = await createDocument(secondId, "Second", "1.0.0", first);
	const updated = await createDocument(firstId, "First updated", "1.1.0", withSecond);

	assert.deepEqual(
		updated.scripts.map((script) => script.script_id),
		[firstId, secondId],
	);
	assert.equal(updated.scripts[0].name, "First updated");
	assert.equal(updated.scripts[0].latest.version, "1.1.0");
	assert.equal(updated.scripts[1].name, "Second");
});

test("source metadata uses only the current manifest source names", () => {
	const manifestSchema = JSON.parse(read(join(schemasRoot, "manifest.schema.json")));
	const builtInSource = read(join(appRoot, "data", "project", "built-in-variables.ts"));
	const projectSettingsSource = read(join(appRoot, "components", "modals", "project-settings-modal.tsx"));

	assert.ok(manifestSchema.properties.source);
	assert.equal("repository" in manifestSchema.properties, false);
	assert.equal(builtInSource.includes("repository_url"), false);
	assert.match(builtInSource, /manifestField\("source"/);
	assert.match(projectSettingsSource, /Repository URL/);
	assert.match(projectSettingsSource, /Source/);
});

test("generated node schemas are current", () => {
	assert.doesNotThrow(() => {
		execFileSync("node", ["scripts/generate-node-schemas.mjs", "--check"], {
			cwd: appRoot,
			stdio: "pipe",
		});
	});
});

test("generated numeric contract preserves exact editor ranges and conditional PID fields", () => {
	const contract = JSON.parse(read(runnerNumericContractPath));

	assert.equal(contract.version, 2);
	assert.deepEqual(contract.nodes["action.pixel.get"].x, {
		kind: "integer",
		signed: true,
		minimum: "-2147483648",
		maximum: "2147483647",
		minimum_inclusive: true,
		maximum_inclusive: true,
		label: "Screen X",
		required: true,
		allows_variables: true,
	});
	assert.equal(contract.nodes["control.repeat"].count.maximum, "18446744073709551615");
	assert.equal(contract.nodes["trigger.schedule"].every.allows_variables, true);
	assert.deepEqual(
		contract.nodes["action.message_box"].timeoutSeconds,
		contract.nodes["action.form_dialog"].timeoutSeconds,
	);
	for (const actionType of ["action.process.kill", "action.process.status", "action.window.focus"]) {
		assert.deepEqual(contract.nodes[actionType].target.when, { key: "matchMode", equals: "pid" });
		assert.equal(contract.nodes[actionType].target.maximum, "4294967295");
	}
});

test("every generated numeric field passes the editor boundary matrix", async () => {
	const { validateNumericConfigValue } = await loadNumericValidator();
	const contract = JSON.parse(read(runnerNumericContractPath));
	let testedFields = 0;

	for (const [actionType, fields] of Object.entries(contract.nodes)) {
		for (const [key, field] of Object.entries(fields)) {
			const name = `${actionType}.${key}`;
			const editorContract = {
				kind: field.kind,
				signed: field.signed,
				minimum: field.minimum,
				maximum: field.maximum,
				minimumInclusive: field.minimum_inclusive,
				maximumInclusive: field.maximum_inclusive,
			};

			assert.equal(validateNumericConfigValue(validMinimum(field), editorContract), "", `${name} minimum`);
			assert.equal(validateNumericConfigValue(field.maximum, editorContract), "", `${name} maximum`);
			assert.notEqual(
				validateNumericConfigValue(invalidBelowMinimum(field), editorContract),
				"",
				`${name} below minimum`,
			);
			assert.notEqual(
				validateNumericConfigValue(invalidAboveMaximum(field), editorContract),
				"",
				`${name} above maximum`,
			);
			assert.notEqual(validateNumericConfigValue("not-a-number", editorContract), "", `${name} malformed`);
			testedFields += 1;
		}
	}

	assert.equal(testedFields, 21, "the numeric matrix must cover every currently declared root config field");
});

test("custom numeric fields preserve precision, support variables, and replace native number inputs", async () => {
	const { getNumericDraftError, stepNumericDraft } = await loadNumericFieldModel();
	const integerContract = {
		kind: "integer",
		signed: false,
		minimum: "0",
		maximum: "18446744073709551615",
		minimumInclusive: true,
		maximumInclusive: true,
	};
	const decimalContract = {
		kind: "float",
		signed: true,
		minimum: "-100",
		maximum: "100",
		minimumInclusive: true,
		maximumInclusive: true,
	};
	const exclusiveDecimalContract = {
		kind: "float",
		signed: false,
		minimum: "0",
		maximum: "10",
		minimumInclusive: false,
		maximumInclusive: false,
	};

	assert.equal(stepNumericDraft("9007199254740992", integerContract, 1), "9007199254740993");
	assert.equal(stepNumericDraft("18446744073709551615", integerContract, 1), null);
	assert.equal(stepNumericDraft("0.2", decimalContract, 1, "0.1"), "0.3");
	assert.equal(stepNumericDraft("", exclusiveDecimalContract, 1, "0.5"), "0.5");
	assert.equal(stepNumericDraft("0.25", exclusiveDecimalContract, -1, "0.5"), null);
	assert.equal(stepNumericDraft("9.75", exclusiveDecimalContract, 1, "0.5"), null);
	assert.equal(getNumericDraftError("{{ runtime_count }}", integerContract, true, true), "");
	assert.match(getNumericDraftError("-1", integerContract, false, true), /non-negative/);

	const numericFieldSource = read(join(appRoot, "components", "common", "numeric-field.tsx"));
	assert.match(numericFieldSource, /VariableCodeInput/);
	assert.match(numericFieldSource, /variableTypes=\{contract\.kind === "integer" \? "integer" : "float"\}/);
	assert.match(numericFieldSource, /variables=\{variables\}/);
	assert.match(numericFieldSource, /Minus/);
	assert.match(numericFieldSource, /Plus/);

	const sourceFiles = ["app", "components", "data", "hooks", "lib", "utils"].flatMap((directory) =>
		readSourceFiles(join(appRoot, directory)),
	);
	for (const filePath of sourceFiles) {
		const source = read(filePath);
		assert.doesNotMatch(source, /type\s*=\s*["']number["']/, `${filePath} must use NumericField`);
		assert.doesNotMatch(source, /type\s*=\s*\{[^\n}]*["']number["']/, `${filePath} must use NumericField`);
		assert.doesNotMatch(source, /\bvalueAsNumber\b/, `${filePath} must not use native numeric coercion`);
	}
});

test("generated runner capability contract covers every editor node", () => {
	const contract = JSON.parse(read(runnerCapabilityContractPath));
	const definitionsSource = readDefinitions();
	const actionTypes = extractDefinitionActionTypes(definitionsSource).sort();

	assert.equal(contract.version, 1);
	assert.deepEqual(Object.keys(contract.nodes).sort(), actionTypes);
	for (const [actionType, capabilities] of Object.entries(contract.nodes)) {
		assert.ok(capabilities.length > 0, `${actionType} must require at least one capability`);
		assert.equal(new Set(capabilities).size, capabilities.length, `${actionType} capabilities must be unique`);
	}
});

test("generated runner permission contract covers every editor node", () => {
	const contract = JSON.parse(read(runnerPermissionContractPath));
	const actionTypes = extractDefinitionActionTypes(readDefinitions()).sort();

	assert.equal(contract.version, 1);
	assert.deepEqual(Object.keys(contract.nodes).sort(), actionTypes);
	assert.deepEqual(contract.nodes["action.file.read"].path_rules, [{ access: "read", config_key: "path" }]);
	assert.deepEqual(contract.nodes["action.file.copy"].path_rules, [
		{ access: "read", config_key: "sourcePath" },
		{ access: "write", config_key: "destinationPath" },
	]);
	assert.deepEqual(contract.nodes["trigger.file_watch"], {
		permission: { name: "file.watch.limited", risk: "medium" },
		path_rules: [{ access: "watch", config_key: "path" }],
	});
	assert.deepEqual(contract.nodes["trigger.process_started"], {
		permission: { name: "process.observe", risk: "medium" },
		path_rules: [],
	});
	assert.equal(contract.nodes["trigger.manual"].permission, null);
});

test("generated runner port contract covers every editor node", () => {
	const contract = JSON.parse(read(runnerPortContractPath));
	const actionTypes = extractDefinitionActionTypes(readDefinitions()).sort();

	assert.equal(contract.version, 1);
	assert.deepEqual(Object.keys(contract.nodes).sort(), actionTypes);
	assert.deepEqual(contract.nodes["trigger.manual"], { kind: "fixed", inputs: [], outputs: ["out"] });
	assert.deepEqual(contract.nodes["action.log"], { kind: "fixed", inputs: ["input"], outputs: ["out"] });
	assert.deepEqual(contract.nodes["action.http"], {
		kind: "fixed",
		inputs: ["input"],
		outputs: ["success", "failed"],
	});
	assert.deepEqual(contract.nodes["control.switch"], {
		kind: "switch_cases",
		config_key: "cases",
		default_output: "default",
		input: "input",
		output_prefix: "case-",
	});
});

test("program schema uses public per-node schema references", () => {
	const programSchema = JSON.parse(read(join(schemasRoot, "program.schema.json")));
	const refs = [
		...programSchema.$defs.trigger.oneOf,
		...programSchema.$defs.controlStep.oneOf,
		...programSchema.$defs.variableOperationStep.oneOf,
		...programSchema.$defs.actionStep.oneOf,
	].map((entry) => entry.$ref);

	assert.ok(refs.length > 0, "program schema must reference generated node schemas");
	for (const ref of refs) {
		assert.match(ref, /^https:\/\/schemas\.baudbound\.app\/nodes\/.+\.schema\.json$/);
		const fileName = ref.split("/").at(-1);
		assert.ok(
			readJsonFiles(join(schemasRoot, "nodes")).some((filePath) => filePath.endsWith(fileName)),
			`${ref} file is missing`,
		);
	}
});

test("node schema files include every editor action type", () => {
	const typesSource = read(join(appRoot, "lib", "types.ts"));
	const actionTypeBlock = typesSource.match(/export type ActionType =([\s\S]*?);/)?.[1] ?? "";
	const actionTypes = [...actionTypeBlock.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
	const schemaFiles = new Set(
		readJsonFiles(join(schemasRoot, "nodes")).map((filePath) => filePath.split(/[\\/]/).at(-1)),
	);

	for (const actionType of actionTypes) {
		const fileName = `${actionType.replaceAll(".", "-").replaceAll("_", "-")}.schema.json`;
		assert.ok(schemaFiles.has(fileName), `${fileName} is missing for ${actionType}`);
	}
});

test("node schemas restrict each node config object", () => {
	for (const filePath of readJsonFiles(join(schemasRoot, "nodes"))) {
		const schema = JSON.parse(read(filePath));
		const config = schema.$defs?.config;
		assert.equal(config?.type, "object", `${filePath} config must be an object schema`);
		assert.equal(config?.additionalProperties, false, `${filePath} config must reject unknown fields`);
		assert.ok(config.properties?.customName, `${filePath} should allow customName`);
	}
});

test("select config fields produce enum values in generated node schemas", () => {
	const httpSchema = JSON.parse(read(join(schemasRoot, "nodes", "action-http.schema.json")));
	const variableSchema = JSON.parse(read(join(schemasRoot, "nodes", "runtime-set-variable.schema.json")));

	assert.deepEqual(httpSchema.$defs.config.properties.method.enum, [
		"GET",
		"POST",
		"PUT",
		"PATCH",
		"DELETE",
		"HEAD",
		"OPTIONS",
	]);
	assert.deepEqual(httpSchema.$defs.config.properties.bodyFormat.enum, ["json", "text"]);
	assert.deepEqual(variableSchema.$defs.config.properties.operation.enum, [
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
	]);
	assert.equal(variableSchema.$defs.config.required.includes("valueType"), false);
	assert.ok(
		variableSchema.$defs.config.allOf.some(
			(rule) => rule.if?.properties?.operation?.const === "set" && rule.then?.required?.includes("valueType"),
		),
		"Only Set requires a configured valueType",
	);
});

test("schemas are served with public canonical ids", () => {
	for (const filePath of readJsonFiles(schemasRoot)) {
		const schema = JSON.parse(read(filePath));
		if (!schema.$id) {
			continue;
		}

		assert.match(schema.$id, /^https:\/\/schemas\.baudbound\.app\//, `${filePath} has non-public $id`);
	}
});

test("editor schema and package contract support editor-only metadata", () => {
	const editorSchema = JSON.parse(read(join(schemasRoot, "editor.schema.json")));
	const programSchema = JSON.parse(read(join(schemasRoot, "program.schema.json")));
	const packageContractSource = read(join(appRoot, "utils", "package-contract.ts"));
	const packageSource = read(join(appRoot, "utils", "bbs-package.ts"));
	const flowCanvasSource = read(join(appRoot, "data", "editor", "flow-canvas.ts"));

	assert.ok(editorSchema.properties.comments, "editor.schema.json should define editor-only comments");
	assert.deepEqual(editorSchema.properties.canvas.properties.edge_style.enum, [
		"smoothstep",
		"bezier",
		"straight",
		"step",
	]);
	assert.deepEqual(editorSchema.properties.comments.items.properties.color.enum, [
		"amber",
		"blue",
		"green",
		"rose",
		"violet",
	]);
	assert.deepEqual(editorSchema.properties.comments.items.properties.font_size, {
		type: "number",
		minimum: 12,
		maximum: 72,
	});
	assert.match(packageContractSource, /editor\.json comments/);
	assert.match(packageContractSource, /canvas\.edge_style/);
	assert.match(packageContractSource, /font_size from 12 to 72/);
	assert.match(packageSource, /edge_style/);
	assert.match(packageSource, /font_size/);
	assert.match(packageSource, /comments: comments\.map/);
	assert.match(packageSource, /function toEditorComments/);
	const edgeStyleBlock = flowCanvasSource.match(/edgeStyleOptions = \[([\s\S]*?)\] as const/);
	assert.ok(edgeStyleBlock, "flow-canvas.ts should define edge style options");
	assert.deepEqual(
		[...edgeStyleBlock[1].matchAll(/label: "([^"]+)", value: "([^"]+)"/g)].map((match) => [match[1], match[2]]),
		[
			["Bezier", "bezier"],
			["Smooth step", "smoothstep"],
			["Step", "step"],
			["Straight", "straight"],
		],
	);
	assert.match(flowCanvasSource, /defaultEditorEdgeStyle: EditorEdgeStyle = "bezier"/);
	assert.equal(
		programSchema.$defs.actionType.enum.includes("commentNode"),
		false,
		"comments must not be program nodes",
	);
	assert.ok(programSchema.$defs.edge.required.includes("execution_order"));
	assert.deepEqual(programSchema.$defs.edge.properties.execution_order, {
		type: "integer",
		minimum: 0,
		maximum: 4294967295,
	});
});

test("editor edge style metadata is mapped to valid React Flow edge types", () => {
	const flowCanvasDataSource = read(join(appRoot, "data", "editor", "flow-canvas.ts"));
	const flowCanvasSource = read(join(appRoot, "components", "canvas", "flow-canvas.tsx"));
	const editorPageSource = read(join(appRoot, "app", "editor-page.tsx"));

	assert.match(flowCanvasDataSource, /edgeStyle === "bezier" \? "default" : edgeStyle/);
	assert.match(flowCanvasDataSource, /editorEdgeZIndex = 10/);
	assert.match(flowCanvasDataSource, /zIndex: editorEdgeZIndex/);
	assert.match(flowCanvasSource, /type: toReactFlowEdgeType\(edgeStyle\)/);
	assert.match(flowCanvasSource, /withEdgeExecutionOrder/);
	assert.match(flowCanvasSource, /getNextEdgeExecutionOrder/);
	assert.match(flowCanvasSource, /addEdge\(edge, current\)/);
	assert.match(editorPageSource, /type: toReactFlowEdgeType\(nextEdgeStyle\)/);
	assert.match(editorPageSource, /type: toReactFlowEdgeType\(initialProject\.edgeStyle\)/);
	assert.match(editorPageSource, /type: toReactFlowEdgeType\(project\.edgeStyle\)/);
});

test("program schema includes every editor action type", () => {
	const typesSource = read(join(appRoot, "lib", "types.ts"));
	const actionTypeBlock = typesSource.match(/export type ActionType =([\s\S]*?);/)?.[1] ?? "";
	const actionTypes = [...actionTypeBlock.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
	const programSchema = JSON.parse(read(join(schemasRoot, "program.schema.json")));
	const schemaActionTypes = new Set(programSchema.$defs.actionType.enum);

	assert.ok(actionTypes.length > 0, "ActionType union should not be empty");
	for (const actionType of actionTypes) {
		assert.ok(schemaActionTypes.has(actionType), `${actionType} is missing from program.schema.json`);
	}
});

test("shared schemas exactly match every editor variable, setting, list-item, and runtime-output type", () => {
	const typesSource = read(join(appRoot, "lib", "types.ts"));
	const variablesSource = read(join(appRoot, "data", "project", "variables.ts"));
	const runtimeDataTypeBlock = typesSource.match(/export type RuntimeDataType =([\s\S]*?);/)?.[1] ?? "";
	const runtimeDataTypes = [...runtimeDataTypeBlock.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
	const editorVariableTypes = extractConstStringArray(variablesSource, "variableTypes");
	// listItemTypes is derived from variableTypes rather than written out, so
	// the two lists cannot drift. A list element may be any type except a list.
	const editorListItemTypes = editorVariableTypes.filter((type) => type !== "list");
	const editorSettingTypes = extractConstStringArray(typesSource, "scriptSettingTypes");
	const programSchema = JSON.parse(read(join(schemasRoot, "program.schema.json")));
	const manifestSchema = JSON.parse(read(join(schemasRoot, "manifest.schema.json")));
	const expectedProgramVariableTypes = [...new Set([...editorVariableTypes, ...runtimeDataTypes])];

	assert.ok(runtimeDataTypes.length > 0, "RuntimeDataType union should not be empty");
	assert.deepEqual(programSchema.$defs.runtimeDataType.enum, runtimeDataTypes);
	assert.deepEqual([...programSchema.$defs.variableType.enum].sort(), expectedProgramVariableTypes.sort());
	assert.deepEqual(manifestSchema.properties.variables.items.properties.type.enum, editorVariableTypes);
	assert.deepEqual(manifestSchema.properties.variables.items.properties.item_type.enum, editorListItemTypes);
	assert.deepEqual(manifestSchema.properties.settings.items.properties.type.enum, editorSettingTypes);
	assert.deepEqual(manifestSchema.properties.settings.items.properties.item_type.enum, editorListItemTypes);
	assert.equal(programSchema.$defs.variableType.enum.includes("http_response"), false);
});

test("shared manifest schema strictly validates custom variable and setting values", async () => {
	const [{ default: Ajv2020 }, { default: addFormats }] = await Promise.all([
		import("ajv/dist/2020.js"),
		import("ajv-formats"),
	]);
	const manifestSchema = JSON.parse(read(join(schemasRoot, "manifest.schema.json")));
	const ajv = new Ajv2020({ allErrors: true, strict: false });
	addFormats(ajv);
	const validate = ajv.compile(manifestSchema);
	const manifest = {
		format_version: 1,
		script_language_version: 1,
		id: "6db0f09c-2d76-4ea3-bb6b-9a093a04d8f7",
		name: "custom-types",
		version: "1.0.0",
		created_with: "BaudBound Test",
		created_at: "2026-08-03T12:00:00Z",
		minimum_runner_version: "2.0.0",
		variables: [
			{
				name: "started_at",
				scope: "runtime",
				type: "datetime",
				value: { type: "datetime", value: "2026-08-03T12:00:00Z" },
			},
			{
				name: "timeout",
				scope: "runtime",
				type: "duration",
				value: { type: "duration", unit: "seconds", value: 3 },
			},
			{ name: "output", scope: "runtime", type: "string", value: "./output.txt" },
		],
		settings: [
			{ name: "Shortcut", type: "hotkey", required: false, default_value: "Ctrl+Shift+F8" },
			{ name: "Accent", type: "color", required: false, default_value: "#123ABC" },
		],
	};

	assert.equal(validate(manifest), true, JSON.stringify(validate.errors));
	for (const mutate of [
		(candidate) => {
			candidate.variables[0].value.value = "2026-02-30T12:00:00Z";
		},
		(candidate) => {
			candidate.variables[1].value.unit = "weeks";
		},
		(candidate) => {
			candidate.variables[1].value.value = -1;
		},
		(candidate) => {
			candidate.variables[0].value.unexpected = true;
		},
	]) {
		const invalid = structuredClone(manifest);
		mutate(invalid);
		assert.equal(validate(invalid), false, "invalid custom typed value should fail the shared schema");
	}
});

test("serial input stores only logical device ids in script packages", () => {
	const serialInputSource = read(join(appRoot, "data", "nodes", "definitions", "triggers", "serial-input.ts"));
	const serialProjectSource = read(join(appRoot, "data", "project", "serial.ts"));
	const serialSchema = JSON.parse(read(join(schemasRoot, "nodes", "trigger-serial-input.schema.json")));
	const configKeys = new Set(Object.keys(serialSchema.$defs.config.properties));

	assert.deepEqual([...configKeys].sort(), ["customName", "deviceId", "overlap"].sort());
	assert.match(serialInputSource, /key:\s*"deviceId"/);
	assert.doesNotMatch(serialInputSource, /key:\s*"port"/);
	assert.doesNotMatch(serialInputSource, /validateUsbIdentity/);
	assert.doesNotMatch(serialProjectSource, /baudRate|vendorId|productId|\bport\b/);
});

test("user-controlled identifiers share one portable schema contract", () => {
	const expectedPattern = "^[A-Za-z0-9_-]+$";
	const manifestSchema = JSON.parse(read(join(schemasRoot, "manifest.schema.json")));
	const nodeSchemas = [
		["runtime-set-variable.schema.json", "name"],
		["trigger-serial-input.schema.json", "deviceId"],
		["trigger-webhook.schema.json", "hookName"],
	];

	assert.equal(manifestSchema.properties.variables.items.properties.name.pattern, expectedPattern);
	assert.equal(manifestSchema.properties.settings.items.properties.name.pattern, expectedPattern);
	assert.equal(manifestSchema.properties.secrets.items.properties.name.pattern, expectedPattern);
	for (const [schemaName, fieldName] of nodeSchemas) {
		const schema = JSON.parse(read(join(schemasRoot, "nodes", schemaName)));
		assert.equal(schema.$defs.config.properties[fieldName].pattern, expectedPattern);
	}
});

test("Read File has an implicit UTF-8 contract without redundant encoding config", () => {
	const readFileSource = read(join(appRoot, "data", "nodes", "definitions", "actions", "file-read.ts"));
	const readFileSchema = JSON.parse(read(join(schemasRoot, "nodes", "action-file-read.schema.json")));
	const configSchema = readFileSchema.$defs.config;

	assert.deepEqual(configSchema.required, ["path"]);
	assert.deepEqual(Object.keys(configSchema.properties).sort(), ["customName", "path"]);
	assert.doesNotMatch(readFileSource, /key:\s*"encoding"|configString\(node,\s*"encoding"\)/);
	assert.match(readFileSource, /as UTF-8/);
});

test("Switch validates required values, row structure, and duplicate names and values", () => {
	const switchSource = read(join(appRoot, "data", "nodes", "definitions", "control", "switch.ts"));
	const validationSource = read(join(appRoot, "data", "nodes", "switch-validation.ts"));

	assert.match(switchSource, /validateConfig:\s*validateSwitchConfig/);
	assert.match(validationSource, /must define a switch value/);
	assert.match(validationSource, /must define at least one switch case/);
	assert.match(validationSource, /Name must be unique/);
	assert.match(validationSource, /Value must be unique/);
	assert.match(validationSource, /duplicate switch case identifiers/);
});

test("file watch supports pre-trigger variables and explicit recursive configuration", () => {
	const fileWatchSource = read(join(appRoot, "data", "nodes", "definitions", "triggers", "file-watch.ts"));
	const fileWatchSchema = JSON.parse(read(join(schemasRoot, "nodes", "trigger-file-watch.schema.json")));
	const configSchema = fileWatchSchema.$defs.config;

	assert.deepEqual(configSchema.required, ["path"]);
	assert.deepEqual(configSchema.properties.path, { type: "string" });
	assert.deepEqual(configSchema.properties.recursive, { type: "boolean" });
	assert.match(fileWatchSource, /requiredConfig\(config, "path", "file watch path"\)/);
	const pathField = extractConfigField(fileWatchSource, "path");
	assert.match(pathField, /usesVariables:\s*true/);
	assert.match(pathField, /variableTypes:\s*"string"/);
});

test("variable-capable trigger and keyboard fields are explicit while listener identity fields stay literal", () => {
	const fileWatch = read(join(appRoot, "data", "nodes", "definitions", "triggers", "file-watch.ts"));
	const processStarted = read(join(appRoot, "data", "nodes", "definitions", "triggers", "process-started.ts"));
	const hotkey = read(join(appRoot, "data", "nodes", "definitions", "triggers", "hotkey.ts"));
	const keyboard = read(join(appRoot, "data", "nodes", "definitions", "actions", "keyboard.ts"));
	const serial = read(join(appRoot, "data", "nodes", "definitions", "triggers", "serial-input.ts"));
	const webhook = read(join(appRoot, "data", "nodes", "definitions", "triggers", "webhook.ts"));
	const websocket = read(join(appRoot, "data", "nodes", "definitions", "triggers", "websocket.ts"));

	assert.match(extractConfigField(fileWatch, "path"), /usesVariables:\s*true[\s\S]*variableTypes:\s*"string"/);
	assert.match(extractConfigField(processStarted, "target"), /usesVariables:\s*true[\s\S]*variableTypes:\s*"string"/);
	assert.match(extractConfigField(hotkey, "key"), /usesVariables:\s*true[\s\S]*variableTypes:\s*"hotkey"/);
	assert.match(extractConfigField(keyboard, "key"), /usesVariables:\s*true[\s\S]*variableTypes:\s*"hotkey"/);
	assert.doesNotMatch(extractConfigField(serial, "deviceId"), /usesVariables/);
	assert.doesNotMatch(extractConfigField(webhook, "hookName"), /usesVariables/);
	assert.doesNotMatch(extractConfigField(websocket, "path"), /usesVariables/);
});

test("variable-capable editor inputs declare and enforce type contracts", () => {
	const definitions = readDefinitions();
	const variableInputSource = read(join(appRoot, "components", "common", "variable-code-input.tsx"));
	const validationSource = read(join(appRoot, "data", "nodes", "config-field-validation.ts"));
	const registrySource = read(join(appRoot, "data", "nodes", "registry.ts"));
	const verificationSource = read(join(appRoot, "utils", "verification.ts"));

	for (const declaration of definitions.matchAll(/usesVariables:\s*true/g)) {
		assert.match(
			definitions.slice(declaration.index, declaration.index + 160),
			/variableTypes:\s*"[a-z_]+"/,
			"every variable-capable node field must declare its accepted variable contract",
		);
	}
	assert.match(variableInputSource, /variableTypes:\s*VariableInputContract;/);
	assert.match(variableInputSource, /filterCompatibleVariables\(variables, variableTypes\)/);
	assert.match(variableInputSource, /data-variable-status=\{displayStatus\}/);
	assert.match(variableInputSource, /displayStatus === "type-mismatch" && "bg-cyan-400\/20 text-cyan-300"/);
	// Matching is exact now that every deleted type has been folded into the
	// shape it always was. There is no longer a compatibleTypes lookup table.
	assert.doesNotMatch(validationSource, /compatibleTypes/);
	assert.match(validationSource, /contract === "any" \|\| type === contract/);
	assert.match(
		validationSource,
		/contract !== "any" && getVariableReferenceStatus\(reference, variables\) === "possible"/,
	);
	assert.match(registrySource, /validateConfigField\(field, config, variables\)/);
	assert.match(registrySource, /definition\?\.validateVariables\?\.\(sanitizedConfig, variables\)/);
	assert.match(
		verificationSource,
		/validateNodeConfig\(node\.data\.actionType, node\.data\.config, availableVariables\)/,
	);
});

test("delay and schedule intervals use the shared millisecond duration contract", () => {
	const delaySource = read(join(appRoot, "data", "nodes", "definitions", "actions", "delay.ts"));
	const scheduleSource = read(join(appRoot, "data", "nodes", "definitions", "triggers", "schedule.ts"));
	const scheduleSimulationSource = read(join(appRoot, "components", "simulation", "schedule-trigger-status.tsx"));
	const validatorsSource = read(join(appRoot, "data", "nodes", "definitions", "validators.ts"));

	assert.match(delaySource, /staticPositiveDurationConfig\(config, "amount", "unit", "delay duration", true\)/);
	assert.match(scheduleSource, /usesVariables: true/);
	assert.match(scheduleSource, /staticPositiveDurationConfig\(config, "every", "unit", "schedule interval", true\)/);
	assert.match(scheduleSimulationSource, /unit === "milliseconds"/);
	assert.match(scheduleSimulationSource, /Math\.max\(1, Math\.round\(intervalMs\)\)/);
	assert.match(scheduleSimulationSource, /Start Schedule/);
	assert.match(scheduleSimulationSource, /Stop Schedule/);
	assert.match(validatorsSource, /milliseconds: 0\.001/);
	assert.match(validatorsSource, /seconds < 0\.001/);
	assert.match(validatorsSource, /cannot use runtime variable references/);
});

test("schedule simulation preserves its original cadence after delayed callbacks", async () => {
	const { advanceScheduleDeadline } = await loadScheduleCadence();

	assert.deepEqual(advanceScheduleDeadline(3_000, 3_125, 3_000), {
		missedIntervals: 0,
		nextDeadlineMs: 6_000,
	});
	assert.deepEqual(advanceScheduleDeadline(3_000, 10_000, 3_000), {
		missedIntervals: 2,
		nextDeadlineMs: 12_000,
	});
	assert.deepEqual(advanceScheduleDeadline(12_000, 12_000, 3_000), {
		missedIntervals: 0,
		nextDeadlineMs: 15_000,
	});
});

test("runner types used by node definitions are declared by the program schema", () => {
	const programSchema = JSON.parse(read(join(schemasRoot, "program.schema.json")));
	const allowedRunnerTypes = new Set([
		...programSchema.$defs.triggerType.enum,
		...programSchema.$defs.actionRunnerType.enum,
		...programSchema.$defs.controlStepType.enum,
		"set_variable",
	]);
	const definitionsSource = readDefinitions();
	const runnerTypes = [...definitionsSource.matchAll(/runnerType:\s*"([^"]+)"/g)].map((match) => match[1]);

	assert.ok(runnerTypes.length > 0, "node definitions should declare runner types");
	for (const runnerType of runnerTypes) {
		assert.ok(allowedRunnerTypes.has(runnerType), `${runnerType} is missing from program.schema.json`);
	}
});

test("old capability and permission strings are not used by node definitions", () => {
	const definitionsSource = readDefinitions();
	const staleStrings = [
		"trigger.serial",
		"trigger.process",
		"runtime.foreach",
		"runtime.calculate",
		"runtime.format_text",
		"action.audio",
		"action.screen",
		"action.script",
		"file_delete",
		"file_download",
		"active_window_read",
		"play_audio",
		"run_subscript",
	];

	for (const staleString of staleStrings) {
		assert.equal(
			new RegExp(`"${escapeRegExp(staleString)}"`).test(definitionsSource),
			false,
			`${staleString} should not be used`,
		);
	}
});

test("simulator does not retain streamed step history or use recursive traversal helpers", () => {
	const simulationSource = read(join(appRoot, "utils", "simulation.ts"));
	const editorSource = read(join(appRoot, "app", "editor-page.tsx"));

	assert.equal(/context\.steps|steps:\s*\[\]|steps:\s*context\./.test(simulationSource), false);
	assert.match(simulationSource, /type SimulationFrame/);
	assert.match(simulationSource, /processSimulationFrames/);
	assert.match(
		simulationSource,
		/const results = \(await context\.onStep\(step\)\) \?\? \[\];\s*await yieldSimulationTask/,
	);
	assert.match(simulationSource, /await pushNodeState\(context, node\.id, "active"\)/);
	assert.match(
		simulationSource,
		/finally\s*\{\s*if \(!context\.signal\?\.aborted\)\s*\{\s*await pushNodeState\(context, node\.id, "completed"\)/,
	);
	assert.match(editorSource, /flushSync\(\(\) => \{/);
	assert.match(editorSource, /nodeState\?\.status === "active"/);
	assert.match(editorSource, /nodeState\?\.status === "completed"/);
	assert.doesNotMatch(editorSource, /nextNodeIds\.add\(traversedEdge\.target\)/);
	assert.doesNotMatch(simulationSource, /SIMULATION_YIELD_INTERVAL|streamedSteps/);
	assert.ok(
		editorSource.indexOf("setSimulationVariables(step.variables)") <
			editorSource.indexOf("executeSimulationSideEffects(step.sideEffects"),
		"simulation state must be published before browser side effects execute",
	);
	assert.equal(/async function followHandle|async function executeNode\(/.test(simulationSource), false);
	assert.equal(/switch\s*\(\s*node\.data\.actionType\s*\)/.test(simulationSource), false);
});

test("simulation pacing exposes real time plus explicit per-step slowdowns", () => {
	const optionsSource = read(join(appRoot, "components", "simulation", "simulator-options.ts"));
	const settingsSource = read(join(appRoot, "utils", "simulation-settings.ts"));
	const typesSource = read(join(appRoot, "lib", "types.ts"));

	assert.match(typesSource, /"realtime"\s*\|\s*"slowdown-100"\s*\|\s*"slowdown-300"\s*\|\s*"slowdown-700"/);
	assert.match(optionsSource, /\{ label: "Real time", value: "realtime" \}/);
	for (const delay of [100, 300, 700]) {
		assert.match(optionsSource, new RegExp(`Slowdown: ${delay} ms`));
	}
	assert.match(settingsSource, /\^slowdown-\(100\|300\|700\)\$/);
	assert.doesNotMatch(optionsSource, /Instant|Normal|Fast/);
});

test("simulation audio side effects clean up object URLs deterministically", () => {
	const sideEffectsSource = read(join(appRoot, "utils", "simulation-side-effects.ts"));

	assert.match(sideEffectsSource, /URL\.createObjectURL\(asset\.file\)/);
	assert.match(sideEffectsSource, /URL\.revokeObjectURL\(audioUrl\)/);
	assert.match(sideEffectsSource, /audio\.addEventListener\("ended", handleEnded/);
	assert.match(sideEffectsSource, /finally\s*\{\s*cleanup\(\);/);
	assert.equal(sideEffectsSource.includes("10 * 60 * 1000"), false);
});

test("node definitions include production metadata required by package analysis", () => {
	const definitionsSource = readDefinitions();
	const actionTypes = [...definitionsSource.matchAll(/actionType:\s*"([^"]+)"/g)].map((match) => match[1]);

	assert.ok(actionTypes.length > 0, "node definitions should declare action types");
	for (const actionType of actionTypes) {
		const definitionBlock = getDefinitionBlock(definitionsSource, actionType);
		assert.match(definitionBlock, /capabilities:\s*/, `${actionType} must declare capabilities`);
		assert.match(definitionBlock, /description:\s*"[^"]+"/, `${actionType} must declare a description`);
		assert.match(definitionBlock, /group:\s*"(triggers|control|actions)"/, `${actionType} must declare a group`);
		assert.match(definitionBlock, /kind:\s*"(trigger|control|action)"/, `${actionType} must declare a kind`);
		assert.match(definitionBlock, /label:\s*"[^"]+"/, `${actionType} must declare a label`);
		assert.match(definitionBlock, /risk:\s*"(low|medium|high|dangerous)"/, `${actionType} must declare risk`);

		if (
			actionType.startsWith("trigger.") ||
			actionType.startsWith("action.") ||
			actionType === "runtime.set_variable"
		) {
			assert.match(definitionBlock, /runnerType:\s*"[^"]+"/, `${actionType} must declare a runner type`);
		}

		if (actionType.startsWith("action.") || actionType === "runtime.set_variable") {
			assert.match(definitionBlock, /permission:\s*\{/, `${actionType} must declare permission metadata`);
		}
	}
});

test("native Windows-only desktop nodes declare target runtime compatibility", () => {
	const definitionsSource = readDefinitions();

	for (const actionType of [
		"action.keyboard",
		"action.keyboard.type_text",
		"action.mouse",
		"action.mouse.move",
		"action.pixel.get",
		"action.window.active",
		"action.window.focus",
		"trigger.hotkey",
	]) {
		const definitionBlock = getDefinitionBlock(definitionsSource, actionType);
		assert.match(
			definitionBlock,
			/supportedTargetRuntimes:\s*\[\s*"Windows Desktop"\s*\]/,
			`${actionType} must be restricted to Windows Desktop until native backends exist for other desktop targets`,
		);
	}
});

test("window-title process matching has config-sensitive Windows Desktop validation", () => {
	const definitionsSource = readDefinitions();

	for (const actionType of ["action.process.status", "action.process.kill", "trigger.process_started"]) {
		const definitionBlock = getDefinitionBlock(definitionsSource, actionType);
		assert.match(
			definitionBlock,
			/validateTargetRuntime:/,
			`${actionType} must validate its match mode for the target`,
		);
		assert.match(
			definitionBlock,
			/windowsDesktopOnlyConfigValue/,
			`${actionType} must restrict window-title matching to Windows Desktop`,
		);
	}
});

test("target runtime contracts expose only Windows and Linux", () => {
	const capabilitiesSchema = JSON.parse(read(join(schemasRoot, "capabilities.schema.json")));

	assert.deepEqual(capabilitiesSchema.properties.target_runtimes.items.enum, [
		"Linux Headless",
		"Windows Headless",
		"Windows Desktop",
		"Linux Desktop",
	]);
});

test("message box schemas expose every configured dialog option", () => {
	const messageBoxSchema = JSON.parse(read(join(schemasRoot, "nodes", "action-message-box.schema.json")));
	const simulationSource = read(join(appRoot, "components", "modals", "simulation-message-box-dialog.tsx"));
	const definitionSource = read(join(appRoot, "data", "nodes", "definitions", "actions", "message-box.ts"));
	const optionsSource = read(join(appRoot, "data", "nodes", "definitions", "options.ts"));
	const config = messageBoxSchema.$defs.config;
	const buttons = config.properties.buttons.enum;
	const types = config.properties.type.enum;

	assert.deepEqual([...buttons].sort(), ["cancel_confirm", "ok", "ok_cancel", "yes_no", "yes_no_cancel"].sort());
	assert.deepEqual([...types].sort(), ["error", "info", "warning"].sort());
	assert.ok(config.required.includes("dialogSize"));
	assert.deepEqual(config.properties.dialogSize.enum, ["small", "medium", "large"]);
	assert.deepEqual(config.properties.timeoutSeconds.anyOf, [
		{ type: "number", exclusiveMinimum: 0, maximum: 86400 },
		{ type: "string", minLength: 1 },
	]);
	assert.match(simulationSource, /simulationDialogSizeClasses\[messageBox\.dialogSize\]/);
	assert.match(simulationSource, /SimulationDialogTimeoutCountdown/);
	assert.match(simulationSource, /size-8/);
	assert.match(optionsSource, /label: "Cancel \/ Confirm", value: "cancel_confirm"/);
	assert.match(definitionSource, /case "ok_cancel":\s*return \["cancel", "ok"\]/);
	assert.match(definitionSource, /case "cancel_confirm":\s*return \["cancel", "confirm"\]/);
	assert.match(definitionSource, /case "yes_no":\s*return \["no", "yes"\]/);
	assert.match(definitionSource, /case "yes_no_cancel":\s*return \["cancel", "no", "yes"\]/);
	assert.match(definitionSource, /resolveDesktopDialogTimeout/);
});

test("form dialog schema exposes every strict component contract", () => {
	const formDialogSchema = JSON.parse(read(join(schemasRoot, "nodes", "action-form-dialog.schema.json")));
	const config = formDialogSchema.$defs.config;
	const fields = config.properties.fields.items.oneOf;
	const informationField = config.properties.fields.items.oneOf.find(
		(field) => field.properties.type.const === "information",
	);
	const imageField = fields.find((field) => field.properties.type.const === "image");
	const singleChoiceField = fields.find((field) => field.properties.type.const === "single_choice");
	const sliderField = fields.find((field) => field.properties.type.const === "slider");
	const textField = fields.find((field) => field.properties.type.const === "text");

	assert.ok(config.required.includes("dialogSize"));
	assert.deepEqual(config.properties.dialogSize.enum, ["small", "medium", "large"]);
	assert.equal(config.properties.fields.minItems, 1);
	assert.deepEqual(fields.map((field) => field.properties.type.const).sort(), [
		"checkbox",
		"color",
		"date",
		"datetime",
		"divider",
		"dropdown",
		"file",
		"folder",
		"image",
		"information",
		"multi_choice",
		"multiline",
		"number",
		"password",
		"section_heading",
		"single_choice",
		"slider",
		"text",
		"time",
	]);
	assert.ok(informationField.required.includes("accentColor"));
	assert.deepEqual(informationField.properties.accentColor, { type: "string", minLength: 1, maxLength: 512 });
	assert.ok(imageField.required.includes("assetPath"));
	assert.deepEqual(imageField.properties.imageFit.enum, ["contain", "cover"]);
	assert.equal(textField.properties.key.pattern, "^[A-Za-z0-9_-]+$");
	assert.equal(singleChoiceField.properties.choices.items.properties.key.pattern, "^[A-Za-z0-9_-]+$");
	assert.ok(sliderField.required.includes("minimum"));
	assert.ok(sliderField.required.includes("maximum"));
	assert.ok(sliderField.required.includes("step"));
});

test("form dialogs require components and keep stable form actions", () => {
	const builderSource = read(join(appRoot, "components", "inspector", "form-dialog-builder.tsx"));
	const simulationSource = read(join(appRoot, "components", "modals", "simulation-form-dialog.tsx"));

	assert.match(builderSource, /return "At least one component is required"/);
	assert.match(simulationSource, />\s*Submit\s*</);
	assert.doesNotMatch(simulationSource, /fields\.length\s*===\s*0/);
	assert.doesNotMatch(simulationSource, /Confirm/);
});

test("generated node schemas restrict config keys to editor-owned node config fields", () => {
	const definitionsSource = readDefinitions();
	const nodeSchemas = readJsonFiles(join(schemasRoot, "nodes")).map((filePath) => JSON.parse(read(filePath)));
	const allowedConfigKeys = new Set(nodeSchemas.flatMap((schema) => Object.keys(schema.$defs.config.properties ?? {})));
	const definitionConfigKeys = [
		...definitionsSource.matchAll(/\{\s*key:\s*"([^"]+)"\s*,\s*label:/g),
		...definitionsSource.matchAll(/defaultConfig:\s*\(\)\s*=>\s*\(\{([\s\S]*?)\}\)/g),
	]
		.flatMap((match) => (match[1].includes(":") ? [...match[1].matchAll(/^\s*([A-Za-z][A-Za-z0-9]*)\s*:/gm)] : [match]))
		.map((match) => match[1])
		.filter((key) => key && !["label", "value"].includes(key));

	assert.ok(
		nodeSchemas.every((schema) => schema.$defs.config.additionalProperties === false),
		"node config schemas must reject unknown config fields",
	);
	for (const key of new Set(["customName", ...definitionConfigKeys])) {
		assert.ok(allowedConfigKeys.has(key), `${key} is missing from generated node config schemas`);
	}
});

test("permission and capability schemas match canonical package contract", () => {
	const contractSource = read(join(appRoot, "utils", "package-contract.ts"));
	const permissionsSchema = JSON.parse(read(join(schemasRoot, "permissions.schema.json")));
	const capabilitiesSchema = JSON.parse(read(join(schemasRoot, "capabilities.schema.json")));
	const canonicalPermissions = extractConstStringArray(contractSource, "canonicalPermissions").sort();
	const canonicalCapabilities = extractConstStringArray(contractSource, "canonicalCapabilities").sort();

	assert.deepEqual(
		[...permissionsSchema.properties.declared_permissions.items.enum].sort(),
		canonicalPermissions,
		"permissions.schema.json must match canonicalPermissions",
	);
	assert.deepEqual(
		[...capabilitiesSchema.properties.required_capabilities.items.enum].sort(),
		canonicalCapabilities,
		"capabilities.schema.json must match canonicalCapabilities",
	);
});

test("node definitions use only canonical permissions and capabilities", () => {
	const definitionsSource = readDefinitions();
	const sharedSource = read(join(appRoot, "data", "nodes", "definitions", "shared.ts"));
	const contractSource = read(join(appRoot, "utils", "package-contract.ts"));
	const canonicalPermissions = new Set(extractConstStringArray(contractSource, "canonicalPermissions"));
	const canonicalCapabilities = new Set(extractConstStringArray(contractSource, "canonicalCapabilities"));
	const definitionPermissions = [
		...new Set([...definitionsSource.matchAll(/permission:\s*\{\s*name:\s*"([^"]+)"/g)].map((match) => match[1])),
	].sort();
	const definitionCapabilities = [...new Set(extractDefinitionCapabilities(definitionsSource, sharedSource))].sort();

	for (const permission of definitionPermissions) {
		assert.ok(canonicalPermissions.has(permission), `${permission} is missing from canonicalPermissions`);
	}

	for (const capability of definitionCapabilities) {
		assert.ok(canonicalCapabilities.has(capability), `${capability} is missing from canonicalCapabilities`);
	}
});

test("package contract validates graph structure and import rejects malformed edges", () => {
	const contractSource = read(join(appRoot, "utils", "package-contract.ts"));
	const packageSource = read(join(appRoot, "utils", "bbs-package.ts"));
	const registrySource = read(join(appRoot, "data", "nodes", "registry.ts"));

	assert.match(contractSource, /validateNodeConfig/);
	assert.match(contractSource, /validateProgramGraphContract/);
	assert.match(contractSource, /entry\.triggers must contain at least one trigger/);
	assert.match(contractSource, /references missing source node/);
	assert.match(contractSource, /unknown source_handle/);
	assert.match(contractSource, /cannot connect node .* to itself/);
	assert.match(contractSource, /must define a non-negative integer execution_order/);
	assert.match(contractSource, /unique consecutive execution_order values starting at 0/);
	assert.match(packageSource, /Program edge .* references an unknown source or target node/);
	assert.match(packageSource, /Program edge .* cannot connect node .* to itself/);
	assert.match(packageSource, /must define a non-negative integer execution_order/);
	assert.match(registrySource, /Invalid value for \$\{field\.key\}: expected string/);
	assert.match(registrySource, /numericContractApplies/);
	assert.match(registrySource, /validateNumericConfigValue/);
	assert.match(registrySource, /Invalid value for \$\{field\.key\}: expected boolean/);
	assert.match(contractSource, /getTargetRuntimeCompatibilityErrors/);
	assert.match(contractSource, /capabilities\.target_runtimes/);
	assert.equal(/return \[\];\s*\n\s*}\);\s*\n}/.test(packageSource), false, "import must not silently drop edges");
});

test("file permissions are derived from node config paths", async () => {
	const analysisSource = read(join(appRoot, "utils", "analysis.ts"));
	const contractSource = read(join(appRoot, "utils", "package-contract.ts"));
	const filePolicySource = read(join(appRoot, "data", "project", "file-permissions.ts"));
	const readFileSource = read(join(appRoot, "data", "nodes", "definitions", "actions", "file-read.ts"));
	const writeFileSource = read(join(appRoot, "data", "nodes", "definitions", "actions", "file-write.ts"));
	const copyFileSource = read(join(appRoot, "data", "nodes", "definitions", "actions", "file-copy.ts"));
	const watchFileSource = read(join(appRoot, "data", "nodes", "definitions", "triggers", "file-watch.ts"));

	// The declared scope rides along, because a Variable Operation no longer
	// carries one and the permission a write needs depends entirely on it.
	assert.match(analysisSource, /getNodePermissions\(\s*node\.data\.actionType,\s*node\.data\.config,/);
	assert.match(contractSource, /getNodePermissions\(actionType, config\)/);
	assert.match(filePolicySource, /file\.read\.any/);
	assert.match(filePolicySource, /file\.write\.any/);
	assert.match(filePolicySource, /pathUsesRuntimeData/);
	assert.match(filePolicySource, /containsParentTraversal/);
	assert.match(readFileSource, /permissionPathRules: \[\{ access: "read", configKey: "path" \}\]/);
	assert.match(writeFileSource, /permissionPathRules: \[\{ access: "write", configKey: "path" \}\]/);
	assert.match(copyFileSource, /\{ access: "read", configKey: "sourcePath" \}/);
	assert.match(copyFileSource, /\{ access: "write", configKey: "destinationPath" \}/);
	assert.match(watchFileSource, /permissionPathRules: \[\{ access: "watch", configKey: "path" \}\]/);
	const deleteFileSource = read(join(appRoot, "data", "nodes", "definitions", "actions", "file-delete.ts"));
	assert.match(deleteFileSource, /permissionPathRules: \[\{ access: "delete", configKey: "path" \}\]/);

	const { createDeleteFilePermission, createReadFilePermission, createWatchFilePermission, createWriteFilePermission } =
		await loadFilePermissionUtilities();
	assert.equal(createReadFilePermission("workspace/input.txt").name, "file.read");
	assert.equal(createWatchFilePermission("workspace/input").name, "file.watch.limited");
	assert.equal(createWriteFilePermission("workspace/output.txt").name, "file.write.limited");
	assert.equal(createDeleteFilePermission("workspace/output.txt").name, "file.delete.limited");
	for (const path of ["../outside.txt", "nested/../../outside.txt", "..\\outside.txt"]) {
		assert.equal(createReadFilePermission(path).name, "file.read.any", path);
		assert.equal(createWatchFilePermission(path).name, "file.watch.any", path);
		assert.equal(createWriteFilePermission(path).name, "file.write.any", path);
		assert.equal(createDeleteFilePermission(path).name, "file.delete.any", path);
	}
});

test("editor enforces bounded package ingestion limits", () => {
	const assetsSource = read(join(appRoot, "data", "project", "assets.ts"));
	const archiveSource = read(join(appRoot, "utils", "bbs-package-archive.ts"));
	const archiveClientSource = read(join(appRoot, "utils", "package-archive-worker-client.ts"));
	const limitsSource = read(join(appRoot, "data", "project", "package-limits.ts"));
	const workerSource = read(join(appRoot, "utils", "bbs-package.worker.ts"));
	const limits = JSON.parse(read(join(schemasRoot, "package-limits.json")));

	assert.equal(limits.version, 2);
	assert.ok(limits.max_entry_count > 0);
	assert.ok(limits.max_asset_bytes > 0);
	assert.ok(limits.max_total_uncompressed_bytes >= limits.max_asset_bytes);
	assert.match(limitsSource, /contracts\/package-limits\.json/);
	assert.match(assetsSource, /packageLimits\.max_asset_bytes/);
	assert.match(archiveSource, /file\.size > packageLimits\.max_archive_bytes/);
	assert.match(archiveSource, /readArchiveWithWorker/);
	assert.match(archiveClientSource, /worker\.terminate\(\)/);
	assert.match(workerSource, /validateCentralDirectory\(file\)/);
	assert.match(workerSource, /new Uint8Array\(centralEntry\.uncompressedSize\)/);
	assert.doesNotMatch(workerSource, /const chunks:/);
	assert.match(workerSource, /totalUncompressed > packageLimits\.max_total_uncompressed_bytes/);
	assert.match(workerSource, /totalUncompressed \/ file\.size > packageLimits\.max_expansion_ratio/);
});

test("package asset validation requires zip assets and manifest assets to match exactly", () => {
	const packageSource = read(join(appRoot, "utils", "bbs-package.ts"));

	assert.match(packageSource, /function collectPackageAssetManifest/);
	assert.match(packageSource, /validatePackageAssetEntries\(getArchiveEntries\(archive\)\)/);
	assert.match(packageSource, /asset file is not declared in manifest\.json assets/);
	assert.match(packageSource, /is listed in manifest but missing from zip/);
	assert.match(packageSource, /duplicate manifest asset path/);
	assert.match(packageSource, /manifest asset .* must define path/);
});

test("export does not create hidden implicit triggers", () => {
	const analysisSource = read(join(appRoot, "utils", "analysis.ts"));
	const verificationSource = read(join(appRoot, "utils", "verification.ts"));

	assert.equal(analysisSource.includes("implicit-manual-trigger"), false);
	assert.match(analysisSource, /Cannot export a script without at least one trigger node/);
	assert.match(verificationSource, /Canvas > Triggers: add at least one trigger node that can start the script/);
});

test("verification reports exact connection locations and invalid ports", () => {
	const verificationSource = read(join(appRoot, "utils", "verification.ts"));

	assert.match(verificationSource, /const edgeLocation = `Connection/);
	assert.match(verificationSource, /source node .* no longer exists/);
	assert.match(verificationSource, /target node .* no longer exists/);
	assert.match(verificationSource, /Available outputs are/);
	assert.match(verificationSource, /Available inputs are/);
});

test("node-specific verification is owned by node definitions", () => {
	const verificationSource = read(join(appRoot, "utils", "verification.ts"));
	const definitionsSource = readDefinitions();

	assert.equal(/switch\s*\(\s*node\.data\.actionType\s*\)/.test(verificationSource), false);
	assert.match(verificationSource, /validateNodeGraph/);
	assert.match(definitionsSource, /validateConfig:/);
	assert.match(definitionsSource, /validateGraph:/);
});

test("loop control bodies do not require return edges", () => {
	const sharedSource = read(join(appRoot, "data", "nodes", "definitions", "shared.ts"));
	const repeatSource = read(join(appRoot, "data", "nodes", "definitions", "control", "repeat.ts"));
	const breakSource = read(join(appRoot, "data", "nodes", "definitions", "control", "break-loop.ts"));
	const continueSource = read(join(appRoot, "data", "nodes", "definitions", "control", "continue-loop.ts"));
	const whileSource = read(join(appRoot, "data", "nodes", "definitions", "control", "while.ts"));
	const forEachSource = read(join(appRoot, "data", "nodes", "definitions", "control", "for-each.ts"));
	const inspectorSource = read(join(appRoot, "components", "inspector", "inspector.tsx"));
	const helpSource = read(join(appRoot, "components", "modals", "help-modal.tsx"));

	for (const source of [sharedSource, repeatSource, whileSource, forEachSource, inspectorSource, helpSource]) {
		assert.equal(/eventually return|flow back to the loop input|must connect its loop output back/.test(source), false);
	}

	assert.match(sharedSource, /validateLoopBodyDoesNotReturn/);
	assert.match(sharedSource, /validateLoopControlPlacement/);
	assert.match(repeatSource, /validateLoopBodyDoesNotReturn\(node\.id,\s*context\.edges,\s*"repeat"\)/);
	assert.match(whileSource, /validateLoopBodyDoesNotReturn\(node\.id,\s*context\.edges,\s*"loop"\)/);
	assert.match(forEachSource, /validateLoopBodyDoesNotReturn\(node\.id,\s*context\.edges,\s*"loop"\)/);
	assert.match(breakSource, /validateLoopControlPlacement/);
	assert.match(continueSource, /validateLoopControlPlacement/);
	assert.match(inspectorSource, /do not connect it\s+back\s+to the Repeat input/);
	assert.match(helpSource, /body branch should end naturally/);
});

function readDefinitions() {
	return readAll(join(appRoot, "data", "nodes", "definitions"));
}

function readAll(directory) {
	return readdirSync(directory, { withFileTypes: true })
		.map((entry) => {
			const path = join(directory, entry.name);
			return entry.isDirectory() ? readAll(path) : entry.name.endsWith(".ts") ? read(path) : "";
		})
		.join("\n");
}

function read(path) {
	return readFileSync(path, "utf8");
}

function extractConfigField(source, key) {
	const field = source.match(new RegExp(`\\{\\s*key:\\s*"${key}",[\\s\\S]*?\\n\\s*\\},`))?.[0];
	assert.ok(field, `Could not find config field "${key}".`);
	return field;
}

async function loadColorMatcher() {
	const typescript = await import("typescript");
	const source = read(join(appRoot, "data", "nodes", "color-match.ts"));
	const compiled = typescript.transpileModule(source, {
		compilerOptions: {
			module: typescript.ModuleKind.ESNext,
			target: typescript.ScriptTarget.ES2022,
		},
	});
	const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled.outputText).toString("base64")}`;
	return import(moduleUrl);
}

async function loadConditionComparison() {
	const typescript = await import("typescript");
	const safeRegexStubUrl = `data:text/javascript;base64,${Buffer.from(
		'export async function runSafeRegex() { throw new Error("regex execution is outside this contract test"); }',
	).toString("base64")}`;
	const source = read(join(appRoot, "data", "nodes", "condition-comparison.ts")).replace(
		'"@/utils/safe-regex"',
		JSON.stringify(safeRegexStubUrl),
	);
	const compiled = typescript.transpileModule(source, {
		compilerOptions: {
			module: typescript.ModuleKind.ESNext,
			target: typescript.ScriptTarget.ES2022,
		},
	});
	const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled.outputText).toString("base64")}`;
	return import(moduleUrl);
}

async function loadCalculationUtilities() {
	const typescript = await import("typescript");
	const source = read(join(appRoot, "data", "project", "calculation.ts"));
	const compiled = typescript.transpileModule(source, {
		compilerOptions: {
			module: typescript.ModuleKind.ESNext,
			target: typescript.ScriptTarget.ES2022,
		},
	});
	const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled.outputText).toString("base64")}`;
	return import(moduleUrl);
}

async function loadListExpressionUtilities() {
	const typescript = await import("typescript");
	const source = read(join(appRoot, "data", "nodes", "list-expression.ts"));
	const compiled = typescript.transpileModule(source, {
		compilerOptions: {
			module: typescript.ModuleKind.ESNext,
			target: typescript.ScriptTarget.ES2022,
		},
	});
	const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled.outputText).toString("base64")}`;
	return import(moduleUrl);
}

async function loadDatetimeUtilities() {
	const typescript = await import("typescript");
	const source = read(join(appRoot, "data", "project", "datetime.ts"));
	const compiled = typescript.transpileModule(source, {
		compilerOptions: {
			module: typescript.ModuleKind.ESNext,
			target: typescript.ScriptTarget.ES2022,
		},
	});
	const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled.outputText).toString("base64")}`;
	return import(moduleUrl);
}

async function loadFilePermissionUtilities() {
	const typescript = await import("typescript");
	const source = read(join(appRoot, "data", "project", "file-permissions.ts"));
	const compiled = typescript.transpileModule(source, {
		compilerOptions: {
			module: typescript.ModuleKind.ESNext,
			target: typescript.ScriptTarget.ES2022,
		},
	});
	const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled.outputText).toString("base64")}`;
	return import(moduleUrl);
}

async function loadNumericValidator() {
	const typescript = await import("typescript");
	const source = read(join(appRoot, "data", "nodes", "numeric-validation.ts"));
	const compiled = typescript.transpileModule(source, {
		compilerOptions: {
			module: typescript.ModuleKind.ESNext,
			target: typescript.ScriptTarget.ES2022,
		},
	});
	const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled.outputText).toString("base64")}`;
	return import(moduleUrl);
}

async function loadNumericFieldModel() {
	const typescript = await import("typescript");
	const validatorSource = read(join(appRoot, "data", "nodes", "numeric-validation.ts"));
	const compiledValidator = typescript.transpileModule(validatorSource, {
		compilerOptions: {
			module: typescript.ModuleKind.ESNext,
			target: typescript.ScriptTarget.ES2022,
		},
	});
	const validatorUrl = `data:text/javascript;base64,${Buffer.from(compiledValidator.outputText).toString("base64")}`;
	const modelSource = read(join(appRoot, "components", "common", "numeric-field-model.ts")).replace(
		'"@/data/nodes/numeric-validation"',
		JSON.stringify(validatorUrl),
	);
	const compiledModel = typescript.transpileModule(modelSource, {
		compilerOptions: {
			module: typescript.ModuleKind.ESNext,
			target: typescript.ScriptTarget.ES2022,
		},
	});
	const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiledModel.outputText).toString("base64")}`;
	return import(moduleUrl);
}

async function loadScheduleCadence() {
	const typescript = await import("typescript");
	const source = read(join(appRoot, "components", "simulation", "schedule-cadence.ts"));
	const compiled = typescript.transpileModule(source, {
		compilerOptions: {
			module: typescript.ModuleKind.ESNext,
			target: typescript.ScriptTarget.ES2022,
		},
	});
	const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled.outputText).toString("base64")}`;
	return import(moduleUrl);
}

async function loadScriptRepositoryUtilities() {
	const typescript = await import("typescript");
	const source = read(join(appRoot, "utils", "script-repository.ts"));
	const compiled = typescript.transpileModule(source, {
		compilerOptions: {
			module: typescript.ModuleKind.ESNext,
			target: typescript.ScriptTarget.ES2022,
		},
	});
	const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled.outputText).toString("base64")}`;
	return import(moduleUrl);
}

function validMinimum(field) {
	if (field.minimum_inclusive) return field.minimum;
	if (field.kind === "integer") return (BigInt(field.minimum) + 1n).toString();
	return field.minimum === "0" ? "1" : String((Number(field.minimum) + Number(field.maximum)) / 2);
}

function invalidBelowMinimum(field) {
	if (!field.minimum_inclusive) return field.minimum;
	if (field.kind === "integer") return (BigInt(field.minimum) - 1n).toString();
	return String(Number(field.minimum) - 1);
}

function invalidAboveMaximum(field) {
	if (!field.maximum_inclusive) return field.maximum;
	if (field.kind === "integer") return (BigInt(field.maximum) + 1n).toString();
	return Number(field.maximum) === Number.MAX_VALUE ? "1e309" : String(Number(field.maximum) + 1);
}

function readJsonFiles(directory) {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			return readJsonFiles(path);
		}

		return entry.name.endsWith(".json") ? [path] : [];
	});
}

function readSourceFiles(directory) {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) return readSourceFiles(path);
		return /\.tsx?$/.test(entry.name) ? [path] : [];
	});
}

function getDefinitionBlock(source, actionType) {
	const actionTypeIndex = source.indexOf(`actionType: "${actionType}"`);
	assert.notEqual(actionTypeIndex, -1, `${actionType} definition block should exist`);
	const start = source.lastIndexOf("defineNode({", actionTypeIndex);
	const next = source.indexOf("defineNode({", actionTypeIndex + actionType.length);
	const end = next === -1 ? source.length : next;

	assert.notEqual(start, -1, `${actionType} should be inside defineNode`);
	return source.slice(start, end);
}

function extractConstStringArray(source, constName) {
	const match = source.match(new RegExp(`export const ${constName} = \\[([\\s\\S]*?)\\] as const;`));
	assert.ok(match, `${constName} must be exported as a const string array`);
	return [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
}

test("secret declarations are package metadata while simulation values remain session-only", () => {
	const manifestSchema = JSON.parse(read(join(schemasRoot, "manifest.schema.json")));
	const variableSchema = JSON.parse(read(join(schemasRoot, "nodes", "runtime-set-variable.schema.json")));
	const permissionsSchema = JSON.parse(read(join(schemasRoot, "permissions.schema.json")));
	const editorPage = read(join(appRoot, "app", "editor-page.tsx"));
	const packageSource = read(join(appRoot, "utils", "bbs-package.ts"));
	const simulationSource = read(join(appRoot, "utils", "simulation.ts"));

	assert.ok(manifestSchema.properties.secrets, "manifest must declare secret references");
	// A Variable Operation no longer carries a scope: the declaration settles it,
	// so the node schema has no scope property to enumerate.
	assert.equal(variableSchema.$defs.config.properties.scope, undefined);
	assert.deepEqual(manifestSchema.properties.variables.items.properties.scope.enum, [
		"runtime",
		"persistent",
		"global",
	]);
	assert.ok(permissionsSchema.properties.declared_permissions.items.enum.includes("secret.read"));
	assert.match(editorPage, /simulationSecretValues/);
	assert.match(packageSource, /secretDeclarations/);
	assert.doesNotMatch(packageSource, /simulationSecretValues/);
	assert.match(simulationSource, /redactSecretText/);
	assert.match(simulationSource, /redactSnapshotValue/);
	assert.match(simulationSource, /\[REDACTED\]/);
});

test("declared variables are typed package metadata and runner execution state", () => {
	const manifestSchema = JSON.parse(read(join(schemasRoot, "manifest.schema.json")));
	const declaredVariableSource = read(join(appRoot, "data", "project", "declared-variables.ts"));
	const editorPage = read(join(appRoot, "app", "editor-page.tsx"));
	const packageSource = read(join(appRoot, "utils", "bbs-package.ts"));
	const simulationSource = read(join(appRoot, "utils", "simulation.ts"));
	const stringDefaultSchema = manifestSchema.properties.variables.items.oneOf.find(
		(option) => option.properties.type.const === "string",
	);

	assert.ok(manifestSchema.properties.variables, "manifest must declare default variables");
	// A declaration may name any of the three scopes a Variable Operation can.
	// Global was storable but not declarable, which was a gap rather than a
	// decision, and the two enums now agree.
	assert.deepEqual(manifestSchema.properties.variables.items.properties.scope.enum, [
		"runtime",
		"persistent",
		"global",
	]);
	assert.equal(stringDefaultSchema.properties.value.pattern, "\\S");
	assert.match(declaredVariableSource, /Default value is required/);
	assert.match(editorPage, /declaredVariables/);
	assert.match(packageSource, /variables:\s*params\.declaredVariables\.map/);
	assert.match(simulationSource, /declaredVariables[\s\S]*variable\.scope === "persistent"/);
	assert.match(simulationSource, /declaredVariables[\s\S]*variable\.scope === "runtime"/);
	assert.match(simulationSource, /persistentVariables:\s*structuredClone/);
});

test("Script Settings are typed package metadata and read only simulation values", () => {
	const manifestSchema = JSON.parse(read(join(schemasRoot, "manifest.schema.json")));
	const settingSource = read(join(appRoot, "data", "project", "script-settings.ts"));
	const packageSource = read(join(appRoot, "utils", "bbs-package.ts"));
	const simulationSource = read(join(appRoot, "utils", "simulation.ts"));
	const variableNameInputSource = read(join(appRoot, "components", "inspector", "variable-name-input.tsx"));
	const variableOperationSource = read(
		join(appRoot, "data", "nodes", "definitions", "actions", "variable-operation.ts"),
	);
	const settingsSchema = manifestSchema.properties.settings;

	assert.ok(settingsSchema, "manifest must declare Script Settings");
	assert.equal(settingsSchema.maxItems, 256);
	assert.deepEqual(settingsSchema.items.properties.type.enum, [
		"string",
		"integer",
		"float",
		"boolean",
		"object",
		"list",
		"color",
		"hotkey",
		"datetime",
		"duration",
	]);
	assert.deepEqual(settingsSchema.items.properties.item_type.enum, [
		"string",
		"integer",
		"float",
		"boolean",
		"object",
		"color",
		"hotkey",
		"datetime",
		"duration",
	]);
	assert.equal(settingsSchema.items.allOf.length, 10);
	// Settings, variables and node outputs all declare the same vocabulary.
	assert.deepEqual(
		settingsSchema.items.properties.type.enum,
		manifestSchema.properties.variables.items.properties.type.enum,
	);
	// Every type name is a single word, with no separator in any of them.
	for (const type of settingsSchema.items.properties.type.enum) {
		assert.doesNotMatch(type, /[\s_-]/, type);
	}
	assert.match(settingSource, /createSimulationScriptSettingValues/);
	assert.match(packageSource, /settings:\s*params\.scriptSettings\.map/);
	assert.match(simulationSource, /createSimulationScriptSettingValues/);
	// Seeded under the reserved namespace, so a user variable named "settings"
	// cannot shadow the Script Settings object.
	assert.match(simulationSource, /\[SETTINGS_NAMESPACE\]:\s*createSimulationScriptSettingValues\(scriptSettings\)/);
	assert.match(variableNameInputSource, /\.filter\(\(variable\) => !variable\.readOnly/);
	assert.match(
		variableOperationSource,
		/const nameError = validateVariableName\(name\);[\s\S]*if \(nameError\) \{[\s\S]*throw new Error\(nameError\);/,
	);
});

test("IndexedDB is the editor's only normal durable browser storage", () => {
	const allowedLegacyMigration = join(appRoot, "data", "storage", "preference-repository.ts");
	const sourceFiles = ["app", "components", "data", "hooks", "lib", "utils"].flatMap((directory) =>
		readSourceFiles(join(appRoot, directory)),
	);
	const browserStoragePattern = /\b(?:window\.)?(?:localStorage|sessionStorage)\b/;

	for (const filePath of sourceFiles) {
		if (!browserStoragePattern.test(read(filePath))) continue;
		assert.equal(filePath, allowedLegacyMigration, `${filePath} must use the IndexedDB repositories`);
		assert.doesNotMatch(read(filePath), /\bsessionStorage\b/);
	}
});

function extractDefinitionCapabilities(definitionsSource, sharedSource) {
	const sharedCapabilities = new Map(
		[...sharedSource.matchAll(/export const (\w+) = \[([^\]]*)\]/g)].map((match) => [
			match[1],
			[...match[2].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]),
		]),
	);
	const capabilities = [];

	for (const match of definitionsSource.matchAll(/capabilities:\s*(\[[^\]]*\]|\w+)/g)) {
		const value = match[1];
		if (value.startsWith("[")) {
			capabilities.push(...[...value.matchAll(/"([^"]+)"/g)].map((entry) => entry[1]));
			continue;
		}

		capabilities.push(...(sharedCapabilities.get(value) ?? []));
	}

	return capabilities;
}

function extractDefinitionActionTypes(definitionsSource) {
	return [...definitionsSource.matchAll(/actionType:\s*"([^"]+)"/g)].map((match) => match[1]);
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
