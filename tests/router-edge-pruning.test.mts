import assert from "node:assert/strict";
import { test } from "node:test";
import type { Edge } from "@xyflow/react";
import type { NodePort } from "../lib/types.ts";
import { getEdgeExecutionOrder, pruneEdgesForNodePorts } from "../utils/editor-graph.ts";

function edge(
	id: string,
	source: string,
	sourceHandle: string,
	target: string,
	targetHandle: string,
	order: number,
): Edge {
	return { id, data: { executionOrder: order }, source, sourceHandle, target, targetHandle };
}

function port(id: string): NodePort {
	return { id, label: id };
}

test("an edge targeting a dropped input is removed while an edge targeting a surviving input remains", () => {
	const edges = [
		edge("e-a", "n-other", "out", "n-router", "in-a", 0),
		edge("e-b", "n-other", "out", "n-router", "in-b", 0),
	];
	const result = pruneEdgesForNodePorts(edges, "n-router", {
		inputs: [port("in-a")],
		outputs: [port("out-x")],
	});
	assert.deepEqual(
		result.map((item) => item.id),
		["e-a"],
	);
});

test("an edge from a dropped output is removed", () => {
	const edges = [
		edge("e-x", "n-router", "out-x", "n-log", "input", 0),
		edge("e-y", "n-router", "out-y", "n-log2", "input", 0),
	];
	const result = pruneEdgesForNodePorts(edges, "n-router", {
		inputs: [port("in-a")],
		outputs: [port("out-y")],
	});
	assert.deepEqual(
		result.map((item) => item.id),
		["e-y"],
	);
});

test("edges unrelated to the node are untouched", () => {
	const edges = [
		edge("e-unrelated", "n-a", "out", "n-b", "input", 0),
		edge("e-into-router", "n-a", "out", "n-router", "in-missing", 0),
	];
	const result = pruneEdgesForNodePorts(edges, "n-router", {
		inputs: [port("in-a")],
		outputs: [port("out-x")],
	});
	assert.deepEqual(
		result.map((item) => item.id),
		["e-unrelated"],
	);
});

test("execution orders are renormalized after pruning", () => {
	const edges = [
		edge("e-first", "n-source", "out", "n-a", "input", 0),
		edge("e-dropped", "n-source", "out", "n-router", "in-missing", 1),
		edge("e-last", "n-source", "out", "n-b", "input", 2),
	];
	const result = pruneEdgesForNodePorts(edges, "n-router", {
		inputs: [port("in-a")],
		outputs: [port("out-x")],
	});
	assert.deepEqual(
		result.map((item) => item.id),
		["e-first", "e-last"],
	);
	const first = result.find((item) => item.id === "e-first");
	const last = result.find((item) => item.id === "e-last");
	assert.ok(first);
	assert.ok(last);
	assert.equal(getEdgeExecutionOrder(first), 0);
	assert.equal(getEdgeExecutionOrder(last), 1);
});
