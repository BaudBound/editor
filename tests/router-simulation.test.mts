import assert from "node:assert/strict";
import { test } from "node:test";
import type { Edge, Node } from "@xyflow/react";
import type { ProjectSettings, ScriptNodeData } from "../lib/types.ts";
import { createSimulationRun } from "../utils/simulation.ts";
import type { SimulationStep } from "../utils/simulation-types.ts";

const projectSettings: ProjectSettings = {
	author: "",
	description: "",
	minimumRunnerVersion: "2.0.0",
	name: "Router Simulation Test",
	repositoryUrl: "",
	source: "",
	tags: [],
	targetRuntimes: ["Windows Desktop"],
	version: "1.0.0",
	website: "",
};

const routerConfig = {
	inputs: [
		{ id: "a", label: "Alpha" },
		{ id: "b", label: "Beta" },
	],
	outputs: [
		{ id: "x", label: "X" },
		{ id: "y", label: "Y" },
	],
	routes: [
		{ id: "r1", inputId: "a", outputId: "y", order: 0 },
		{ id: "r2", inputId: "a", outputId: "x", order: 1 },
		{ id: "r3", inputId: "b", outputId: "x", order: 0 },
	],
};

async function run(triggerTargetHandle: string) {
	const steps: SimulationStep[] = [];
	await createSimulationRun({
		assets: [],
		declaredVariables: [],
		edges: edges(triggerTargetHandle),
		httpSimulation: { authorizedOrigins: [], mode: "mock" },
		identity: { createdAt: "2026-08-16T00:00:00.000Z", id: "project-1" },
		nodes: nodes(),
		onStep: (step) => {
			steps.push(step);
			return undefined;
		},
		overrides: [],
		projectSettings,
	});
	return steps;
}

function activatedNodeIds(steps: SimulationStep[]) {
	return steps.flatMap((step) => (step.nodeState?.status === "active" ? [step.nodeState.nodeId] : []));
}

test("router entered through input Alpha follows Y then X in route order", async () => {
	const steps = await run("in-a");
	assert.deepEqual(activatedNodeIds(steps), ["n-trigger", "n-router", "n-log-y", "n-log-x"]);
	assert.ok(
		steps.some((step) =>
			step.traces.some((trace) => trace.message.includes('Router n-router input "Alpha" selected 2 outputs')),
		),
	);
});

test("router entered through input Beta follows only X", async () => {
	const steps = await run("in-b");
	assert.deepEqual(activatedNodeIds(steps), ["n-trigger", "n-router", "n-log-x"]);
});

test("router entered through an unknown input fails the run with a clear message", async () => {
	const steps = await run("in-missing");
	assert.deepEqual(activatedNodeIds(steps), ["n-trigger", "n-router"]);
	assert.ok(
		steps.some((step) =>
			step.traces.some((trace) => trace.level === "error" && trace.message.includes('unknown input "in-missing"')),
		),
	);
});

test("router entered through an unknown input halts the whole run, not just its own branch", async () => {
	const steps: SimulationStep[] = [];
	await createSimulationRun({
		assets: [],
		declaredVariables: [],
		edges: unknownInputFanOutEdges(),
		httpSimulation: { authorizedOrigins: [], mode: "mock" },
		identity: { createdAt: "2026-08-16T00:00:00.000Z", id: "project-1" },
		nodes: unknownInputFanOutNodes(),
		onStep: (step) => {
			steps.push(step);
			return undefined;
		},
		overrides: [],
		projectSettings,
	});
	assert.deepEqual(activatedNodeIds(steps), ["n-trigger", "n-router"]);
	assert.ok(
		steps.some((step) =>
			step.traces.some((trace) => trace.level === "error" && trace.message.includes('unknown input "in-missing"')),
		),
	);
});

test("router input with zero routes halts the whole run and never activates a downstream node", async () => {
	const steps: SimulationStep[] = [];
	await createSimulationRun({
		assets: [],
		declaredVariables: [],
		edges: noRoutesEdges(),
		httpSimulation: { authorizedOrigins: [], mode: "mock" },
		identity: { createdAt: "2026-08-16T00:00:00.000Z", id: "project-1" },
		nodes: noRoutesNodes(),
		onStep: (step) => {
			steps.push(step);
			return undefined;
		},
		overrides: [],
		projectSettings,
	});
	assert.deepEqual(activatedNodeIds(steps), ["n-trigger", "n-router"]);
	assert.ok(
		steps.some((step) =>
			step.traces.some((trace) => trace.level === "error" && trace.message.includes("has no routes")),
		),
	);
});

function unknownInputFanOutNodes(): Node<ScriptNodeData>[] {
	return [
		scriptNode("n-trigger", "trigger.manual", "trigger", {}, [], [{ id: "out", label: "Out" }]),
		scriptNode(
			"n-router",
			"control.router",
			"control",
			routerConfig,
			[
				{ id: "in-a", label: "Alpha" },
				{ id: "in-b", label: "Beta" },
			],
			[
				{ id: "out-x", label: "X" },
				{ id: "out-y", label: "Y" },
			],
		),
		scriptNode(
			"n-log",
			"action.log",
			"action",
			{ level: "info", message: "log" },
			[{ id: "input", label: "Input" }],
			[{ id: "out", label: "Out" }],
		),
	];
}

function unknownInputFanOutEdges(): Edge[] {
	return [
		edge("e-to-router", "n-trigger", "out", "n-router", "in-missing", 0),
		edge("e-to-log", "n-trigger", "out", "n-log", "input", 1),
	];
}

const routerConfigNoRoutesForB = {
	inputs: [
		{ id: "a", label: "Alpha" },
		{ id: "b", label: "Beta" },
	],
	outputs: [{ id: "x", label: "X" }],
	routes: [{ id: "r1", inputId: "a", outputId: "x", order: 0 }],
};

function noRoutesNodes(): Node<ScriptNodeData>[] {
	return [
		scriptNode("n-trigger", "trigger.manual", "trigger", {}, [], [{ id: "out", label: "Out" }]),
		scriptNode(
			"n-router",
			"control.router",
			"control",
			routerConfigNoRoutesForB,
			[
				{ id: "in-a", label: "Alpha" },
				{ id: "in-b", label: "Beta" },
			],
			[{ id: "out-x", label: "X" }],
		),
		scriptNode(
			"n-log-x",
			"action.log",
			"action",
			{ level: "info", message: "x" },
			[{ id: "input", label: "Input" }],
			[{ id: "out", label: "Out" }],
		),
	];
}

function noRoutesEdges(): Edge[] {
	return [
		edge("e-trigger", "n-trigger", "out", "n-router", "in-b", 0),
		edge("e-x", "n-router", "out-x", "n-log-x", "input", 0),
	];
}

function nodes(): Node<ScriptNodeData>[] {
	return [
		scriptNode("n-trigger", "trigger.manual", "trigger", {}, [], [{ id: "out", label: "Out" }]),
		scriptNode(
			"n-router",
			"control.router",
			"control",
			routerConfig,
			[
				{ id: "in-a", label: "Alpha" },
				{ id: "in-b", label: "Beta" },
			],
			[
				{ id: "out-x", label: "X" },
				{ id: "out-y", label: "Y" },
			],
		),
		scriptNode(
			"n-log-x",
			"action.log",
			"action",
			{ level: "info", message: "x" },
			[{ id: "input", label: "Input" }],
			[{ id: "out", label: "Out" }],
		),
		scriptNode(
			"n-log-y",
			"action.log",
			"action",
			{ level: "info", message: "y" },
			[{ id: "input", label: "Input" }],
			[{ id: "out", label: "Out" }],
		),
	];
}

function scriptNode(
	id: string,
	actionType: ScriptNodeData["actionType"],
	kind: ScriptNodeData["kind"],
	config: ScriptNodeData["config"],
	inputs: ScriptNodeData["inputs"],
	outputs: ScriptNodeData["outputs"],
): Node<ScriptNodeData> {
	return {
		id,
		position: { x: 0, y: 0 },
		type: "scriptNode",
		data: { actionType, config, inputs, kind, label: id, outputs, risk: "low", runtimeOutputs: [] },
	};
}

function edges(triggerTargetHandle: string): Edge[] {
	return [
		edge("e-trigger", "n-trigger", "out", "n-router", triggerTargetHandle),
		edge("e-x", "n-router", "out-x", "n-log-x", "input"),
		edge("e-y", "n-router", "out-y", "n-log-y", "input"),
	];
}

function edge(
	id: string,
	source: string,
	sourceHandle: string,
	target: string,
	targetHandle: string,
	executionOrder = 0,
): Edge {
	return { id, data: { executionOrder }, source, sourceHandle, target, targetHandle };
}
