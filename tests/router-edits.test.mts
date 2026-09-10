import assert from "node:assert/strict";
import { test } from "node:test";
import type { RouterConfig } from "../data/nodes/router.ts";
import {
	addRouterPort,
	moveRouterPort,
	moveRouterRoute,
	normalizeRouterRouteOrders,
	removeRouterPort,
	removeRouterRoute,
	renameRouterPort,
	routerConfigToJson,
	toggleRouterRoute,
} from "../data/nodes/router-edits.ts";

function config(): RouterConfig {
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

test("addRouterPort appends a labelled port without touching routes", () => {
	const before = config();
	const after = addRouterPort(before, "inputs");
	assert.equal(after.inputs.length, 3);
	assert.equal(after.inputs[2].label, "Input 3");
	assert.ok(after.inputs[2].id.length > 0);
	assert.deepEqual(after.routes, before.routes);
	assert.equal(before.inputs.length, 2, "input must not be mutated");
	assert.equal(addRouterPort(before, "outputs").outputs[2].label, "Output 3");
});

test("renameRouterPort changes only the label", () => {
	const after = renameRouterPort(config(), "outputs", "y", "Why");
	assert.deepEqual(after.outputs, [
		{ id: "x", label: "X" },
		{ id: "y", label: "Why" },
	]);
});

test("moveRouterPort swaps neighbours and ignores out-of-range moves", () => {
	assert.deepEqual(
		moveRouterPort(config(), "inputs", "b", -1).inputs.map((port) => port.id),
		["b", "a"],
	);
	assert.deepEqual(
		moveRouterPort(config(), "inputs", "a", -1).inputs.map((port) => port.id),
		["a", "b"],
	);
	assert.deepEqual(
		moveRouterPort(config(), "outputs", "x", 1).outputs.map((port) => port.id),
		["y", "x"],
	);
});

test("removeRouterPort drops the port and its routes and renumbers the rest", () => {
	const after = removeRouterPort(config(), "outputs", "x");
	assert.deepEqual(after.outputs, [{ id: "y", label: "Y" }]);
	assert.deepEqual(after.routes, [
		{ id: "r2", inputId: "a", outputId: "y", order: 0 },
		{ id: "r3", inputId: "b", outputId: "y", order: 0 },
	]);
	const withoutInput = removeRouterPort(config(), "inputs", "a");
	assert.deepEqual(withoutInput.routes, [{ id: "r3", inputId: "b", outputId: "y", order: 0 }]);
});

test("toggleRouterRoute adds at the end of the input's order and removes with renumbering", () => {
	const added = toggleRouterRoute(config(), "b", "x");
	const newRoute = added.routes.find((route) => route.inputId === "b" && route.outputId === "x");
	assert.ok(newRoute);
	assert.equal(newRoute.order, 1);
	assert.equal(added.routes.length, 4);

	const removed = toggleRouterRoute(config(), "a", "x");
	assert.deepEqual(removed.routes, [
		{ id: "r2", inputId: "a", outputId: "y", order: 0 },
		{ id: "r3", inputId: "b", outputId: "y", order: 0 },
	]);
});

test("moveRouterRoute swaps order with the neighbour on the same input only", () => {
	const after = moveRouterRoute(config(), "r2", -1);
	assert.equal(after.routes.find((route) => route.id === "r2")?.order, 0);
	assert.equal(after.routes.find((route) => route.id === "r1")?.order, 1);
	assert.equal(after.routes.find((route) => route.id === "r3")?.order, 0);
	assert.deepEqual(moveRouterRoute(config(), "r3", 1), config(), "single route cannot move");
	assert.deepEqual(moveRouterRoute(config(), "missing", 1), config());
});

test("removeRouterRoute renumbers the remaining routes of that input", () => {
	const after = removeRouterRoute(config(), "r1");
	assert.deepEqual(after.routes, [
		{ id: "r2", inputId: "a", outputId: "y", order: 0 },
		{ id: "r3", inputId: "b", outputId: "y", order: 0 },
	]);
});

test("normalizeRouterRouteOrders makes orders consecutive per input while keeping relative order", () => {
	const messy = config();
	messy.routes = [
		{ id: "r2", inputId: "a", outputId: "y", order: 7 },
		{ id: "r3", inputId: "b", outputId: "y", order: 3 },
		{ id: "r1", inputId: "a", outputId: "x", order: 2 },
	];
	const after = normalizeRouterRouteOrders(messy);
	assert.equal(after.routes.find((route) => route.id === "r1")?.order, 0);
	assert.equal(after.routes.find((route) => route.id === "r2")?.order, 1);
	assert.equal(after.routes.find((route) => route.id === "r3")?.order, 0);
});

test("routerConfigToJson exposes the three config keys", () => {
	const json = routerConfigToJson(config());
	assert.deepEqual(Object.keys(json).sort(), ["inputs", "outputs", "routes"]);
	assert.deepEqual(json.routes, config().routes);
});
