import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	createDefaultNodeConfig,
	getNodeCapabilities,
	getNodeDefinition,
	getNodePorts,
	hasDynamicPorts,
	validateNodeConfig,
} from "../data/nodes/registry.ts";
import { getRouterConfigFromValue, isRouterPortColor, validateRouterConfig } from "../data/nodes/router.ts";
import { canonicalCapabilities } from "../utils/package-contract.ts";

const appRoot = fileURLToPath(new URL("..", import.meta.url));

test("router node is registered as a low-risk control node", () => {
	const definition = getNodeDefinition("control.router");
	assert.ok(definition);
	assert.equal(definition.kind, "control");
	assert.equal(definition.group, "control");
	assert.equal(definition.controlType, "router");
	assert.equal(definition.risk, "low");
	assert.deepEqual(getNodeCapabilities("control.router"), ["runtime.router"]);
	assert.ok(canonicalCapabilities.includes("runtime.router"));
	assert.equal(definition.summarizeConfig?.(createDefaultNodeConfig("control.router")), "1 in - 1 out - 1 route");
});

test("router default config is valid and routes its single input to its single output", () => {
	const config = createDefaultNodeConfig("control.router");
	assert.deepEqual(validateRouterConfig(config), []);
	assert.deepEqual(validateNodeConfig("control.router", config), []);
	assert.deepEqual(config, {
		inputs: [{ id: "input", label: "Input 1" }],
		outputs: [{ id: "output", label: "Output 1" }],
		routes: [{ id: "route", inputId: "input", outputId: "output", order: 0 }],
	});
});

test("router ports derive from config and are marked dynamic", () => {
	assert.equal(hasDynamicPorts("control.router"), true);
	assert.equal(hasDynamicPorts("control.switch"), true);
	assert.equal(hasDynamicPorts("action.log"), false);
	const ports = getNodePorts("control.router", {
		inputs: [
			{ id: "a", label: "alpha" },
			{ id: "b", label: "beta" },
		],
		outputs: [{ id: "x", label: "x-ray" }],
		routes: [],
	});
	assert.deepEqual(
		ports.inputs.map((port) => port.id),
		["in-a", "in-b"],
	);
	assert.deepEqual(
		ports.outputs.map((port) => port.id),
		["out-x"],
	);
	assert.equal(ports.inputs[0].label, "Alpha");
});

test("router port colors are optional #RRGGBB values that reach the node ports", () => {
	assert.equal(isRouterPortColor("#E62D3E"), true);
	assert.equal(isRouterPortColor("#e62d3e"), true);
	assert.equal(isRouterPortColor("#FFF"), false);
	assert.equal(isRouterPortColor("red"), false);
	assert.equal(isRouterPortColor(""), false);

	const config = {
		inputs: [
			{ id: "a", label: "A", color: "#e62d3e" },
			{ id: "b", label: "B", color: "nope" },
		],
		outputs: [{ id: "x", label: "X" }],
		routes: [
			{ id: "r1", inputId: "a", outputId: "x", order: 0 },
			{ id: "r2", inputId: "b", outputId: "x", order: 0 },
		],
	};
	const parsed = getRouterConfigFromValue(config);
	assert.equal(parsed.inputs[0].color, "#E62D3E", "colors are normalised to upper case on read");
	assert.equal(parsed.inputs[1].color, undefined, "an invalid color is dropped by the lenient read");
	assert.equal(parsed.outputs[0].color, undefined);
	assert.deepEqual(validateRouterConfig(config), ['input 2: color must be a hex color like "#RRGGBB".']);

	const ports = getNodePorts("control.router", config);
	assert.equal(ports.inputs[0].color, "#E62D3E");
	assert.equal(ports.inputs[1].color, undefined);
	assert.equal(ports.outputs[0].color, undefined);
});

test("router validation errors flow through validateNodeConfig", () => {
	const errors = validateNodeConfig("control.router", {
		inputs: [{ id: "a", label: "A" }],
		outputs: [{ id: "x", label: "X" }],
		routes: [],
	});
	assert.ok(errors.includes('input "A" has no routes.'), errors.join("\n"));
	assert.ok(errors.includes('output "X" has no incoming routes.'), errors.join("\n"));
	assert.equal(
		validateNodeConfig("control.router", { inputs: [], outputs: [], routes: [], bogus: 1 })[0],
		"must define at least one input.",
		"unknown keys are stripped by sanitizeNodeConfig before validation; the semantic error must still surface",
	);
});

test("generated router contracts are present and strict", () => {
	const schema = JSON.parse(readFileSync(join(appRoot, "contracts", "nodes", "control-router.schema.json"), "utf8"));
	assert.equal(schema.properties.action_type.const, "control.router");
	assert.equal(schema.properties.type.const, "router");
	assert.deepEqual(schema.$defs.config.required, ["inputs", "outputs", "routes"]);
	assert.equal(schema.$defs.config.additionalProperties, false);
	assert.equal(schema.$defs.config.properties.routes.items.properties.order.type, "integer");
	for (const side of ["inputs", "outputs"]) {
		const port = schema.$defs.config.properties[side].items;
		assert.deepEqual(port.required, ["id", "label"], "color stays optional");
		assert.equal(port.properties.color.type, "string");
		assert.equal(port.properties.color.pattern, "^#[0-9A-Fa-f]{6}$");
	}

	const ports = JSON.parse(readFileSync(join(appRoot, "contracts", "runner", "node-ports.json"), "utf8"));
	assert.deepEqual(ports.nodes["control.router"], {
		kind: "router_ports",
		inputs_key: "inputs",
		outputs_key: "outputs",
		input_prefix: "in-",
		output_prefix: "out-",
	});

	const capabilities = JSON.parse(readFileSync(join(appRoot, "contracts", "runner", "node-capabilities.json"), "utf8"));
	assert.deepEqual(capabilities.nodes["control.router"], ["runtime.router"]);

	const program = JSON.parse(readFileSync(join(appRoot, "contracts", "program.schema.json"), "utf8"));
	assert.ok(program.$defs.actionType.enum.includes("control.router"));
	assert.ok(program.$defs.controlStepType.enum.includes("router"));

	const capabilitySchema = JSON.parse(readFileSync(join(appRoot, "contracts", "capabilities.schema.json"), "utf8"));
	assert.ok(capabilitySchema.properties.required_capabilities.items.enum.includes("runtime.router"));
	const repositorySchema = JSON.parse(readFileSync(join(appRoot, "contracts", "repository.schema.json"), "utf8"));
	assert.ok(repositorySchema.$defs.script.properties.capabilities.items.enum.includes("runtime.router"));
});
