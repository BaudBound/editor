import type { Edge, Node } from "@xyflow/react";
import { conditionValuesEqual, evaluateConditionValues } from "@/data/nodes/condition-comparison";
import { splitCast } from "@/data/nodes/config-field-validation";
import { isConditionRow, isSwitchCaseRow } from "@/data/nodes/definitions/rows";
import type { NodeSimulationApi } from "@/data/nodes/node-definition";
import { numericContractApplies, validateNumericConfigValue } from "@/data/nodes/numeric-validation";
import { fallibleActionTypes, getNodeDefinition } from "@/data/nodes/registry";
import {
	createSimulationBuiltInVariableValues,
	liveSystemFields,
	readLiveSystemField,
	SETTINGS_NAMESPACE,
	SYSTEM_NAMESPACE,
} from "@/data/project/built-in-variables";
import { componentFieldValue } from "@/data/project/derived-parts";
import { createSimulationScriptSettingValues } from "@/data/project/script-settings";
import type {
	JsonValue,
	LogEntry,
	ScriptNodeData,
	SimulationOverride,
	SimulationTraceEntry,
	SimulationVariableSnapshot,
} from "@/lib/types";
import { getEdgeExecutionOrder, getEdgeExecutionOrderErrors } from "@/utils/editor-graph";
import { createHttpActionError } from "@/utils/http-action-contract";
import { castSimulatedValue } from "@/utils/value-cast";
import type {
	NodeExecutionResult,
	SimulationContext,
	SimulationRun,
	SimulationRunOptions,
	SimulationSideEffect,
	SimulationSideEffectResult,
	SimulationStep,
} from "./simulation-types";

export type {
	SimulationRun,
	SimulationRunOptions,
	SimulationSideEffect,
	SimulationSideEffectResult,
	SimulationStep,
} from "./simulation-types";

const MAX_SIMULATION_MESSAGE_LENGTH = 4000;
const MAX_VARIABLE_SNAPSHOT_ENTRIES = 600;
const MAX_VARIABLE_SNAPSHOT_STRING_LENGTH = 4000;

/**
 * Raised when a simulated request is rejected before it leaves the browser.
 *
 * Carries the code that the run log reports, so an authorization refusal is
 * distinguishable from a transport failure.
 */
class SimulationHttpClientError extends Error {
	readonly code: string;

	constructor(message: string, code: string) {
		super(message);
		this.name = "SimulationHttpClientError";
		this.code = code;
	}
}

/**
 * Raised when a `{{reference|target}}` cast fails while resolving a template.
 *
 * Caught once, centrally, in processSimulationFrames, so it aborts the whole
 * simulated run instead of resolving to a node's failed output — matching the
 * runner, where the same cast failure is a fatal RuntimeError rather than a
 * structured action failure. Call sites that catch errors generically must
 * re-throw this one instead of swallowing it into an ordinary node failure.
 */
class SimulationCastError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SimulationCastError";
	}
}

type SimulationFrame =
	| {
			edgeId: string;
			kind: "edge";
			handle: string;
			sourceNodeId: string;
			stopAtNodeId?: string;
			targetNodeId: string;
	  }
	| {
			kind: "follow";
			handle: string;
			sourceNodeId: string;
			stopAtNodeId?: string;
	  }
	| {
			kind: "for_each";
			index: number;
			items: JsonValue[];
			nodeId: string;
	  }
	| {
			kind: "repeat";
			count: bigint;
			index: bigint;
			nodeId: string;
	  }
	| {
			kind: "node";
			nodeId: string;
			stopAtNodeId?: string;
	  }
	| {
			index: number;
			kind: "while";
			nodeId: string;
	  };

const nodeSimulationApi: NodeSimulationApi = {
	createError,
	createPixelColorOutput: createSimulatedPixelColorOutput,
	executeHttpRequest: executeHttpRequestNode,
	formatValue,
	getConfigString,
	parseJsonValue,
	resolveJsonCompatibleInput,
	resolveTemplate,
	validatePlaySound: validatePlaySoundNode,
};

export async function createSimulationRun({
	assets,
	declaredVariables = [],
	edges,
	globalVariables = {},
	httpSimulation,
	nodes,
	onStep,
	overrides,
	persistentVariables = {},
	projectSettings,
	scriptSettings = [],
	secretValues = {},
	signal,
	stepDelayMs = 0,
	triggerNodeId,
	triggerPayload = {},
}: SimulationRunOptions): Promise<SimulationRun> {
	const trigger = getSimulationTrigger(nodes, triggerNodeId);
	const context: SimulationContext = {
		assetsByPackagePath: new Map(assets.map((asset) => [asset.packagePath.toLowerCase(), asset])),
		edgesBySource: groupEdgesBySource(edges),
		failed: false,
		globalVariables: structuredClone(globalVariables),
		halted: false,
		declaredVariables: Object.fromEntries(
			declaredVariables.map((variable) => [
				variable.name,
				{ scope: variable.scope, type: variable.type, itemType: variable.itemType, value: variable.value },
			]),
		),
		liveReadAt: null,
		httpSimulation: {
			authorizedOrigins: new Set(httpSimulation.authorizedOrigins),
			mode: httpSimulation.mode,
		},
		nodeOutputs: {},
		nodesById: new Map(nodes.map((node) => [node.id, node])),
		onStep,
		overridesByNodeId: new Map(overrides.map((override) => [override.nodeId, override.outcome])),
		persistentVariables: {
			...Object.fromEntries(
				declaredVariables
					.filter((variable) => variable.scope === "persistent")
					.map((variable) => [variable.name, structuredClone(variable.value)]),
			),
			...structuredClone(persistentVariables),
		},
		runtimeVariables: {
			...createSimulationBuiltInVariableValues(projectSettings),
			[SETTINGS_NAMESPACE]: createSimulationScriptSettingValues(scriptSettings),
			...Object.fromEntries(
				declaredVariables
					.filter((variable) => variable.scope === "runtime")
					.map((variable) => [variable.name, structuredClone(variable.value)]),
			),
			...secretValues,
		},
		secretNames: new Set(Object.keys(secretValues)),
		secretValues: Object.values(secretValues),
		signal,
		stepDelayMs,
		triggerPayload,
		webhookResponse: null,
	};
	const executionOrderErrors = getEdgeExecutionOrderErrors(edges);
	if (executionOrderErrors.length > 0) {
		await pushStep(context, {
			level: "error",
			message: `[Simulation] Invalid connection execution order: ${executionOrderErrors.join(" ")}`,
		});
		return createSimulationRunResult(context, "failed");
	}

	if (!trigger) {
		await pushStep(context, {
			level: "error",
			message: "[Simulation] No trigger node exists, so the script cannot be simulated.",
		});
		return createSimulationRunResult(context, "failed");
	}

	await pushStep(context, {
		level: "info",
		message: `[Simulation] Starting from ${trigger.data.label} (${trigger.id}).`,
	});
	await processSimulationFrames(context, [{ kind: "node", nodeId: trigger.id }]);
	if (context.signal?.aborted) {
		await pushStep(context, {
			level: "warn",
			message: "[Simulation] Simulation stopped by user.",
		});
		return createSimulationRunResult(context, "failed");
	}
	await pushStep(context, {
		level: context.failed ? "error" : "info",
		message: context.failed ? "[Simulation] Simulation finished with errors." : "[Simulation] Simulation completed.",
	});

	return createSimulationRunResult(context, context.failed ? "failed" : "completed");
}

function createSimulationRunResult(context: SimulationContext, status: SimulationRun["status"]): SimulationRun {
	return {
		finalVariables: createVariableSnapshot(context),
		globalVariables: structuredClone(context.globalVariables),
		persistentVariables: structuredClone(context.persistentVariables),
		status,
	};
}

function getSimulationTrigger(nodes: Node<ScriptNodeData>[], triggerNodeId: string | undefined) {
	const triggers = sortNodesForExecution(nodes).filter((node) => node.data.kind === "trigger");
	if (triggerNodeId) {
		const selectedTrigger = triggers.find((node) => node.id === triggerNodeId);
		if (selectedTrigger) {
			return selectedTrigger;
		}
	}

	return triggers[0] ?? null;
}

async function processSimulationFrames(context: SimulationContext, initialFrames: SimulationFrame[]) {
	const frames = [...initialFrames];

	while (frames.length > 0) {
		if (context.halted || context.signal?.aborted) {
			return;
		}

		const frame = frames.pop();
		if (!frame) {
			continue;
		}

		try {
			await processSimulationFrame(context, frame, frames);
		} catch (error) {
			if (!(error instanceof SimulationCastError)) {
				throw error;
			}
			// A failed cast stops the whole run, matching the runner: there the
			// same failure is a fatal RuntimeError rather than a structured
			// action failure, so it is never routed to a node's failed output.
			context.failed = true;
			context.halted = true;
			await pushStep(context, {
				level: "error",
				message: `[Simulation] ${error.message}`,
			});
			return;
		}
	}
}

async function processSimulationFrame(context: SimulationContext, frame: SimulationFrame, frames: SimulationFrame[]) {
	if (frame.kind === "node") {
		await executeNodeFrame(frame.nodeId, context, frames, frame.stopAtNodeId);
		return;
	}

	if (frame.kind === "follow") {
		await enqueueFollowFrames(context, frames, frame.sourceNodeId, frame.handle, frame.stopAtNodeId);
		return;
	}

	if (frame.kind === "edge") {
		await pushStep(
			context,
			{
				level: "debug",
				message: `[Simulation] Following "${frame.handle}" from ${frame.sourceNodeId} to ${frame.targetNodeId}.`,
			},
			[],
			[frame.edgeId],
		);
		frames.push({ kind: "node", nodeId: frame.targetNodeId, stopAtNodeId: frame.stopAtNodeId });
		return;
	}

	if (frame.kind === "repeat") {
		await processRepeatFrame(context, frames, frame);
		return;
	}

	if (frame.kind === "while") {
		await processWhileFrame(context, frames, frame);
		return;
	}

	await processForEachFrame(context, frames, frame);
}

async function executeNodeFrame(
	nodeId: string,
	context: SimulationContext,
	frames: SimulationFrame[],
	stopAtNodeId?: string,
) {
	if (context.halted || context.signal?.aborted) {
		return;
	}

	if (nodeId === stopAtNodeId) {
		return;
	}

	// One clock reading per node execution: every reference inside this node
	// agrees, and the next node reads again. Cleared on the way in rather than
	// out, so a node that throws cannot leave a stale reading behind.
	context.liveReadAt = null;

	const node = context.nodesById.get(nodeId);
	if (!node) {
		await pushStep(context, {
			level: "error",
			message: `[Simulation] Missing target node ${nodeId}; branch stopped.`,
		});
		return;
	}

	await pushNodeState(context, node.id, "active");
	if (context.signal?.aborted) {
		return;
	}

	try {
		await executeResolvedNodeFrame(node, context, frames);
	} finally {
		if (!context.signal?.aborted) {
			await pushNodeState(context, node.id, "completed");
		}
	}
}

async function executeResolvedNodeFrame(
	node: Node<ScriptNodeData>,
	context: SimulationContext,
	frames: SimulationFrame[],
) {
	if (node.data.actionType === "control.break_loop" || node.data.actionType === "control.continue_loop") {
		await processLoopControlNode(node, context, frames);
		return;
	}

	const override = context.overridesByNodeId.get(node.id);
	const forcedFailed = override === "failed";
	const numericError = validateResolvedNumericNode(node, context);
	if (numericError) {
		context.failed = true;
		await pushStep(context, {
			level: "error",
			message: `[Simulation] ${node.data.label} (${node.id}) failed validation: ${numericError}`,
		});
		return;
	}
	const result = await createNodeOutputData(node, context, forcedFailed);
	if (context.signal?.aborted) {
		return;
	}

	const failed = result.failed;
	const outcome = failed ? "failed" : "success";
	if (Object.keys(result.outputData).length > 0) {
		context.nodeOutputs[node.id] = result.outputData;
	}

	const sideEffects = failed ? [] : createNodeSideEffects(node, context);
	let sideEffectResults: SimulationSideEffectResult[] = [];

	if (node.data.actionType === "action.delay" && !failed) {
		await simulateDelayNode(node, context);
	} else {
		for (const [index, trace] of describeNodeExecution(node, context, failed, override).entries()) {
			const results = await pushStep(context, trace, index === 0 ? sideEffects : []);
			if (index === 0 && results.length > 0) {
				sideEffectResults = results;
			}
		}
	}

	const afterExecuteTraces =
		(await getNodeDefinition(node.data.actionType)?.simulation?.afterExecute?.({
			api: nodeSimulationApi,
			context,
			failed,
			node,
			sideEffectResults,
		})) ?? [];

	for (const trace of afterExecuteTraces) {
		await pushStep(context, trace);
	}

	const outputLogs =
		getNodeDefinition(node.data.actionType)?.simulation?.outputLogs?.({
			api: nodeSimulationApi,
			context,
			failed,
			node,
		}) ?? [];

	for (const log of outputLogs) {
		await pushOutputLog(context, log);
	}

	if (node.data.actionType === "control.repeat") {
		const count = normalizeIterationCount(resolveTemplate(getConfigString(node, "count"), context));
		frames.push({ kind: "repeat", nodeId: node.id, index: BigInt(0), count });
		return;
	}

	if (node.data.actionType === "control.while") {
		frames.push({ kind: "while", nodeId: node.id, index: 0 });
		return;
	}

	if (node.data.actionType === "control.for_each") {
		const items = getForEachItems(node, context);
		if (typeof items === "string") {
			context.failed = true;
			await pushStep(context, {
				level: "error",
				message: `[Simulation] For Each (${node.id}) failed: ${items}.`,
			});
			return;
		}
		frames.push({ kind: "for_each", nodeId: node.id, index: 0, items });
		return;
	}

	let handle: string;
	try {
		handle = await determineOutputHandle(node, context, outcome);
	} catch (error) {
		if (error instanceof SimulationCastError) {
			throw error;
		}
		context.failed = true;
		await pushStep(context, {
			level: "error",
			message: `[Simulation] ${node.data.label} (${node.id}) failed: ${
				error instanceof Error ? error.message : "condition evaluation failed"
			}.`,
		});
		return;
	}
	if (!handle) {
		await pushStep(context, {
			level: "warn",
			message: `[Simulation] ${node.data.label} (${node.id}) did not select an output branch.`,
		});
		return;
	}

	frames.push({ kind: "follow", sourceNodeId: node.id, handle });
}

async function processRepeatFrame(
	context: SimulationContext,
	frames: SimulationFrame[],
	frame: Extract<SimulationFrame, { kind: "repeat" }>,
) {
	const node = context.nodesById.get(frame.nodeId);
	if (!node) {
		await pushStep(context, {
			level: "error",
			message: `[Simulation] Missing Repeat node ${frame.nodeId}; branch stopped.`,
		});
		return;
	}

	if (frame.index >= frame.count) {
		frames.push({ kind: "follow", sourceNodeId: node.id, handle: "done" });
		return;
	}

	await pushStep(context, {
		level: "info",
		message: `[Simulation] Repeat ${node.id} iteration ${frame.index + BigInt(1)} of ${frame.count}.`,
	});
	frames.push({ kind: "repeat", nodeId: node.id, index: frame.index + BigInt(1), count: frame.count });
	frames.push({ kind: "follow", sourceNodeId: node.id, handle: "repeat", stopAtNodeId: node.id });
}

async function processLoopControlNode(
	node: Node<ScriptNodeData>,
	context: SimulationContext,
	frames: SimulationFrame[],
) {
	const loopFrameIndex = findActiveLoopFrameIndex(frames);
	if (loopFrameIndex === -1) {
		context.failed = true;
		await pushStep(context, {
			level: "error",
			message: `[Simulation] ${node.data.label} (${node.id}) is not inside an active loop.`,
		});
		return;
	}

	const loopFrame = frames[loopFrameIndex];
	if (!loopFrame || !isLoopFrame(loopFrame)) {
		return;
	}

	if (node.data.actionType === "control.break_loop") {
		frames.length = loopFrameIndex;
		frames.push({ kind: "follow", sourceNodeId: loopFrame.nodeId, handle: "done" });
		await pushStep(context, {
			level: "info",
			message: `[Simulation] Break Loop (${node.id}) exited loop ${loopFrame.nodeId}.`,
		});
		return;
	}

	frames.length = loopFrameIndex + 1;
	await pushStep(context, {
		level: "info",
		message: `[Simulation] Continue Loop (${node.id}) advanced loop ${loopFrame.nodeId}.`,
	});
}

function findActiveLoopFrameIndex(frames: SimulationFrame[]) {
	return frames.findLastIndex(isLoopFrame);
}

function isLoopFrame(
	frame: SimulationFrame,
): frame is Extract<SimulationFrame, { kind: "for_each" | "repeat" | "while" }> {
	return frame.kind === "repeat" || frame.kind === "while" || frame.kind === "for_each";
}

async function processWhileFrame(
	context: SimulationContext,
	frames: SimulationFrame[],
	frame: Extract<SimulationFrame, { kind: "while" }>,
) {
	const node = context.nodesById.get(frame.nodeId);
	if (!node) {
		await pushStep(context, {
			level: "error",
			message: `[Simulation] Missing while node ${frame.nodeId}; branch stopped.`,
		});
		return;
	}

	let conditionPassed: boolean;
	try {
		conditionPassed = await evaluateIfNode(node, context);
	} catch (error) {
		if (error instanceof SimulationCastError) {
			throw error;
		}
		context.failed = true;
		await pushStep(context, {
			level: "error",
			message: `[Simulation] While (${node.id}) failed: ${
				error instanceof Error ? error.message : "condition evaluation failed"
			}.`,
		});
		return;
	}
	if (!conditionPassed) {
		await pushStep(context, {
			level: "info",
			message: `[Simulation] While ${node.id} condition failed after ${frame.index} iteration${frame.index === 1 ? "" : "s"}.`,
		});
		frames.push({ kind: "follow", sourceNodeId: node.id, handle: "done" });
		return;
	}

	await pushStep(context, {
		level: "info",
		message: `[Simulation] While ${node.id} iteration ${frame.index + 1}; condition passed.`,
	});
	frames.push({ kind: "while", nodeId: node.id, index: frame.index + 1 });
	frames.push({ kind: "follow", sourceNodeId: node.id, handle: "loop", stopAtNodeId: node.id });
}

async function processForEachFrame(
	context: SimulationContext,
	frames: SimulationFrame[],
	frame: Extract<SimulationFrame, { kind: "for_each" }>,
) {
	const node = context.nodesById.get(frame.nodeId);
	if (!node) {
		await pushStep(context, {
			level: "error",
			message: `[Simulation] Missing for-each node ${frame.nodeId}; branch stopped.`,
		});
		return;
	}

	if (frame.index >= frame.items.length) {
		frames.push({ kind: "follow", sourceNodeId: node.id, handle: "done" });
		return;
	}

	const item = frame.items[frame.index];
	context.nodeOutputs[node.id] = { item, index: frame.index };

	await pushStep(context, {
		level: "info",
		message: `[Simulation] For Each ${node.id} item ${frame.index + 1} of ${frame.items.length}.`,
	});
	frames.push({ kind: "for_each", nodeId: node.id, index: frame.index + 1, items: frame.items });
	frames.push({ kind: "follow", sourceNodeId: node.id, handle: "loop", stopAtNodeId: node.id });
}

async function enqueueFollowFrames(
	context: SimulationContext,
	frames: SimulationFrame[],
	nodeId: string,
	handle: string,
	stopAtNodeId?: string,
) {
	if (context.halted || context.signal?.aborted) {
		return;
	}

	const node = context.nodesById.get(nodeId);
	if (!node) {
		await pushStep(context, {
			level: "error",
			message: `[Simulation] Missing source node ${nodeId}; branch stopped.`,
		});
		return;
	}

	const outgoingEdges = (context.edgesBySource.get(node.id) ?? [])
		.filter((edge) => edge.sourceHandle === handle)
		.sort((left, right) => (getEdgeExecutionOrder(left) ?? 0) - (getEdgeExecutionOrder(right) ?? 0));

	if (outgoingEdges.length === 0) {
		await pushStep(context, {
			level: "info",
			message: `[Simulation] No connection from ${node.data.label} (${node.id}) output "${handle}". Branch ended.`,
		});
		return;
	}

	for (const edge of [...outgoingEdges].reverse()) {
		frames.push({
			edgeId: edge.id,
			kind: "edge",
			sourceNodeId: node.id,
			targetNodeId: edge.target,
			handle,
			stopAtNodeId,
		});
	}
}

async function determineOutputHandle(
	node: Node<ScriptNodeData>,
	context: SimulationContext,
	outcome: "success" | "failed",
) {
	if (node.data.actionType === "control.color_match" && outcome === "failed") {
		return "";
	}

	if (outcome === "failed" && !node.data.outputs.some((output) => output.id === "failed")) {
		await pushStep(context, {
			level: "warn",
			message: `[Simulation] ${node.data.label} (${node.id}) was forced to fail, but it has no failed output. Branch stopped.`,
		});
		return "";
	}

	if (node.data.kind === "trigger") {
		return "out";
	}

	if (node.data.actionType === "control.if") {
		const result = await evaluateIfNode(node, context);
		await pushStep(context, {
			level: "info",
			message: `[Simulation] If / Else ${node.id} evaluated to ${result ? "true" : "false"}.`,
		});
		return result ? "true" : "false";
	}

	if (node.data.actionType === "control.color_match") {
		const matches = context.nodeOutputs[node.id]?.matches === true;
		await pushStep(context, {
			level: "info",
			message: `[Simulation] Color Match ${node.id} selected ${matches ? "match" : "no match"}.`,
		});
		return matches ? "match" : "no_match";
	}

	if (node.data.actionType === "control.switch") {
		return await evaluateSwitchNode(node, context);
	}

	if (fallibleActionTypes.has(node.data.actionType)) {
		return outcome;
	}

	return "out";
}

async function evaluateIfNode(node: Node<ScriptNodeData>, context: SimulationContext) {
	const rows = Array.isArray(node.data.config.conditions) ? node.data.config.conditions.filter(isConditionRow) : [];

	if (rows.length === 0) {
		return false;
	}

	let result = false;
	for (const [index, row] of rows.entries()) {
		const left = resolveTemplate(row.left, context);
		const compared =
			row.operator === "is_null_or_missing"
				? !isTemplateDefined(row.left, context) || left === null
				: await getConditionEvaluationValue(
						left,
						row.operator,
						resolveTemplate(row.right, context),
						resolveTemplate(row.rightEnd ?? "", context),
						context.signal,
					);
		const rowResult = row.invert === true ? !compared : compared;

		if (index === 0) {
			result = rowResult;
			continue;
		}

		result = row.combinator === "or" ? result || rowResult : result && rowResult;
	}
	return result;
}

async function evaluateSwitchNode(node: Node<ScriptNodeData>, context: SimulationContext) {
	const switchValue = resolveTemplate(getConfigString(node, "value"), context);
	const cases = Array.isArray(node.data.config.cases) ? node.data.config.cases.filter(isSwitchCaseRow) : [];
	const matchedCase = cases.find((switchCase) =>
		conditionValuesEqual(switchValue, resolveTemplate(switchCase.value, context)),
	);

	if (!matchedCase) {
		await pushStep(context, {
			level: "info",
			message: `[Simulation] Switch ${node.id} matched no case and selected "default" output.`,
		});
		return "default";
	}

	await pushStep(context, {
		level: "info",
		message: `[Simulation] Switch ${node.id} matched case "${matchedCase.name}" for value "${switchValue}".`,
	});
	return `case-${matchedCase.id}`;
}

async function createNodeOutputData(
	node: Node<ScriptNodeData>,
	context: SimulationContext,
	failed: boolean,
): Promise<NodeExecutionResult> {
	if (failed) {
		return {
			failed: true,
			outputData: {
				error: createError(`Simulated failure for ${node.data.label}.`, "SIMULATED_FAILURE", "simulation", {
					node_id: node.id,
					action_type: node.data.actionType,
				}),
			},
		};
	}

	const customOutput = getNodeDefinition(node.data.actionType)?.simulation?.createOutput;
	if (customOutput) {
		return await customOutput({ api: nodeSimulationApi, context, forcedFailed: failed, node });
	}

	return { failed: false, outputData: {} };
}

function validateResolvedNumericNode(node: Node<ScriptNodeData>, context: SimulationContext) {
	const numericFields = getNodeDefinition(node.data.actionType)?.configFields?.filter((field) =>
		numericContractApplies(field, node.data.config),
	);
	for (const field of numericFields ?? []) {
		if (!field.numeric) {
			throw new Error(`Numeric contract metadata is missing for ${field.key}.`);
		}
		const configuredValue = node.data.config[field.key];
		if (configuredValue === undefined) {
			continue;
		}
		if (field.required === false && typeof configuredValue === "string" && !configuredValue.trim()) {
			continue;
		}
		const resolvedValue =
			typeof configuredValue === "string" ? resolveTemplate(configuredValue, context) : configuredValue;
		const error = validateNumericConfigValue(resolvedValue, field.numeric);
		if (error) {
			return `${field.label} ${error}.`;
		}
	}
	return "";
}

async function getConditionEvaluationValue(
	left: JsonValue,
	operator: string,
	right: JsonValue,
	rightEnd: JsonValue,
	signal?: AbortSignal,
) {
	const result = await evaluateConditionValues(left, operator, right, rightEnd, signal);
	if ("error" in result) {
		throw new Error(result.error);
	}
	return result.value;
}

function getForEachItems(node: Node<ScriptNodeData>, context: SimulationContext): JsonValue[] | string {
	const value = resolveTemplate(getConfigString(node, "items"), context);
	if (Array.isArray(value)) {
		return value;
	}

	if (typeof value === "string" && value.trim()) {
		const parsed = parseJsonValue(value.trim());
		if (Array.isArray(parsed)) {
			return parsed;
		}
	}

	return `items must resolve to a list, found ${getValueType(value)}`;
}

function createSimulatedPixelColorOutput(x: number, y: number): Record<string, JsonValue> {
	const red = positiveModulo(x * 37 + y * 17, 256);
	const green = positiveModulo(x * 13 + y * 57, 256);
	const blue = positiveModulo(x * 91 + y * 23, 256);
	const alpha = 255;
	const integer = red * 65536 + green * 256 + blue;
	const hex = `#${toHexChannel(red)}${toHexChannel(green)}${toHexChannel(blue)}`;

	return {
		x,
		y,
		hex,
		rgb: { r: red, g: green, b: blue },
		rgba: { r: red, g: green, b: blue, a: alpha },
		red,
		green,
		blue,
		alpha,
		integer,
	};
}

function positiveModulo(value: number, divisor: number) {
	return ((value % divisor) + divisor) % divisor;
}

function toHexChannel(value: number) {
	return value.toString(16).padStart(2, "0");
}

function validatePlaySoundNode(node: Node<ScriptNodeData>, context: SimulationContext): NodeExecutionResult {
	const source = getConfigString(node, "source") === "file_path" ? "file_path" : "asset";
	if (source === "file_path") {
		return { failed: false, outputData: {} };
	}

	const assetPath = String(resolveTemplate(getConfigString(node, "assetPath"), context)).trim();
	const asset = context.assetsByPackagePath.get(assetPath.toLowerCase());

	if (!asset || asset.kind !== "audio") {
		return {
			failed: true,
			outputData: {
				error: createPlaySoundErrorObject("Audio asset was not found in the current asset library.", {
					source,
					asset_path: assetPath,
				}),
			},
		};
	}

	return { failed: false, outputData: {} };
}

async function simulateDelayNode(node: Node<ScriptNodeData>, context: SimulationContext) {
	const delay = getDelaySimulationDuration(node, context);
	await pushStep(context, {
		level: "info",
		message: `[Simulation] Delay (${node.id}) waiting ${delay.label}.`,
	});

	await sleepSimulationStep(delay.waitMs, context.signal);
	if (context.signal?.aborted) {
		return;
	}

	await pushStep(context, {
		level: "info",
		message: `[Simulation] Delay (${node.id}) completed after ${delay.label}.`,
	});
}

function getDelaySimulationDuration(node: Node<ScriptNodeData>, context: SimulationContext) {
	const amountValue = Number(resolveTemplate(getConfigString(node, "amount"), context));
	const configuredMs = Math.round(amountValue * getDelayUnitMultiplier(getConfigString(node, "unit")));

	return {
		label: `${formatValue(resolveTemplate(getConfigString(node, "amount"), context))} ${normalizeDelayUnit(getConfigString(node, "unit"))}`,
		waitMs: configuredMs,
	};
}

function getDelayUnitMultiplier(unit: string) {
	if (unit === "milliseconds") {
		return 1;
	}

	if (unit === "days") {
		return 24 * 60 * 60 * 1000;
	}

	if (unit === "hours") {
		return 60 * 60 * 1000;
	}

	if (unit === "minutes") {
		return 60 * 1000;
	}

	if (unit === "seconds") {
		return 1000;
	}

	throw new Error(`Unsupported delay unit: ${unit || "(empty)"}`);
}

function normalizeDelayUnit(unit: string) {
	return ["milliseconds", "seconds", "minutes", "hours", "days"].includes(unit) ? unit : "unknown unit";
}

function createPlaySoundErrorObject(message: string, details: Record<string, JsonValue>): Record<string, JsonValue> {
	return createError(message, "AUDIO_PLAYBACK_FAILED", "audio", details);
}

function createError(
	message: string,
	code: string,
	type: string,
	details: Record<string, JsonValue> = {},
	retryable = true,
): Record<string, JsonValue> {
	return {
		message,
		code,
		type,
		retryable,
		details,
	};
}

async function executeHttpRequestNode(
	node: Node<ScriptNodeData>,
	context: SimulationContext,
): Promise<NodeExecutionResult> {
	const startedAt = performance.now();
	let method = getConfigString(node, "method");
	let url = getConfigString(node, "url");
	try {
		method = normalizeHttpMethod(method);
		if (context.httpSimulation.mode === "mock") {
			return {
				failed: false,
				outputData: {
					body: "",
					duration_ms: 0,
					headers: {},
					status_code: 200,
					status_text: "Mocked",
				},
			};
		}
		url = String(resolveTemplate(url, context)).trim();
		const origin = new URL(url).origin;
		if (!context.httpSimulation.authorizedOrigins.has(origin)) {
			throw new SimulationHttpClientError(
				`Destination ${origin} was not authorized for this simulation.`,
				"ORIGIN_NOT_AUTHORIZED",
			);
		}
	} catch (error) {
		if (error instanceof SimulationCastError) {
			throw error;
		}
		return {
			failed: true,
			outputData: {
				error: createHttpErrorObject(error, url, method, Math.round(performance.now() - startedAt)),
			},
		};
	}

	const timeoutSeconds = Number(getConfigString(node, "timeoutSeconds"));
	const abortController = new AbortController();
	const forwardAbort = () => abortController.abort(context.signal?.reason);
	const timeoutId = window.setTimeout(() => abortController.abort("timeout"), timeoutSeconds * 1000);

	if (context.signal?.aborted) {
		window.clearTimeout(timeoutId);
		return { failed: false, outputData: {} };
	}

	context.signal?.addEventListener("abort", forwardAbort, { once: true });

	try {
		const headers = createHttpHeaders(node, context);
		const body = resolveHttpRequestBody(node, context, headers);
		// Issued from the browser rather than through a server route. The editor
		// does not make requests on a user's behalf, so live simulation reaches
		// only destinations that allow it through CORS, and the request carries
		// the user's own address rather than the editor host's.
		const response = await window.fetch(url, {
			method,
			headers,
			body: method === "GET" || method === "HEAD" || body.length === 0 ? undefined : body,
			signal: abortController.signal,
		});
		const responseBody = await response.text();
		const json = parseJsonValue(responseBody);
		const outputData: Record<string, JsonValue> = {
			status_code: response.status,
			status_text: response.statusText,
			headers: getResponseHeaders(response.headers),
			body: responseBody,
			duration_ms: Math.round(performance.now() - startedAt),
		};

		if (json !== undefined) {
			outputData.json = json;
		}

		return { failed: false, outputData };
	} catch (error) {
		if (error instanceof SimulationCastError) {
			throw error;
		}
		if (context.signal?.aborted) {
			return { failed: false, outputData: {} };
		}

		return {
			failed: true,
			outputData: {
				error: createHttpErrorObject(error, url, method, Math.round(performance.now() - startedAt)),
			},
		};
	} finally {
		window.clearTimeout(timeoutId);
		context.signal?.removeEventListener("abort", forwardAbort);
	}
}

function resolveHttpRequestBody(node: Node<ScriptNodeData>, context: SimulationContext, headers: Headers) {
	const body = getConfigString(node, "body");
	if (!body.trim()) {
		return "";
	}

	const configuredFormat = getConfigString(node, "bodyFormat");
	const contentType = headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
	const inferredJson =
		contentType === "application/json" || (contentType.startsWith("application/") && contentType.endsWith("+json"));
	if (configuredFormat === "text" || (configuredFormat !== "json" && !inferredJson)) {
		return String(resolveTemplate(body, context));
	}

	const parsed = JSON.parse(body) as JsonValue;
	return JSON.stringify(resolveJsonBodyTemplate(parsed, context));
}

function resolveJsonBodyTemplate(value: JsonValue, context: SimulationContext): JsonValue {
	if (typeof value === "string") {
		return resolveTemplate(value, context);
	}
	if (Array.isArray(value)) {
		return value.map((item) => resolveJsonBodyTemplate(item, context));
	}
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [
				String(resolveTemplate(key, context)),
				resolveJsonBodyTemplate(item, context),
			]),
		);
	}

	return value;
}

function createHttpHeaders(node: Node<ScriptNodeData>, context: SimulationContext) {
	const headers = new Headers();
	const configHeaders = node.data.config.headers;

	if (Array.isArray(configHeaders)) {
		for (const header of configHeaders) {
			if (!isHeaderLike(header)) {
				continue;
			}

			setSimulatedHttpHeader(headers, header.name, header.value, context);
		}
	} else if (configHeaders && typeof configHeaders === "object") {
		for (const [name, value] of Object.entries(configHeaders)) {
			setSimulatedHttpHeader(headers, name, formatValue(value), context);
		}
	}
	const userAgent = getConfigString(node, "userAgent");
	if (userAgent.trim()) setSimulatedHttpHeader(headers, "user-agent", userAgent, context);

	return headers;
}

function setSimulatedHttpHeader(
	headers: Headers,
	nameTemplate: string,
	valueTemplate: string,
	context: SimulationContext,
) {
	const name = String(resolveTemplate(nameTemplate, context)).trim();
	if (!name) {
		return;
	}
	if (!isHttpToken(name)) {
		throw new Error(`invalid HTTP header name ${name}`);
	}

	const value = String(resolveTemplate(valueTemplate, context));
	if (/[\0\r\n]/.test(value)) {
		throw new Error(`invalid HTTP header value for ${name}`);
	}

	headers.set(name, value);
}

function createHttpErrorObject(
	error: unknown,
	url: string,
	method: string,
	durationMs: number,
): Record<string, JsonValue> {
	const isTimeout = error instanceof DOMException && error.name === "AbortError";
	const serviceError = error instanceof SimulationHttpClientError ? error : null;
	const message = isTimeout
		? `HTTP request timed out after ${durationMs}ms.`
		: error instanceof Error
			? error.message
			: "HTTP request failed.";

	return createHttpActionError(message, isTimeout ? "HTTP_TIMEOUT" : (serviceError?.code ?? "HTTP_REQUEST_FAILED"), {
		method,
		destination: safeHttpOrigin(url),
		duration_ms: durationMs,
	});
}

function getResponseHeaders(headers: Headers): Record<string, JsonValue> {
	const responseHeaders: Record<string, JsonValue> = {};
	headers.forEach((value, key) => {
		responseHeaders[key] = value;
	});

	return responseHeaders;
}

function safeHttpOrigin(value: string) {
	try {
		return new URL(value).origin;
	} catch {
		return "invalid URL";
	}
}

function createNodeSideEffects(node: Node<ScriptNodeData>, context: SimulationContext): SimulationSideEffect[] {
	const customSideEffects = getNodeDefinition(node.data.actionType)?.simulation?.sideEffects;
	if (customSideEffects) {
		return customSideEffects({ api: nodeSimulationApi, context, node });
	}

	return [];
}

function describeNodeExecution(
	node: Node<ScriptNodeData>,
	context: SimulationContext,
	failed: boolean,
	override: SimulationOverride["outcome"] | undefined,
): SimulationTraceEntry[] {
	const customDescribe = getNodeDefinition(node.data.actionType)?.simulation?.describe;
	if (customDescribe) {
		return customDescribe({ api: nodeSimulationApi, context, failed, node, override });
	}

	const prefix = `[Simulation] ${node.data.label} (${node.id})`;
	const overrideText = override ? ` Override forced ${override}.` : "";
	const resultText = failed ? "failed" : "succeeded";
	const detail = getExecutionDetail(node, context, failed);

	return [
		{
			level: failed ? "error" : "info",
			message: `${prefix} ${resultText}.${overrideText}${detail ? ` ${detail}` : ""}`,
		},
	];
}

function getExecutionDetail(node: Node<ScriptNodeData>, _context: SimulationContext, failed: boolean) {
	if (failed) {
		return "The failed output will be used when it is connected.";
	}

	return node.data.kind === "trigger" ? "Trigger fired." : "";
}

function resolveJsonCompatibleInput(value: string, context: SimulationContext): JsonValue {
	const resolved = resolveTemplate(value, context);
	if (typeof resolved !== "string") {
		return resolved;
	}

	const trimmed = resolved.trim();
	if (trimmed === "true") {
		return true;
	}

	if (trimmed === "false") {
		return false;
	}

	if (trimmed === "null") {
		return null;
	}

	if (trimmed && Number.isFinite(Number(trimmed))) {
		return Number(trimmed);
	}

	return parseJsonValue(trimmed) ?? resolved;
}

function resolveTemplate(value: string, context: SimulationContext): JsonValue {
	const exactReference = value.match(/^\{\{\s*([^}]+?)\s*\}\}$/);
	if (exactReference) {
		return getReferenceValue(exactReference[1].trim(), context);
	}

	return value.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, reference: string) =>
		String(getReferenceValue(reference.trim(), context)),
	);
}

function isTemplateDefined(value: string, context: SimulationContext) {
	const exactReference = value.match(/^\{\{\s*([^}]+?)\s*\}\}$/);
	return exactReference ? tryGetReferenceValue(exactReference[1].trim(), context) !== undefined : true;
}

function normalizeIterationCount(value: JsonValue) {
	if (typeof value === "number") {
		return BigInt(value);
	}

	if (typeof value === "string") {
		return BigInt(value.trim());
	}

	throw new TypeError("Validated loop count did not resolve to an integer");
}

function getReferenceValue(expression: string, context: SimulationContext): JsonValue {
	return tryGetReferenceValue(expression, context) ?? `{{${expression}}}`;
}

/**
 * Resolves a `{{reference}}` or `{{reference|target}}` expression, splitting
 * and casting exactly as resolve_variable_expression does in the runner.
 *
 * A cast failure throws SimulationCastError instead of returning undefined,
 * so the caller cannot mistake it for an unresolved reference and fall back
 * to leaving the template text in place. `null` fails every target: it is
 * what an unset variable or a missing key both resolve to, and castSimulatedValue
 * already rejects it for every target, so no separate check is needed here.
 */
function tryGetReferenceValue(expression: string, context: SimulationContext): JsonValue | undefined {
	const { reference, target } = splitCast(expression);
	const resolved = resolveReferencePath(reference, context);
	if (target === null) {
		return resolved;
	}

	const outcome = castSimulatedValue(resolved ?? null, target);
	if (!outcome.ok) {
		throw new SimulationCastError(`variable "${reference}" ${outcome.error}`);
	}
	return outcome.value as JsonValue;
}

function resolveReferencePath(reference: string, context: SimulationContext): JsonValue | undefined {
	const live = resolveLiveSystemReference(reference, context);
	if (live !== undefined) {
		return live;
	}

	if (reference in context.runtimeVariables) {
		return context.runtimeVariables[reference];
	}

	if (reference in context.persistentVariables) {
		return context.persistentVariables[reference];
	}

	if (reference in context.globalVariables) {
		return context.globalVariables[reference];
	}

	const variableReference =
		getRuntimeVariableReference(reference, context.runtimeVariables) ??
		getRuntimeVariableReference(reference, context.persistentVariables) ??
		getRuntimeVariableReference(reference, context.globalVariables);
	if (variableReference) {
		if (context.secretNames.has(variableReference.name) && variableReference.path.startsWith("$")) {
			return undefined;
		}
		return getPathValue(variableReference.value, variableReference.path);
	}

	const nodeId = [...context.nodesById.keys()].find((id) => reference === id || reference.startsWith(`${id}.`));
	if (!nodeId) {
		return undefined;
	}

	const path = reference.slice(nodeId.length + 1);
	return getPathValue(context.nodeOutputs[nodeId] ?? {}, path);
}

function getRuntimeVariableReference(reference: string, variables: Record<string, JsonValue>) {
	const variableName = Object.keys(variables)
		.filter((name) => reference.startsWith(`${name}.`) || reference.startsWith(`${name}[`))
		.sort((a, b) => b.length - a.length)[0];

	if (!variableName) {
		return null;
	}

	const path = reference.startsWith(`${variableName}.`)
		? reference.slice(variableName.length + 1)
		: reference.slice(variableName.length);

	return {
		name: variableName,
		path,
		value: variables[variableName],
	};
}

/**
 * Resolves a reference into a live `@system` field, or undefined if it is not
 * one. The clock and the uptime move during a run, so they are read when a
 * reference asks rather than seeded once, and the reading is held for the rest
 * of the node execution that asked for it.
 */
function resolveLiveSystemReference(reference: string, context: SimulationContext): JsonValue | undefined {
	const prefix = `${SYSTEM_NAMESPACE}.`;
	if (!reference.startsWith(prefix)) {
		return undefined;
	}

	const [field, ...rest] = reference.slice(prefix.length).split(".");
	if (!liveSystemFields.has(field)) {
		return undefined;
	}

	context.liveReadAt ??= new Date();
	const value = readLiveSystemField(field, context.liveReadAt) as JsonValue | undefined;
	if (value === undefined || rest.length === 0) {
		return value;
	}

	return getPathValue(value, `.${rest.join(".")}`);
}

/**
 * Walks an accessor path from a resolved value, ending in an optional metadata
 * segment. Exported so the shared conformance fixture can hold it to the
 * runner, which implements the same walk in `resolve_value_path`.
 */
export function getPathValue(value: JsonValue, path: string): JsonValue | undefined {
	if (!path) {
		return value;
	}

	const parts = parseValuePath(path);
	if (!parts) {
		return undefined;
	}

	let currentValue: JsonValue | undefined = value;
	for (const [index, key] of parts.entries()) {
		// A metadata segment is only allowed last, matching the runner. A value
		// can genuinely hold a key spelled like one, so refusing it in the middle
		// keeps a single meaning rather than guessing which was meant.
		if (key.startsWith("$")) {
			// Nothing to describe when the path already fell off the value. A
			// length of 0 for an absent field would read as "present and empty".
			// A field that is present and null is a different case and resolves.
			if (currentValue === undefined || index !== parts.length - 1) {
				return undefined;
			}
			return getDerivedValueMetadata(currentValue, key);
		}

		if (currentValue === undefined || currentValue === null || typeof currentValue !== "object") {
			return undefined;
		}

		if (Array.isArray(currentValue)) {
			const arrayIndex = Number(key);
			currentValue = Number.isInteger(arrayIndex) ? currentValue[arrayIndex] : undefined;
			continue;
		}

		// A real key wins over a computed one, so a datetime's own "value" and
		// "type" keep meaning what they always did. A component only answers
		// when the value does not carry that key itself.
		currentValue = key in currentValue ? currentValue[key] : componentFieldValue(currentValue, key);
	}

	return currentValue;
}

function parseValuePath(path: string): string[] | undefined {
	const parts: string[] = [];
	let index = 0;

	while (index < path.length) {
		if (path[index] === ".") {
			const start = ++index;
			while (index < path.length && path[index] !== "." && path[index] !== "[") {
				index += 1;
			}
			if (index === start) {
				return undefined;
			}
			parts.push(path.slice(start, index));
			continue;
		}

		if (path[index] !== "[") {
			const start = index;
			while (index < path.length && path[index] !== "." && path[index] !== "[") {
				index += 1;
			}
			if (index === start) {
				return undefined;
			}
			parts.push(path.slice(start, index));
			continue;
		}

		const bracket = parseBracketAccessor(path, index + 1);
		if (!bracket) {
			return undefined;
		}
		parts.push(bracket.key);
		index = bracket.nextIndex;
	}

	return parts;
}

function parseBracketAccessor(path: string, start: number): { key: string; nextIndex: number } | undefined {
	let quote = "";
	let escaped = false;
	let index = start;
	for (; index < path.length; index += 1) {
		const character = path[index];
		if (escaped) {
			escaped = false;
			continue;
		}
		if (character === "\\" && quote) {
			escaped = true;
			continue;
		}
		if (quote) {
			if (character === quote) {
				quote = "";
			}
			continue;
		}
		if (character === '"' || character === "'") {
			quote = character;
			continue;
		}
		if (character === "]") {
			break;
		}
	}

	if (index >= path.length || quote || escaped) {
		return undefined;
	}

	const accessor = path.slice(start, index).trim();
	let key: string;
	if (/^(?:0|[1-9][0-9]*)$/.test(accessor)) {
		key = accessor;
	} else if (accessor.startsWith('"')) {
		try {
			const parsed = JSON.parse(accessor);
			if (typeof parsed !== "string") {
				return undefined;
			}
			key = parsed;
		} catch {
			return undefined;
		}
	} else if (accessor.startsWith("'") && accessor.endsWith("'")) {
		const parsed = parseSingleQuotedAccessor(accessor.slice(1, -1));
		if (parsed === undefined) {
			return undefined;
		}
		key = parsed;
	} else {
		return undefined;
	}

	return { key, nextIndex: index + 1 };
}

function parseSingleQuotedAccessor(value: string): string | undefined {
	let output = "";
	let escaped = false;
	for (const character of value) {
		if (escaped) {
			output += character;
			escaped = false;
		} else if (character === "\\") {
			escaped = true;
		} else {
			output += character;
		}
	}
	return escaped ? undefined : output;
}

function getDerivedValueMetadata(value: JsonValue | undefined, key: string): JsonValue | undefined {
	if (key === "$length" || key === "$count") {
		return getValueLength(value);
	}

	if (key === "$type") {
		return getValueType(value);
	}

	if (key === "$is_empty") {
		return isValueEmpty(value);
	}

	// Anything else beginning with $ is not metadata this runner knows.
	return undefined;
}

function getValueLength(value: JsonValue | undefined) {
	if (typeof value === "string" || Array.isArray(value)) {
		return value.length;
	}

	if (value && typeof value === "object") {
		return Object.keys(value).length;
	}

	return 0;
}

function getValueType(value: JsonValue | undefined) {
	if (Array.isArray(value)) {
		return "list";
	}

	if (value === null) {
		return "null";
	}

	if (value === undefined) {
		return "missing";
	}

	// integer and float are separate types, so a bare "number" would name a type
	// that no longer exists. These are the names the runner reports.
	if (typeof value === "number") {
		return Number.isInteger(value) ? "integer" : "float";
	}

	return typeof value;
}

function isValueEmpty(value: JsonValue | undefined) {
	if (value === undefined || value === null) {
		return true;
	}

	if (typeof value === "string" || Array.isArray(value)) {
		return value.length === 0;
	}

	if (typeof value === "object") {
		return Object.keys(value).length === 0;
	}

	return false;
}

async function pushStep(
	context: SimulationContext,
	trace: SimulationTraceEntry,
	sideEffects: SimulationSideEffect[] = [],
	traversedEdgeIds: string[] = [],
) {
	if (trace.level === "error") {
		context.failed = true;
	}

	return emitStep(
		context,
		createTraceStep(context, truncateTrace(redactTrace(context, trace)), sideEffects, traversedEdgeIds),
	);
}

async function pushOutputLog(context: SimulationContext, log: LogEntry) {
	return emitStep(context, {
		outputLogs: [truncateLog(redactLog(context, log))],
		sideEffects: [],
		traces: [],
		traversedEdgeIds: [],
		variables: createVariableSnapshot(context),
	});
}

async function pushNodeState(
	context: SimulationContext,
	nodeId: string,
	status: NonNullable<SimulationStep["nodeState"]>["status"],
) {
	return emitStep(context, {
		nodeState: { nodeId, status },
		outputLogs: [],
		sideEffects: [],
		traces: [],
		traversedEdgeIds: [],
		variables: createVariableSnapshot(context),
	});
}

async function emitStep(context: SimulationContext, step: SimulationStep) {
	if (!context.onStep) {
		return [];
	}

	if (context.signal?.aborted) {
		return [];
	}

	const results = (await context.onStep(step)) ?? [];
	await yieldSimulationTask(context.signal);

	if (context.signal?.aborted) {
		return results;
	}

	await sleepSimulationStep(context.stepDelayMs, context.signal);
	return results;
}

export function yieldSimulationTask(signal: AbortSignal | undefined) {
	if (signal?.aborted) {
		return Promise.resolve();
	}

	return new Promise<void>((resolve) => {
		let completed = false;
		const finish = () => {
			if (completed) {
				return;
			}

			completed = true;
			window.clearTimeout(timeoutId);
			signal?.removeEventListener("abort", handleAbort);
			resolve();
		};
		const timeoutId = window.setTimeout(finish, 0);
		const handleAbort = () => finish();
		signal?.addEventListener("abort", handleAbort, { once: true });
	});
}

function sleepSimulationStep(ms: number, signal: AbortSignal | undefined) {
	if (ms <= 0 || signal?.aborted) {
		return Promise.resolve();
	}

	return new Promise<void>((resolve) => {
		let completed = false;
		const finish = () => {
			if (completed) {
				return;
			}

			completed = true;
			window.clearTimeout(timeoutId);
			signal?.removeEventListener("abort", handleAbort);
			resolve();
		};
		const timeoutId = window.setTimeout(finish, ms);
		const handleAbort = () => finish();
		signal?.addEventListener("abort", handleAbort, { once: true });
	});
}

function createTraceStep(
	context: SimulationContext,
	trace: SimulationTraceEntry,
	sideEffects: SimulationSideEffect[] = [],
	traversedEdgeIds: string[] = [],
): SimulationStep {
	return {
		outputLogs: [],
		sideEffects,
		traces: [trace],
		traversedEdgeIds,
		variables: createVariableSnapshot(context),
	};
}

function createVariableSnapshot(context: SimulationContext): SimulationVariableSnapshot[] {
	const runtimeVariables = Object.entries(context.runtimeVariables)
		.filter(([name]) => !context.secretNames.has(name))
		.map(([name, value]) => ({
			name,
			source: "runtime" as const,
			value: createSnapshotValue(redactSnapshotValue(context, value)),
		}));

	const persistentVariables = Object.entries(context.persistentVariables).map(([name, value]) => ({
		name,
		source: "persistent" as const,
		value: createSnapshotValue(redactSnapshotValue(context, value)),
	}));

	const globalVariables = Object.entries(context.globalVariables).map(([name, value]) => ({
		name,
		source: "global" as const,
		value: createSnapshotValue(redactSnapshotValue(context, value)),
	}));

	const nodeOutputVariables = Object.entries(context.nodeOutputs).flatMap(([nodeId, outputs]) =>
		flattenObject(outputs).map(([name, value]) => ({
			name: `${nodeId}.${name}`,
			source: "node_output" as const,
			value: createSnapshotValue(redactSnapshotValue(context, value)),
		})),
	);

	return [...runtimeVariables, ...persistentVariables, ...globalVariables, ...nodeOutputVariables]
		.sort((a, b) => a.name.localeCompare(b.name))
		.slice(0, MAX_VARIABLE_SNAPSHOT_ENTRIES);
}

function flattenObject(value: Record<string, JsonValue>, prefix = ""): Array<[string, JsonValue]> {
	return Object.entries(value).flatMap(([key, entry]) => {
		const name = prefix ? `${prefix}.${key}` : key;
		if (entry && typeof entry === "object" && !Array.isArray(entry)) {
			return [[name, entry] as [string, JsonValue], ...flattenObject(entry, name)];
		}

		return [[name, entry]];
	});
}

function createSnapshotValue(value: JsonValue): JsonValue {
	if (typeof value === "string") {
		return truncateText(value, MAX_VARIABLE_SNAPSHOT_STRING_LENGTH);
	}

	if (Array.isArray(value)) {
		return value.slice(0, 50).map(createSnapshotValue);
	}

	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value)
				.slice(0, 50)
				.map(([key, entry]) => [key, createSnapshotValue(entry)]),
		);
	}

	return value;
}

function redactTrace(context: SimulationContext, trace: SimulationTraceEntry): SimulationTraceEntry {
	return { ...trace, message: redactSecretText(context, trace.message) };
}

function redactLog(context: SimulationContext, log: LogEntry): LogEntry {
	return { ...log, message: redactSecretText(context, log.message) };
}

function redactSecretText(context: SimulationContext, value: string) {
	return context.secretValues.reduce<string>((redacted, secret) => {
		const serialized = typeof secret === "string" ? secret : JSON.stringify(secret);
		return serialized ? redacted.replaceAll(serialized, "[REDACTED]") : redacted;
	}, value);
}

function redactSnapshotValue(context: SimulationContext, value: JsonValue): JsonValue {
	if (context.secretValues.some((secret) => jsonValuesEqual(secret, value))) {
		return "[REDACTED]";
	}
	if (typeof value === "string") {
		return redactSecretText(context, value);
	}

	if (Array.isArray(value)) {
		return value.map((entry) => redactSnapshotValue(context, entry));
	}

	if (value && typeof value === "object") {
		return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, redactSnapshotValue(context, entry)]));
	}

	return value;
}

function jsonValuesEqual(left: JsonValue, right: JsonValue) {
	return JSON.stringify(left) === JSON.stringify(right);
}

function groupEdgesBySource(edges: Edge[]) {
	return edges.reduce((edgesBySource, edge) => {
		const currentEdges = edgesBySource.get(edge.source) ?? [];
		currentEdges.push(edge);
		edgesBySource.set(edge.source, currentEdges);
		return edgesBySource;
	}, new Map<string, Edge[]>());
}

function sortNodesForExecution(nodes: Node<ScriptNodeData>[]) {
	return [...nodes].sort((a, b) => getNodeSortValue(a) - getNodeSortValue(b));
}

function getNodeSortValue(node: Node<ScriptNodeData> | undefined) {
	if (!node) {
		return Number.MAX_SAFE_INTEGER;
	}

	return node.position.y * 100000 + node.position.x;
}

function getConfigString(node: Node<ScriptNodeData>, key: string) {
	const value = node.data.config[key];
	if (typeof value === "string") {
		return value;
	}

	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}

	return "";
}

function isHeaderLike(value: JsonValue): value is { name: string; value: string } {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		typeof value.name === "string" &&
		typeof value.value === "string"
	);
}

function normalizeHttpMethod(value: string) {
	const method = value.trim().toUpperCase();
	if (!method || !isHttpToken(method)) {
		throw new Error(`invalid HTTP method ${value}`);
	}
	return method;
}

function isHttpToken(value: string) {
	return /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(value);
}

function parseJsonValue(value: string): JsonValue | undefined {
	if (!value.trim()) {
		return undefined;
	}

	try {
		const parsed = JSON.parse(value) as unknown;
		return isJsonValue(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

function isJsonValue(value: unknown): value is JsonValue {
	if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
		return true;
	}

	if (Array.isArray(value)) {
		return value.every(isJsonValue);
	}

	if (typeof value === "object") {
		return Object.values(value).every(isJsonValue);
	}

	return false;
}

function formatValue(value: JsonValue) {
	return typeof value === "string" ? value : JSON.stringify(value);
}

function truncateTrace(trace: SimulationTraceEntry): SimulationTraceEntry {
	return { ...trace, message: truncateText(trace.message) };
}

function truncateLog(log: LogEntry): LogEntry {
	return { ...log, message: truncateText(log.message) };
}

function truncateText(value: string, maxLength = MAX_SIMULATION_MESSAGE_LENGTH) {
	return value.length > maxLength ? `${value.slice(0, maxLength)}... [truncated]` : value;
}
