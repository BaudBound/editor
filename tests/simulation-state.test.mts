import assert from "node:assert/strict";
import { test } from "node:test";
import type { Edge, Node } from "@xyflow/react";
import type { DeclaredVariable, ProjectSettings, ScriptNodeData } from "../lib/types.ts";
import { createSimulationRun } from "../utils/simulation.ts";

const projectSettings: ProjectSettings = {
	author: "",
	description: "",
	minimumRunnerVersion: "2.0.0",
	name: "Simulation State Test",
	repositoryUrl: "",
	source: "",
	tags: [],
	targetRuntimes: ["Windows Desktop"],
	version: "1.0.0",
	website: "",
};

test("global variable simulation initializes once then retains changes", async () => {
	const declaredVariables: DeclaredVariable[] = [
		{
			description: "",
			name: "counter",
			scope: "global",
			type: "integer",
			value: 10,
		},
	];
	const first = await createSimulationRun({
		assets: [],
		declaredVariables,
		edges: graphEdges(),
		httpSimulation: { authorizedOrigins: [], mode: "mock" },
		identity: { createdAt: "2026-08-16T00:00:00.000Z", id: "project-1" },
		nodes: graphNodes(),
		overrides: [],
		projectSettings,
	});
	const second = await createSimulationRun({
		assets: [],
		declaredVariables,
		edges: graphEdges(),
		globalVariables: first.globalVariables,
		httpSimulation: { authorizedOrigins: [], mode: "mock" },
		identity: { createdAt: "2026-08-16T00:00:00.000Z", id: "project-1" },
		nodes: graphNodes(),
		overrides: [],
		projectSettings,
	});

	assert.equal(first.globalVariables.counter, 11);
	assert.equal(second.globalVariables.counter, 12);
});

test("simulation steps expose raw stored global updates before the run finishes", async () => {
	const declaredVariables: DeclaredVariable[] = [
		{
			description: "",
			name: "enabled",
			scope: "global",
			type: "boolean",
			value: false,
		},
	];
	const streamedEnabledValues: unknown[] = [];

	await createSimulationRun({
		assets: [],
		declaredVariables,
		edges: graphEdges(),
		httpSimulation: { authorizedOrigins: [], mode: "mock" },
		identity: { createdAt: "2026-08-16T00:00:00.000Z", id: "project-1" },
		nodes: graphNodes({
			config: {
				name: "enabled",
				operation: "set",
				value: "true",
			},
		}),
		onStep: (step) => {
			streamedEnabledValues.push(step.storedVariables.global.enabled);
			return undefined;
		},
		overrides: [],
		projectSettings,
	});

	assert.ok(streamedEnabledValues.includes(true), "stored global value should be streamed before completion");
});

function graphNodes(options: { config?: Record<string, string> } = {}): Node<ScriptNodeData>[] {
	return [
		{
			id: "n-trigger",
			position: { x: 0, y: 0 },
			type: "scriptNode",
			data: {
				actionType: "trigger.manual",
				config: {},
				inputs: [],
				kind: "trigger",
				label: "Manual Trigger",
				outputs: [{ id: "out", label: "Out" }],
				risk: "low",
				runtimeOutputs: [],
			},
		},
		{
			id: "n-variable",
			position: { x: 320, y: 0 },
			type: "scriptNode",
			data: {
				actionType: "runtime.set_variable",
				config: options.config ?? {
					name: "counter",
					operation: "increment",
					value: "1",
				},
				inputs: [{ id: "input", label: "Input" }],
				kind: "action",
				label: "Variable Operation",
				outputs: [
					{ id: "success", label: "Success" },
					{ id: "failed", label: "Failed" },
				],
				risk: "low",
				runtimeOutputs: [],
			},
		},
	];
}

function graphEdges(): Edge[] {
	return [
		{
			id: "edge-1",
			data: { executionOrder: 0 },
			source: "n-trigger",
			sourceHandle: "out",
			target: "n-variable",
			targetHandle: "input",
		},
	];
}
