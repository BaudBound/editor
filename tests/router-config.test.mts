import assert from "node:assert/strict";
import { test } from "node:test";
import {
	createRouterPortRow,
	createRouterPorts,
	createRouterRouteRow,
	getRouterConfigFromValue,
	getRouterRoutesForInput,
	routerInputHandle,
	routerInputIdFromHandle,
	routerOutputHandle,
	summarizeRouterConfig,
	validateRouterConfig,
} from "../data/nodes/router.ts";

function validConfig() {
	return {
		inputs: [
			{ id: "a", label: "Alpha" },
			{ id: "b", label: "Beta" },
		],
		outputs: [
			{ id: "x", label: "X" },
			{ id: "y", label: "Y" },
		],
		routes: [
			{ id: "r1", inputId: "a", outputId: "x", order: 0 },
			{ id: "r2", inputId: "a", outputId: "y", order: 1 },
			{ id: "r3", inputId: "b", outputId: "y", order: 0 },
		],
	};
}

test("router handles derive from port ids and parse back", () => {
	assert.equal(routerInputHandle("abc"), "in-abc");
	assert.equal(routerOutputHandle("abc"), "out-abc");
	assert.equal(routerInputIdFromHandle("in-abc"), "abc");
	assert.equal(routerInputIdFromHandle("out-abc"), null);
	assert.equal(routerInputIdFromHandle("in-"), null);
	assert.equal(routerInputIdFromHandle("input"), null);
});

test("router rows get random ids unless one is supplied", () => {
	const port = createRouterPortRow("Input 1");
	assert.equal(port.label, "Input 1");
	assert.ok(port.id.length > 0);
	assert.equal(createRouterPortRow("X", "fixed").id, "fixed");
	const route = createRouterRouteRow("a", "x", 2);
	assert.deepEqual(
		{ inputId: route.inputId, outputId: route.outputId, order: route.order },
		{ inputId: "a", outputId: "x", order: 2 },
	);
	assert.equal(createRouterRouteRow("a", "x", 0, "r").id, "r");
});

test("getRouterConfigFromValue drops malformed rows and tolerates missing keys", () => {
	const config = getRouterConfigFromValue({
		inputs: [{ id: "a", label: "A" }, { id: 5 }, "junk"],
		routes: [{ id: "r", inputId: "a", outputId: "x", order: 0 }, { id: "bad" }],
	});
	assert.deepEqual(config.inputs, [{ id: "a", label: "A" }]);
	assert.deepEqual(config.outputs, []);
	assert.deepEqual(config.routes, [{ id: "r", inputId: "a", outputId: "x", order: 0 }]);
});

test("createRouterPorts derives handles and falls back to positional labels", () => {
	const ports = createRouterPorts({
		inputs: [
			{ id: "a", label: "Alpha" },
			{ id: "b", label: "   " },
		],
		outputs: [{ id: "x", label: "" }],
		routes: [],
	});
	assert.deepEqual(ports.inputs, [
		{ id: "in-a", label: "Alpha" },
		{ id: "in-b", label: "input 2" },
	]);
	assert.deepEqual(ports.outputs, [{ id: "out-x", label: "output 1" }]);
});

test("getRouterRoutesForInput returns only that input's routes in order", () => {
	const config = validConfig();
	config.routes = [config.routes[1], config.routes[2], config.routes[0]];
	assert.deepEqual(
		getRouterRoutesForInput(config, "a").map((route) => route.id),
		["r1", "r2"],
	);
});

test("validateRouterConfig accepts a valid config", () => {
	assert.deepEqual(validateRouterConfig(validConfig()), []);
});

test("validateRouterConfig rejects non-array sections and empty port lists", () => {
	assert.deepEqual(validateRouterConfig({ inputs: "x", outputs: 5, routes: {} }), [
		"must define inputs as a list.",
		"must define outputs as a list.",
		"must define routes as a list.",
	]);
	assert.deepEqual(validateRouterConfig({ inputs: [], outputs: [], routes: [] }), [
		"must define at least one input.",
		"must define at least one output.",
	]);
});

test("validateRouterConfig rejects malformed rows, blank labels, and duplicate ids", () => {
	const errors = validateRouterConfig({
		inputs: [{ id: "a", label: "A" }, { id: "a", label: " " }, { id: "" }],
		outputs: [
			{ id: "x", label: "X" },
			{ id: "x", label: "X2" },
		],
		routes: [
			{ id: "r", inputId: "a", outputId: "x", order: 0 },
			{ id: "r", inputId: "a", outputId: "x", order: 1 },
		],
	});
	assert.ok(errors.includes("contains an invalid input row."), errors.join("\n"));
	assert.ok(errors.includes("input 2: label is required."), errors.join("\n"));
	assert.ok(errors.includes("contains duplicate input identifiers."), errors.join("\n"));
	assert.ok(errors.includes("contains duplicate output identifiers."), errors.join("\n"));
	assert.ok(errors.includes("contains duplicate route identifiers."), errors.join("\n"));
	assert.ok(errors.includes("contains duplicate routes between the same input and output."), errors.join("\n"));
});

test("validateRouterConfig rejects routes that reference missing ports", () => {
	const config = validConfig();
	config.routes.push({ id: "r4", inputId: "zzz", outputId: "x", order: 0 });
	config.routes.push({ id: "r5", inputId: "a", outputId: "zzz", order: 2 });
	const errors = validateRouterConfig(config);
	assert.ok(errors.includes("route 4 references a missing input."), errors.join("\n"));
	assert.ok(errors.includes("route 5 references a missing output."), errors.join("\n"));
});

test("validateRouterConfig rejects inputs and outputs with no routes", () => {
	const config = validConfig();
	config.inputs.push({ id: "c", label: "Gamma" });
	config.outputs.push({ id: "z", label: "Z" });
	const errors = validateRouterConfig(config);
	assert.ok(errors.includes('input "Gamma" has no routes.'), errors.join("\n"));
	assert.ok(errors.includes('output "Z" has no incoming routes.'), errors.join("\n"));
});

test("validateRouterConfig rejects route orders that are not consecutive from zero", () => {
	const config = validConfig();
	config.routes[1].order = 2;
	assert.ok(
		validateRouterConfig(config).includes('input "Alpha" route order must be unique and consecutive starting at 0.'),
	);
	const duplicate = validConfig();
	duplicate.routes[1].order = 0;
	assert.ok(
		validateRouterConfig(duplicate).includes('input "Alpha" route order must be unique and consecutive starting at 0.'),
	);
});

test("validateRouterConfig caps the number of ports", () => {
	const inputs = Array.from({ length: 65 }, (_, index) => ({ id: `i${index}`, label: `I${index}` }));
	const routes = inputs.map((input, index) => ({ id: `r${index}`, inputId: input.id, outputId: "x", order: 0 }));
	const errors = validateRouterConfig({ inputs, outputs: [{ id: "x", label: "X" }], routes });
	assert.ok(errors.includes("cannot define more than 64 inputs."), errors.join("\n"));
});

test("summarizeRouterConfig counts inputs, outputs, and routes", () => {
	assert.equal(summarizeRouterConfig(validConfig()), "2 in - 2 out - 3 routes");
	assert.equal(
		summarizeRouterConfig({
			inputs: [{ id: "a", label: "A" }],
			outputs: [{ id: "x", label: "X" }],
			routes: [{ id: "r", inputId: "a", outputId: "x", order: 0 }],
		}),
		"1 in - 1 out - 1 route",
	);
});
