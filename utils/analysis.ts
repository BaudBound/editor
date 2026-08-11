import type { Edge, Node } from "@xyflow/react";
import {
	getControlStepType,
	getNodeCapabilities,
	getNodePermissions,
	getRunnerActionType,
	getRunnerTriggerType,
	sanitizeNodeConfig,
} from "@/data/nodes/registry";
import { createBuiltInVariableRuntimeContext } from "@/data/project/built-in-variables";
import { createNodeOutputVariables } from "@/data/project/variables";
import type {
	ActionType,
	CapabilitySummary,
	DeclaredVariable,
	EditorAsset,
	ExecutableActionType,
	ExportSummary,
	LogEntry,
	PermissionSummary,
	ProjectSettings,
	RiskLevel,
	ScriptNodeData,
	SecretDeclaration,
	TargetRuntime,
	TriggerActionType,
} from "../lib/types";
import { getEdgeExecutionOrder } from "./editor-graph";
import { createScriptPackageFilename } from "./script-repository";

const riskWeight: Record<RiskLevel, number> = {
	low: 1,
	medium: 2,
	high: 3,
	dangerous: 4,
};

/**
 * The scope a Variable Operation node writes at.
 *
 * Read from the declaration rather than the node, because a node no longer
 * carries a scope. The permission a write needs depends entirely on it, so a
 * node naming an undeclared variable contributes none rather than guessing at
 * the least privileged one.
 */
function declaredScopeForNode(node: Node<ScriptNodeData>, declaredVariables: DeclaredVariable[]) {
	if (node.data.actionType !== "runtime.set_variable") {
		return undefined;
	}
	const name = typeof node.data.config.name === "string" ? node.data.config.name : "";
	return declaredVariables.find((variable) => variable.name === name)?.scope;
}

export function calculatePermissions(
	nodes: Node<ScriptNodeData>[],
	secretDeclarations: SecretDeclaration[] = [],
	declaredVariables: DeclaredVariable[] = [],
): PermissionSummary[] {
	const permissions = new Map<string, PermissionSummary>();

	for (const node of nodes) {
		for (const permission of getNodePermissions(
			node.data.actionType,
			node.data.config,
			declaredScopeForNode(node, declaredVariables),
		)) {
			const existing = permissions.get(permission.name);
			if (!existing || riskWeight[permission.risk] > riskWeight[existing.risk]) {
				permissions.set(permission.name, permission);
			}
		}
	}
	if (secretDeclarations.length > 0) {
		permissions.set("secret.read", { name: "secret.read", risk: "high" });
	}
	if (declaredVariables.some((variable) => variable.scope === "runtime")) {
		permissions.set("variable.local.set", { name: "variable.local.set", risk: "low" });
	}
	if (declaredVariables.some((variable) => variable.scope === "persistent")) {
		permissions.set("variable.persistent.set", { name: "variable.persistent.set", risk: "medium" });
	}

	return [...permissions.values()].sort(
		(a, b) => riskWeight[a.risk] - riskWeight[b.risk] || a.name.localeCompare(b.name),
	);
}

export function calculateCapabilities(
	nodes: Node<ScriptNodeData>[],
	secretDeclarations: SecretDeclaration[] = [],
	declaredVariables: DeclaredVariable[] = [],
): CapabilitySummary[] {
	const capabilities = new Set<string>();

	for (const node of nodes) {
		for (const capability of getNodeCapabilities(
			node.data.actionType,
			node.data.config,
			declaredScopeForNode(node, declaredVariables),
		)) {
			capabilities.add(capability);
		}
	}
	if (secretDeclarations.length > 0) {
		capabilities.add("runtime.secrets");
	}
	if (declaredVariables.length > 0) {
		capabilities.add("runtime.variables");
	}
	if (declaredVariables.some((variable) => variable.scope === "persistent")) {
		capabilities.add("runtime.persistent_storage");
	}

	return [...capabilities].sort().map((name) => ({ name }));
}

export function calculateRiskLevel(permissions: PermissionSummary[]): RiskLevel {
	return permissions.reduce<RiskLevel>((highest, permission) => {
		return riskWeight[permission.risk] > riskWeight[highest] ? permission.risk : highest;
	}, "low");
}

export function createExportSummary(
	projectName: string,
	scriptVersion: string,
	targetRuntimes: TargetRuntime[],
	minimumRunnerVersion: string,
	assets: EditorAsset[] = [],
): ExportSummary {
	return {
		filename: createScriptPackageFilename(projectName, scriptVersion),
		formatVersion: 1,
		languageVersion: 1,
		minimumRunnerVersion,
		targetRuntimes,
		contents: [
			"manifest.json",
			"program.json",
			"editor.json",
			"permissions.json",
			"capabilities.json",
			"README.md",
			...assets.map((asset) => asset.packagePath).sort(),
		],
	};
}

export function createConsoleLogs(
	scriptName: string,
	targetRuntimes: TargetRuntime[],
	permissions: PermissionSummary[],
): LogEntry[] {
	const risk = calculateRiskLevel(permissions);
	const logs: LogEntry[] = [
		{ level: "info", message: `Script loaded: ${scriptName}` },
		{ level: "info", message: `Target runtimes: ${targetRuntimes.join(", ")}` },
		{ level: "info", message: `Permissions calculated: ${permissions.length} required` },
	];

	if (risk !== "low") {
		logs.push({ level: "warn", message: `${risk} risk action requires approval on import` });
	}

	logs.push({ level: "info", message: "Script is valid. Ready to export." });

	return logs;
}

export function toProgramJson(nodes: Node<ScriptNodeData>[], edges: Edge[], projectSettings: ProjectSettings) {
	const triggers = nodes.filter((node) => node.data.kind === "trigger").map(toTriggerJson);
	const steps = nodes.filter((node) => node.data.kind !== "trigger").map(toStepJson);
	const builtInVariableContext = createBuiltInVariableRuntimeContext(projectSettings);
	const nodeOutputVariables = createNodeOutputVariables(nodes);

	if (triggers.length === 0) {
		throw new Error("Cannot export a script without at least one trigger node.");
	}

	return {
		entry: {
			trigger: triggers[0],
			triggers,
			program: {
				type: "block",
				execution_model: "directed_graph",
				runtime_context: {
					expression_reference: "{{node-id.data_name}}",
					template_reference: "{{node-id.data_name}}",
					variables: [...builtInVariableContext.variables, ...nodeOutputVariables],
					built_in_variables: builtInVariableContext,
					node_outputs: nodes
						.filter((node) => (node.data.runtimeOutputs ?? []).length > 0)
						.map((node) => ({
							id: node.id,
							action_type: node.data.actionType,
							outputs: node.data.runtimeOutputs ?? [],
						})),
				},
				steps,
				edges: edges.map((edge) => ({
					execution_order: requireEdgeExecutionOrder(edge),
					source: edge.source,
					source_handle: edge.sourceHandle,
					target: edge.target,
					target_handle: edge.targetHandle,
				})),
			},
		},
	};
}

function requireEdgeExecutionOrder(edge: Edge) {
	const executionOrder = getEdgeExecutionOrder(edge);
	if (executionOrder === null) {
		throw new Error(`Connection ${edge.id} is missing its execution order.`);
	}
	return executionOrder;
}

function toTriggerJson(node: Node<ScriptNodeData>) {
	const actionType = node.data.actionType;

	if (!isTriggerActionType(actionType)) {
		throw new Error(`Node ${node.id} is marked as trigger but uses non-trigger action type ${actionType}`);
	}

	return {
		id: node.id,
		action_type: actionType,
		type: getRunnerTriggerType(actionType),
		config: sanitizeNodeConfig(actionType, node.data.config),
		runtime_outputs: node.data.runtimeOutputs ?? [],
	};
}

function toStepJson(node: Node<ScriptNodeData>) {
	const base = {
		id: node.id,
		action_type: node.data.actionType,
		config: sanitizeNodeConfig(node.data.actionType, node.data.config),
		runtime_outputs: node.data.runtimeOutputs ?? [],
	};

	if (node.data.kind === "control") {
		return {
			...base,
			type: getControlStepType(node.data.actionType),
		};
	}

	if (node.data.actionType === "runtime.set_variable") {
		return {
			...base,
			type: "set_variable",
		};
	}

	if (!isExecutableActionType(node.data.actionType)) {
		throw new Error(`Unsupported action type in export: ${node.data.actionType}`);
	}

	return {
		...base,
		type: "action",
		action: getRunnerActionType(node.data.actionType),
	};
}

function isTriggerActionType(actionType: ActionType): actionType is TriggerActionType {
	return actionType.startsWith("trigger.");
}

function isExecutableActionType(actionType: ActionType): actionType is ExecutableActionType {
	return actionType.startsWith("action.");
}
