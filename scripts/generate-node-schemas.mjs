import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const contractsRoot = join(appRoot, "contracts");
const schemasRoot = contractsRoot;
const nodeSchemasRoot = join(schemasRoot, "nodes");
const runnerCapabilityContractPath = join(contractsRoot, "runner", "node-capabilities.json");
const runnerPermissionContractPath = join(contractsRoot, "runner", "node-permissions.json");
const runnerPortContractPath = join(contractsRoot, "runner", "node-ports.json");
const runnerNumericContractPath = join(contractsRoot, "runner", "node-numeric-fields.json");
const editorKeyboardContractPath = join(appRoot, "data", "nodes", "windows-key-contract.json");
const runnerKeyboardContractPath = join(contractsRoot, "runner", "windows-keyboard-keys.json");
const publicSchemaRoot = "https://schemas.baudbound.app";
const programSchemaUrl = `${publicSchemaRoot}/program.schema.json`;
const conditionRowsRef = `${programSchemaUrl}#/$defs/conditionRows`;
const jsonValueRef = `${programSchemaUrl}#/$defs/jsonValue`;
const runtimeOutputRef = `${programSchemaUrl}#/$defs/runtimeOutput`;
const checkMode = process.argv.includes("--check");
// Read from the editor's own list rather than repeating it. A copy here went
// stale during the type rework and made the generated node schema reject every
// value type the editor could actually produce.
const userValueTypes = readVariableTypes();
const listItemTypes = userValueTypes.filter((type) => type !== "list");

function readVariableTypes() {
	const source = readFileSync(join(appRoot, "data", "project", "variables.ts"), "utf8");
	const match = source.match(/export const variableTypes = \[([\s\S]*?)\] as const;/);
	assert.ok(match, "variableTypes must be exported as a const string array");
	const types = [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
	assert.ok(types.length > 0, "variableTypes must not be empty");
	return types;
}

assert.ok(
	existsSync(join(contractsRoot, "contract.json")),
	"Contracts submodule is not initialized. Run `git submodule update --init --recursive`.",
);

const optionValues = createOptionValueMap();
const sharedConfigFields = createSharedConfigFieldMap();
const sharedCapabilityValues = createSharedCapabilityValueMap();
const definitions = readNodeDefinitions().sort((a, b) => a.actionType.localeCompare(b.actionType));
const generatedNodeSchemas = Object.fromEntries(
	definitions.map((definition) => [getNodeSchemaFileName(definition.actionType), createNodeSchema(definition)]),
);
const generatedProgramSchema = createProgramSchema(
	JSON.parse(readFileSync(join(schemasRoot, "program.schema.json"), "utf8")),
);
const generatedRunnerCapabilityContract = createRunnerCapabilityContract();
const generatedRunnerPermissionContract = createRunnerPermissionContract();
const generatedRunnerPortContract = createRunnerPortContract();
const generatedRunnerNumericContract = createRunnerNumericContract();
const generatedRunnerKeyboardContract = JSON.parse(readFileSync(editorKeyboardContractPath, "utf8"));

if (checkMode) {
	assertGeneratedFile(join(schemasRoot, "program.schema.json"), generatedProgramSchema);
	assertGeneratedFile(runnerCapabilityContractPath, generatedRunnerCapabilityContract);
	assertGeneratedFile(runnerPermissionContractPath, generatedRunnerPermissionContract);
	assertGeneratedFile(runnerPortContractPath, generatedRunnerPortContract);
	assertGeneratedFile(runnerNumericContractPath, generatedRunnerNumericContract);
	assertGeneratedFile(runnerKeyboardContractPath, generatedRunnerKeyboardContract);
	for (const [fileName, schema] of Object.entries(generatedNodeSchemas)) {
		assertGeneratedFile(join(nodeSchemasRoot, fileName), schema);
	}
	const expectedFiles = new Set(Object.keys(generatedNodeSchemas));
	const actualFiles = existsSync(nodeSchemasRoot)
		? readdirSync(nodeSchemasRoot).filter((fileName) => fileName.endsWith(".schema.json"))
		: [];
	for (const fileName of actualFiles) {
		assert.ok(expectedFiles.has(fileName), `Unexpected generated node schema: ${fileName}`);
	}
	process.exit(0);
}

mkdirSync(nodeSchemasRoot, { recursive: true });
for (const fileName of readdirSync(nodeSchemasRoot)) {
	if (fileName.endsWith(".schema.json")) {
		rmSync(join(nodeSchemasRoot, fileName));
	}
}
writeJson(join(schemasRoot, "program.schema.json"), generatedProgramSchema);
mkdirSync(dirname(runnerCapabilityContractPath), { recursive: true });
writeJson(runnerCapabilityContractPath, generatedRunnerCapabilityContract);
writeJson(runnerPermissionContractPath, generatedRunnerPermissionContract);
mkdirSync(dirname(runnerPortContractPath), { recursive: true });
writeJson(runnerPortContractPath, generatedRunnerPortContract);
writeJson(runnerNumericContractPath, generatedRunnerNumericContract);
mkdirSync(dirname(runnerKeyboardContractPath), { recursive: true });
writeJson(runnerKeyboardContractPath, generatedRunnerKeyboardContract);
for (const [fileName, schema] of Object.entries(generatedNodeSchemas)) {
	writeJson(join(nodeSchemasRoot, fileName), schema);
}

function createRunnerCapabilityContract() {
	return {
		version: 1,
		nodes: Object.fromEntries(definitions.map((definition) => [definition.actionType, definition.capabilities])),
	};
}

function createRunnerPermissionContract() {
	return {
		version: 1,
		nodes: Object.fromEntries(
			definitions.map((definition) => [
				definition.actionType,
				{
					permission: definition.permission,
					path_rules: definition.permissionPathRules,
				},
			]),
		),
	};
}

function createRunnerPortContract() {
	return {
		version: 1,
		nodes: Object.fromEntries(definitions.map((definition) => [definition.actionType, resolvePortPolicy(definition)])),
	};
}

function createRunnerNumericContract() {
	return {
		version: 2,
		nodes: Object.fromEntries(
			definitions.map((definition) => [
				definition.actionType,
				Object.fromEntries(
					definition.configFields
						.filter((field) => field.numeric)
						.map((field) => [
							field.key,
							{
								kind: field.numeric.kind,
								signed: field.numeric.signed,
								minimum: field.numeric.minimum,
								maximum: field.numeric.maximum,
								minimum_inclusive: field.numeric.minimumInclusive,
								maximum_inclusive: field.numeric.maximumInclusive,
								label: field.label,
								required: field.required !== false,
								allows_variables: field.usesVariables,
								...(field.numericWhen
									? {
											when: {
												key: field.numericWhen.key,
												equals: field.numericWhen.equals,
											},
										}
									: {}),
							},
						]),
				),
			]),
		),
	};
}

function resolvePortPolicy(definition) {
	if (definition.portPolicy) {
		return definition.portPolicy;
	}
	if (definition.kind === "trigger") {
		return { kind: "fixed", inputs: [], outputs: ["out"] };
	}
	if (definition.fallible) {
		return { kind: "fixed", inputs: ["input"], outputs: ["success", "failed"] };
	}
	return { kind: "fixed", inputs: ["input"], outputs: ["out"] };
}

function createProgramSchema(programSchema) {
	const triggerDefinitions = definitions.filter((definition) => definition.kind === "trigger");
	const controlDefinitions = definitions.filter((definition) => definition.kind === "control");
	const executableActionDefinitions = definitions.filter(
		(definition) => definition.kind === "action" && definition.actionType !== "runtime.set_variable",
	);
	const triggerRefs = triggerDefinitions.map((definition) => schemaRef(definition.actionType));
	const controlRefs = controlDefinitions.map((definition) => schemaRef(definition.actionType));
	const variableOperationRefs = definitions
		.filter((definition) => definition.actionType === "runtime.set_variable")
		.map((definition) => schemaRef(definition.actionType));
	const actionRefs = executableActionDefinitions.map((definition) => schemaRef(definition.actionType));

	return {
		...programSchema,
		$defs: {
			...programSchema.$defs,
			actionType: stringEnum(definitions.map((definition) => definition.actionType)),
			actionRunnerType: stringEnum(executableActionDefinitions.map((definition) => definition.runnerType)),
			controlActionType: stringEnum(controlDefinitions.map((definition) => definition.actionType)),
			controlStepType: stringEnum(controlDefinitions.map((definition) => definition.controlType)),
			executableActionType: stringEnum(executableActionDefinitions.map((definition) => definition.actionType)),
			triggerActionType: stringEnum(triggerDefinitions.map((definition) => definition.actionType)),
			triggerType: stringEnum(triggerDefinitions.map((definition) => definition.runnerType)),
			trigger: { oneOf: triggerRefs },
			controlStep: { oneOf: controlRefs },
			variableOperationStep: { oneOf: variableOperationRefs },
			actionStep: { oneOf: actionRefs },
			step: {
				oneOf: [
					{ $ref: "#/$defs/controlStep" },
					{ $ref: "#/$defs/variableOperationStep" },
					{ $ref: "#/$defs/actionStep" },
				],
			},
		},
	};
}

function stringEnum(values) {
	return {
		type: "string",
		enum: [...new Set(values.filter(Boolean))],
	};
}

function createNodeSchema(definition) {
	const configSchema = createConfigSchema(definition);
	const required = ["id", "action_type", "type", "config", "runtime_outputs"];
	const properties = {
		id: { type: "string", minLength: 1 },
		action_type: { const: definition.actionType },
		type: { const: getProgramNodeType(definition) },
		config: { $ref: "#/$defs/config" },
		runtime_outputs: {
			type: "array",
			items: { $ref: runtimeOutputRef },
		},
	};

	if (definition.kind === "action" && definition.actionType !== "runtime.set_variable") {
		required.splice(3, 0, "action");
		properties.action = { const: definition.runnerType };
	}

	return {
		$schema: "https://json-schema.org/draft/2020-12/schema",
		$id: `${publicSchemaRoot}/nodes/${getNodeSchemaFileName(definition.actionType)}`,
		title: `BaudBound Node - ${definition.label}`,
		type: "object",
		additionalProperties: false,
		required,
		properties,
		$defs: {
			config: configSchema,
		},
	};
}

function createConfigSchema(definition) {
	if (definition.actionType === "runtime.set_variable") {
		return createVariableOperationConfigSchema(definition);
	}

	const fieldsByKey = new Map(definition.configFields.map((field) => [field.key, field]));
	const keys = new Set(["customName", ...definition.defaultConfigKeys, ...fieldsByKey.keys()]);
	const properties = {};
	const required = [];

	for (const key of [...keys].sort()) {
		if (key === "customName") {
			properties[key] = { type: "string" };
			continue;
		}

		const field = fieldsByKey.get(key);
		properties[key] =
			definition.actionType === "control.if" && key === "conditions"
				? { $ref: conditionRowsRef }
				: definition.actionType === "control.while" && key === "conditions"
					? { $ref: conditionRowsRef }
					: definition.actionType === "action.text.format" && key === "operations"
						? createTextTransformOperationsSchema()
						: field
							? createConfigFieldSchema(field)
							: { $ref: jsonValueRef };
		if (field && field.required !== false) {
			required.push(key);
		}
	}
	if (definition.actionType === "action.text.format") {
		required.push("operations");
	}

	const schema = {
		type: "object",
		additionalProperties: false,
		...(required.length > 0 ? { required: required.sort() } : {}),
		properties,
	};
	return schema;
}

function createVariableOperationConfigSchema(definition) {
	const fieldsByKey = new Map(definition.configFields.map((field) => [field.key, field]));
	const keys = new Set(["customName", ...definition.defaultConfigKeys, ...fieldsByKey.keys()]);
	const properties = {};
	const required = [];

	for (const key of [...keys].sort()) {
		if (key === "customName") {
			properties[key] = { type: "string" };
			continue;
		}

		const field = fieldsByKey.get(key);
		properties[key] =
			key === "valueType" || key === "fieldValueType"
				? stringEnum(userValueTypes)
				: key === "itemType" || key === "fieldItemType"
					? stringEnum(listItemTypes)
					: key === "removeMode"
						? stringEnum(["first", "all"])
						: field
							? createConfigFieldSchema(field)
							: { $ref: jsonValueRef };
		if (field && field.required !== false) {
			required.push(key);
		}
	}

	return {
		type: "object",
		additionalProperties: false,
		...(required.length > 0 ? { required: required.sort() } : {}),
		properties,
		// A set used to have to carry valueType, and a set of a list itemType
		// alongside it. Neither is a node property now: the declaration carries
		// the type and, for a list, what it holds.
		allOf: [
			{
				if: {
					properties: {
						operation: { enum: ["set_object_field", "remove_object_field"] },
					},
				},
				// biome-ignore lint/suspicious/noThenProperty: JSON Schema conditionals use the then keyword.
				then: {
					required: ["fieldPath"],
				},
			},
			{
				if: {
					properties: {
						operation: { const: "set_object_field" },
					},
				},
				// biome-ignore lint/suspicious/noThenProperty: JSON Schema conditionals use the then keyword.
				then: {
					required: ["fieldValueType"],
				},
			},
			{
				if: {
					properties: {
						operation: { const: "set_object_field" },
						fieldValueType: { const: "list" },
					},
					required: ["fieldValueType"],
				},
				// biome-ignore lint/suspicious/noThenProperty: JSON Schema conditionals use the then keyword.
				then: {
					required: ["fieldItemType"],
				},
			},
			{
				if: {
					properties: {
						operation: { const: "remove_list_items" },
					},
				},
				// biome-ignore lint/suspicious/noThenProperty: JSON Schema conditionals use the then keyword.
				then: {
					required: ["removeMode"],
				},
			},
		],
	};
}

function createTextTransformOperationsSchema() {
	return {
		type: "array",
		minItems: 1,
		maxItems: 100,
		items: {
			type: "object",
			additionalProperties: false,
			required: ["id", "operation"],
			properties: {
				id: { type: "string", minLength: 1 },
				operation: {
					type: "string",
					enum: [
						"template",
						"trim",
						"uppercase",
						"lowercase",
						"sentence_case",
						"capitalize_words",
						"replace",
						"regex_replace",
						"split",
						"join",
						"substring",
						"pad_start",
						"pad_end",
						"url_encode",
						"url_decode",
						"base64_encode",
						"base64_decode",
						"json_escape",
						"json_unescape",
					],
				},
				template: { type: "string" },
				search: { type: "string" },
				replacement: { type: "string" },
				delimiter: { type: "string" },
				start: {
					anyOf: [
						{ type: "integer", minimum: 0 },
						{ type: "string", minLength: 1 },
					],
				},
				length: {
					anyOf: [
						{ type: "integer", minimum: 0 },
						{ type: "string", minLength: 1 },
					],
				},
				targetLength: {
					anyOf: [
						{ type: "integer", minimum: 0 },
						{ type: "string", minLength: 1 },
					],
				},
				pad: { type: "string" },
			},
		},
	};
}

function createConfigFieldSchema(field) {
	if (field.type === "text" || field.type === "textarea") {
		return field.identifier ? { type: "string", pattern: "^[A-Za-z0-9_-]+$" } : { type: "string" };
	}

	if (field.type === "string-list") {
		return {
			type: "array",
			items: { type: "string" },
		};
	}

	if (field.type === "form-field-list") {
		return createFormDialogFieldsSchema();
	}

	if (field.type === "switch") {
		return { type: "boolean" };
	}

	if (field.type === "select") {
		const schema = { type: "string" };
		if (field.options.length > 0) {
			schema.enum = field.options;
		}
		return schema;
	}

	const numberString = field.usesVariables
		? {
				type: "string",
				minLength: 1,
			}
		: {
				type: "string",
				pattern: numericStringPattern(field.numeric),
			};
	const numberSchema = {
		type: field.numeric.kind === "integer" ? "integer" : "number",
		[field.numeric.minimumInclusive ? "minimum" : "exclusiveMinimum"]: Number(field.numeric.minimum),
		[field.numeric.maximumInclusive ? "maximum" : "exclusiveMaximum"]: Number(field.numeric.maximum),
	};

	return {
		anyOf: [numberSchema, numberString],
	};
}

function createFormDialogFieldsSchema() {
	const commonInputProperties = {
		type: { type: "string" },
		key: { type: "string", minLength: 1, maxLength: 64, pattern: "^[A-Za-z0-9_-]+$" },
		label: { type: "string", minLength: 1, maxLength: 200 },
		description: { type: "string", maxLength: 2048 },
		required: { type: "boolean" },
	};
	const input = (type, properties, required) => ({
		type: "object",
		additionalProperties: false,
		required: ["type", "key", "label", "description", "required", ...required],
		properties: { ...commonInputProperties, type: { const: type }, ...properties },
	});
	const textProperties = {
		placeholder: { type: "string", maxLength: 512 },
		defaultValue: { type: "string", maxLength: 16384 },
	};
	const choiceSchema = {
		type: "array",
		minItems: 1,
		maxItems: 100,
		items: {
			type: "object",
			additionalProperties: false,
			required: ["key", "displayValue"],
			properties: {
				key: { type: "string", minLength: 1, maxLength: 512, pattern: "^[A-Za-z0-9_-]+$" },
				displayValue: { type: "string", minLength: 1, maxLength: 512 },
			},
		},
	};
	const presentation = (type, properties = {}) => ({
		type: "object",
		additionalProperties: false,
		required: ["type", "label", "description", ...Object.keys(properties)],
		properties: {
			type: { const: type },
			label: { type: "string", maxLength: 200 },
			description: { type: "string", maxLength: 2048 },
			...properties,
		},
	});
	const defaultValue = { type: "string", maxLength: 16384 };
	return {
		type: "array",
		minItems: 1,
		maxItems: 50,
		items: {
			oneOf: [
				input("text", textProperties, ["placeholder", "defaultValue"]),
				input("multiline", textProperties, ["placeholder", "defaultValue"]),
				input("number", textProperties, ["placeholder", "defaultValue"]),
				input("password", { placeholder: { type: "string", maxLength: 512 } }, ["placeholder"]),
				input("checkbox", { defaultChecked: { type: "boolean" } }, ["defaultChecked"]),
				input("single_choice", { choices: choiceSchema }, ["choices"]),
				input("multi_choice", { choices: choiceSchema }, ["choices"]),
				input("dropdown", { choices: choiceSchema }, ["choices"]),
				input("date", { defaultValue }, ["defaultValue"]),
				input("time", { defaultValue }, ["defaultValue"]),
				input("datetime", { defaultValue, timezone: { type: "string", minLength: 1, maxLength: 128 } }, [
					"defaultValue",
					"timezone",
				]),
				input("color", { defaultValue }, ["defaultValue"]),
				input("file", { multiple: { type: "boolean" } }, ["multiple"]),
				input("folder", {}, []),
				input(
					"slider",
					{
						defaultValue,
						minimum: { type: "string", minLength: 1, maxLength: 512 },
						maximum: { type: "string", minLength: 1, maxLength: 512 },
						step: { type: "string", minLength: 1, maxLength: 512 },
					},
					["defaultValue", "minimum", "maximum", "step"],
				),
				presentation("information", { accentColor: { type: "string", minLength: 1, maxLength: 512 } }),
				presentation("section_heading", { accentColor: { type: "string", minLength: 1, maxLength: 512 } }),
				presentation("divider", { accentColor: { type: "string", minLength: 1, maxLength: 512 } }),
				presentation("image", {
					assetPath: { type: "string", minLength: 1, maxLength: 1024 },
					imageFit: { type: "string", enum: ["contain", "cover"] },
					imageHeight: { type: "string", minLength: 1, maxLength: 512 },
				}),
			],
		},
	};
}

function numericStringPattern(contract) {
	if (contract.kind === "integer") {
		return contract.signed ? "^-?(?:0|[1-9][0-9]*)$" : "^(?:0|[1-9][0-9]*)$";
	}
	const sign = contract.signed ? "-?" : "";
	return `^${sign}(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$`;
}

function getProgramNodeType(definition) {
	if (definition.kind === "trigger" || definition.kind === "control") {
		return definition.runnerType ?? definition.controlType;
	}

	return definition.actionType === "runtime.set_variable" ? "set_variable" : "action";
}

function readNodeDefinitions() {
	const definitionsRoot = join(appRoot, "data", "nodes", "definitions");
	const files = collectFiles(definitionsRoot).filter((filePath) => filePath.endsWith(".ts"));
	const definitions = [];

	for (const filePath of files) {
		const sourceFile = ts.createSourceFile(filePath, readFileSync(filePath, "utf8"), ts.ScriptTarget.Latest, true);
		visit(sourceFile, (node) => {
			if (!isDefineNodeCall(node)) {
				return;
			}

			const object = node.arguments[0];
			if (!ts.isObjectLiteralExpression(object)) {
				return;
			}

			definitions.push(readDefinitionObject(object, filePath));
		});
	}

	return definitions;
}

function readDefinitionObject(object, filePath) {
	const actionType = getRequiredStringProperty(object, "actionType", filePath);
	const kind = getRequiredStringProperty(object, "kind", filePath);
	const label = getRequiredStringProperty(object, "label", filePath);
	const runnerType = getOptionalStringProperty(object, "runnerType");
	const controlType = getOptionalStringProperty(object, "controlType");
	const capabilities = readCapabilities(getPropertyInitializer(object, "capabilities"), actionType);
	const configFields = readConfigFields(getPropertyInitializer(object, "configFields"), actionType);
	const defaultConfigKeys = readDefaultConfigKeys(getPropertyInitializer(object, "defaultConfig"));
	const fallible = getOptionalBooleanProperty(object, "fallible") === true;
	const permission = readPermission(getPropertyInitializer(object, "permission"), actionType);
	const permissionPathRules = readPermissionPathRules(
		getPropertyInitializer(object, "permissionPathRules"),
		actionType,
	);
	const portPolicy = readPortPolicy(getPropertyInitializer(object, "portPolicy"), actionType);

	return {
		actionType,
		capabilities,
		configFields,
		controlType,
		defaultConfigKeys,
		fallible,
		kind,
		label,
		permission,
		permissionPathRules,
		portPolicy,
		runnerType,
		source: relative(appRoot, filePath).split(sep).join("/"),
	};
}

function readPortPolicy(initializer, actionType) {
	if (!initializer) {
		return null;
	}
	if (!ts.isObjectLiteralExpression(initializer)) {
		throw new Error(`${actionType} portPolicy must be an object literal.`);
	}
	const kind = getRequiredStringProperty(initializer, "kind", actionType);
	if (kind === "fixed") {
		return {
			kind,
			inputs: readRequiredStringArrayProperty(initializer, "inputs", actionType),
			outputs: readRequiredStringArrayProperty(initializer, "outputs", actionType),
		};
	}
	if (kind === "switch-cases") {
		return {
			kind: "switch_cases",
			config_key: getRequiredStringProperty(initializer, "configKey", actionType),
			default_output: getRequiredStringProperty(initializer, "defaultOutput", actionType),
			input: "input",
			output_prefix: getRequiredStringProperty(initializer, "outputPrefix", actionType),
		};
	}
	throw new Error(`${actionType} portPolicy kind ${kind} is unsupported.`);
}

function readRequiredStringArrayProperty(object, name, actionType) {
	const initializer = getPropertyInitializer(object, name);
	if (!initializer || !ts.isArrayLiteralExpression(initializer)) {
		throw new Error(`${actionType} portPolicy ${name} must be a string array literal.`);
	}
	const values = readStringArrayValues(initializer);
	if (values.length !== initializer.elements.length) {
		throw new Error(`${actionType} portPolicy ${name} must contain only strings.`);
	}
	return values;
}

function readPermission(initializer, actionType) {
	if (!initializer) {
		return null;
	}
	if (!ts.isObjectLiteralExpression(initializer)) {
		throw new Error(`${actionType} permission must be an object literal.`);
	}
	return {
		name: getRequiredStringProperty(initializer, "name", actionType),
		risk: getRequiredStringProperty(initializer, "risk", actionType),
	};
}

function readPermissionPathRules(initializer, actionType) {
	if (!initializer) {
		return [];
	}
	if (!ts.isArrayLiteralExpression(initializer)) {
		throw new Error(`${actionType} permissionPathRules must be an array literal.`);
	}
	return initializer.elements.map((element) => {
		if (!ts.isObjectLiteralExpression(element)) {
			throw new Error(`${actionType} permissionPathRules entries must be object literals.`);
		}
		const access = getRequiredStringProperty(element, "access", actionType);
		if (access !== "delete" && access !== "read" && access !== "watch" && access !== "write") {
			throw new Error(`${actionType} permission path access must be delete, read, watch, or write.`);
		}
		return {
			access,
			config_key: getRequiredStringProperty(element, "configKey", actionType),
		};
	});
}

function readCapabilities(initializer, actionType) {
	if (ts.isArrayLiteralExpression(initializer)) {
		const capabilities = readStringArrayValues(initializer);
		if (capabilities.length > 0) {
			return [...new Set(capabilities)].sort();
		}
	}

	if (ts.isIdentifier(initializer)) {
		const capabilities = sharedCapabilityValues.get(initializer.text);
		if (capabilities) {
			return capabilities;
		}
	}

	throw new Error(`${actionType} capabilities must be a non-empty string array or a shared capability constant.`);
}

function createSharedCapabilityValueMap() {
	const source = ts.createSourceFile(
		"shared.ts",
		readFileSync(join(appRoot, "data", "nodes", "definitions", "shared.ts"), "utf8"),
		ts.ScriptTarget.Latest,
		true,
	);
	const values = new Map();

	for (const statement of source.statements) {
		if (!ts.isVariableStatement(statement)) {
			continue;
		}
		for (const declaration of statement.declarationList.declarations) {
			if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
				continue;
			}
			const capabilities = readStringArrayValues(unwrapAsConst(declaration.initializer));
			if (capabilities.length > 0) {
				values.set(declaration.name.text, [...new Set(capabilities)].sort());
			}
		}
	}

	return values;
}

function readConfigFields(initializer, actionType) {
	if (!initializer) {
		return [];
	}

	if (!ts.isArrayLiteralExpression(initializer)) {
		throw new Error(`${actionType} configFields must be an array literal for schema generation.`);
	}

	// A trigger spreads its shared fields rather than restating them, so the
	// option list has one definition. Resolve the spread to the object literals
	// it stands for before reading any of them.
	const elements = initializer.elements.flatMap((element) => {
		if (!ts.isSpreadElement(element)) {
			return [element];
		}
		if (!ts.isIdentifier(element.expression)) {
			throw new Error(`${actionType} configFields may only spread a named shared field list.`);
		}
		const shared = sharedConfigFields.get(element.expression.text);
		if (!shared) {
			throw new Error(
				`${actionType} configFields spreads ${element.expression.text}, which is not exported by shared-fields.ts.`,
			);
		}
		return shared;
	});

	const fields = elements.map((element) => {
		if (!ts.isObjectLiteralExpression(element)) {
			throw new Error(`${actionType} configFields entries must be object literals.`);
		}

		const key = getRequiredStringProperty(element, "key", actionType);
		const label = getRequiredStringProperty(element, "label", actionType);
		const type = getRequiredStringProperty(element, "type", actionType);
		const numericWhen = readNumericCondition(getPropertyInitializer(element, "numericWhen"), actionType, key);
		const numeric = readNumericContract(getPropertyInitializer(element, "numeric"), type, numericWhen, actionType, key);
		return {
			identifier: getOptionalBooleanProperty(element, "identifier") === true,
			key,
			label,
			numeric,
			numericWhen,
			options: readFieldOptions(getPropertyInitializer(element, "options")),
			required: getOptionalBooleanProperty(element, "required"),
			type,
			usesVariables: getOptionalBooleanProperty(element, "usesVariables") === true,
		};
	});

	for (const field of fields) {
		if (!field.numericWhen) continue;
		const conditionField = fields.find((candidate) => candidate.key === field.numericWhen.key);
		if (!conditionField) {
			throw new Error(
				`${actionType} numeric field ${field.key} references missing condition field ${field.numericWhen.key}.`,
			);
		}
		if (conditionField.type !== "select" || !conditionField.options.includes(field.numericWhen.equals)) {
			throw new Error(
				`${actionType} numeric field ${field.key} condition ${field.numericWhen.key}=${field.numericWhen.equals} is not a declared select option.`,
			);
		}
	}
	return fields;
}

function readNumericContract(initializer, type, numericWhen, actionType, key) {
	if (!initializer) {
		if (type === "number") {
			throw new Error(`${actionType} numeric config field ${key} must declare numeric constraints.`);
		}
		if (numericWhen) {
			throw new Error(`${actionType} config field ${key} declares numericWhen without numeric constraints.`);
		}
		return null;
	}
	if (!ts.isObjectLiteralExpression(initializer)) {
		throw new Error(`${actionType} numeric config field ${key} must declare numeric constraints.`);
	}
	if (type !== "number" && (type !== "text" || !numericWhen)) {
		throw new Error(`${actionType} config field ${key} may only use conditional numeric constraints on text fields.`);
	}
	if (type === "number" && numericWhen) {
		throw new Error(`${actionType} number field ${key} cannot declare a conditional numeric contract.`);
	}

	const contract = {
		kind: getRequiredStringProperty(initializer, "kind", `${actionType}.${key}`),
		signed: getRequiredBooleanProperty(initializer, "signed", `${actionType}.${key}`),
		minimum: getRequiredStringProperty(initializer, "minimum", `${actionType}.${key}`),
		maximum: getRequiredStringProperty(initializer, "maximum", `${actionType}.${key}`),
		minimumInclusive: getRequiredBooleanProperty(initializer, "minimumInclusive", `${actionType}.${key}`),
		maximumInclusive: getRequiredBooleanProperty(initializer, "maximumInclusive", `${actionType}.${key}`),
	};
	if (contract.kind !== "integer" && contract.kind !== "float") {
		throw new Error(`${actionType} numeric config field ${key} has unsupported kind ${contract.kind}.`);
	}
	if (!Number.isFinite(Number(contract.minimum)) || !Number.isFinite(Number(contract.maximum))) {
		throw new Error(`${actionType} numeric config field ${key} must use finite bounds.`);
	}
	return contract;
}

function readNumericCondition(initializer, actionType, key) {
	if (!initializer) return null;
	if (!ts.isObjectLiteralExpression(initializer)) {
		throw new Error(`${actionType} numeric condition for ${key} must be an object literal.`);
	}
	return {
		key: getRequiredStringProperty(initializer, "key", `${actionType}.${key}.numericWhen`),
		equals: getRequiredStringProperty(initializer, "equals", `${actionType}.${key}.numericWhen`),
	};
}

function readFieldOptions(initializer) {
	if (!initializer) {
		return [];
	}

	if (ts.isIdentifier(initializer)) {
		return optionValues.get(initializer.text) ?? [];
	}

	if (ts.isArrayLiteralExpression(initializer)) {
		return readSelectOptionValues(initializer);
	}

	return [];
}

function readDefaultConfigKeys(initializer) {
	if (!initializer || !ts.isArrowFunction(initializer)) {
		return [];
	}

	const body = unwrapParenthesized(initializer.body);
	if (!ts.isObjectLiteralExpression(body)) {
		return [];
	}

	return body.properties
		.filter(ts.isPropertyAssignment)
		.map((property) => getPropertyName(property.name))
		.filter(Boolean);
}

/**
 * Collects the shared config field lists a trigger may spread.
 *
 * Returns the object literal nodes themselves, so a spread field is read by
 * exactly the same code that reads a field written in place.
 */
function createSharedConfigFieldMap() {
	const source = ts.createSourceFile(
		"shared-fields.ts",
		readFileSync(join(appRoot, "data", "nodes", "definitions", "shared-fields.ts"), "utf8"),
		ts.ScriptTarget.Latest,
		true,
	);
	const fields = new Map();

	for (const statement of source.statements) {
		if (!ts.isVariableStatement(statement)) {
			continue;
		}

		for (const declaration of statement.declarationList.declarations) {
			if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
				continue;
			}

			const initializer = unwrapAsConst(declaration.initializer);
			if (ts.isArrayLiteralExpression(initializer)) {
				fields.set(declaration.name.text, [...initializer.elements]);
			}
		}
	}

	return fields;
}
function createOptionValueMap() {
	const optionsSource = ts.createSourceFile(
		"options.ts",
		readFileSync(join(appRoot, "data", "nodes", "definitions", "options.ts"), "utf8"),
		ts.ScriptTarget.Latest,
		true,
	);
	const serialSource = ts.createSourceFile(
		"serial.ts",
		readFileSync(join(appRoot, "data", "project", "serial.ts"), "utf8"),
		ts.ScriptTarget.Latest,
		true,
	);
	const variablesSource = ts.createSourceFile(
		"variables.ts",
		readFileSync(join(appRoot, "data", "project", "variables.ts"), "utf8"),
		ts.ScriptTarget.Latest,
		true,
	);
	// convert-value.ts is the one node definition that declares its own select
	// options locally instead of adding them to options.ts. Leaving it out of
	// this list silently produced an unconstrained `{ type: "string" }` schema
	// for targetType instead of the enum its options actually define.
	const convertValueSource = ts.createSourceFile(
		"convert-value.ts",
		readFileSync(join(appRoot, "data", "nodes", "definitions", "actions", "convert-value.ts"), "utf8"),
		ts.ScriptTarget.Latest,
		true,
	);
	const values = new Map();

	for (const sourceFile of [variablesSource, serialSource, optionsSource, convertValueSource]) {
		for (const statement of sourceFile.statements) {
			if (!ts.isVariableStatement(statement)) {
				continue;
			}

			for (const declaration of statement.declarationList.declarations) {
				if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
					continue;
				}

				const name = declaration.name.text;
				const initializer = unwrapAsConst(declaration.initializer);
				const literalValues = readStringArrayValues(initializer);
				if (literalValues.length > 0) {
					values.set(name, literalValues);
					continue;
				}

				const optionList = readOptionInitializerValues(initializer, values);
				if (optionList.length > 0) {
					values.set(name, optionList);
				}
			}
		}
	}

	return values;
}

function readOptionInitializerValues(initializer, values) {
	if (ts.isArrayLiteralExpression(initializer)) {
		return readSelectOptionValues(initializer, values);
	}

	if (ts.isCallExpression(initializer) && ts.isPropertyAccessExpression(initializer.expression)) {
		const expression = initializer.expression;
		if (expression.name.text !== "map") {
			return [];
		}

		if (ts.isIdentifier(expression.expression)) {
			return values.get(expression.expression.text) ?? [];
		}

		return readStringArrayValues(expression.expression);
	}

	return [];
}

function readSelectOptionValues(array, values = new Map()) {
	const output = [];

	for (const element of array.elements) {
		if (ts.isSpreadElement(element) && ts.isIdentifier(element.expression)) {
			output.push(...(values.get(element.expression.text) ?? []));
			continue;
		}

		if (ts.isObjectLiteralExpression(element)) {
			const value = getOptionalStringProperty(element, "value");
			if (value) {
				output.push(value);
			}
		}
	}

	return [...new Set(output)];
}

function readStringArrayValues(initializer) {
	if (!ts.isArrayLiteralExpression(initializer)) {
		return [];
	}

	const values = [];
	for (const element of initializer.elements) {
		if (ts.isStringLiteral(element) || ts.isNumericLiteral(element)) {
			values.push(element.text);
		}
	}
	return values;
}

function isDefineNodeCall(node) {
	return (
		ts.isCallExpression(node) &&
		ts.isIdentifier(node.expression) &&
		node.expression.text === "defineNode" &&
		node.arguments.length > 0
	);
}

function getRequiredStringProperty(object, name, label) {
	const value = getOptionalStringProperty(object, name);
	if (!value) {
		throw new Error(`${label} is missing required string property ${name}.`);
	}
	return value;
}

function getOptionalStringProperty(object, name) {
	const initializer = getPropertyInitializer(object, name);
	return initializer && ts.isStringLiteral(initializer) ? initializer.text : undefined;
}

function getOptionalBooleanProperty(object, name) {
	const initializer = getPropertyInitializer(object, name);
	if (!initializer) {
		return undefined;
	}
	if (initializer.kind === ts.SyntaxKind.TrueKeyword) {
		return true;
	}
	if (initializer.kind === ts.SyntaxKind.FalseKeyword) {
		return false;
	}
	return undefined;
}

function getRequiredBooleanProperty(object, name, label) {
	const value = getOptionalBooleanProperty(object, name);
	if (value === undefined) {
		throw new Error(`${label} is missing required boolean property ${name}.`);
	}
	return value;
}

function getPropertyInitializer(object, name) {
	const property = object.properties.find(
		(entry) => ts.isPropertyAssignment(entry) && getPropertyName(entry.name) === name,
	);
	return property && ts.isPropertyAssignment(property) ? unwrapParenthesized(property.initializer) : undefined;
}

function getPropertyName(name) {
	if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
		return name.text;
	}
	return undefined;
}

function unwrapAsConst(node) {
	if (ts.isAsExpression(node)) {
		return unwrapAsConst(node.expression);
	}
	return unwrapParenthesized(node);
}

function unwrapParenthesized(node) {
	return ts.isParenthesizedExpression(node) ? unwrapParenthesized(node.expression) : node;
}

function visit(node, callback) {
	callback(node);
	node.forEachChild((child) => visit(child, callback));
}

function collectFiles(directory) {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		return entry.isDirectory() ? collectFiles(path) : [path];
	});
}

function getNodeSchemaFileName(actionType) {
	return `${actionType.replaceAll(".", "-").replaceAll("_", "-")}.schema.json`;
}

function schemaRef(actionType) {
	return { $ref: `${publicSchemaRoot}/nodes/${getNodeSchemaFileName(actionType)}` };
}

function assertGeneratedFile(filePath, expected) {
	assert.ok(existsSync(filePath), `${filePath} is missing. Run pnpm schemas:generate.`);
	const actual = readFileSync(filePath, "utf8");
	const generated = toJson(expected);
	assert.equal(actual, generated, `${filePath} is stale. Run pnpm schemas:generate.`);
}

function writeJson(filePath, value) {
	writeFileSync(filePath, toJson(value));
}

function toJson(value) {
	return `${JSON.stringify(value, null, "\t")}\n`;
}
