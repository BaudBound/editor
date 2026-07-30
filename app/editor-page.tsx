"use client";

import {
	applyEdgeChanges,
	type Edge,
	type EdgeChange,
	useEdgesState,
	useNodesState,
	type XYPosition,
} from "@xyflow/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	areCommentNodeDataEqual,
	createCommentFlowNode,
	DEFAULT_COMMENT_SIZE,
	isCommentFlowNode,
	toCommentFlowNode,
	toEditorComment,
} from "@/components/canvas/comment-card";
import {
	type CanvasNodeFocusRequest,
	type EditorFlowNode,
	FlowCanvas,
	type ScriptFlowNode,
} from "@/components/canvas/flow-canvas";
import { Inspector } from "@/components/inspector/inspector";
import { AssetEditorModal } from "@/components/modals/asset-editor-modal";
import { ExportWizardModal } from "@/components/modals/export-wizard-modal";
import { HelpModal } from "@/components/modals/help-modal";
import { NodeFinderModal } from "@/components/modals/node-finder-modal";
import { ProjectSettingsModal } from "@/components/modals/project-settings-modal";
import { SimulationMessageBoxDialog } from "@/components/modals/simulation-message-box-dialog";
import { VerificationErrorModal } from "@/components/modals/verification-error-modal";
import { VerificationModal } from "@/components/modals/verification-modal";
import { SaveRecoveryDialog } from "@/components/projects/save-recovery-dialog";
import { UnsavedChangesDialog } from "@/components/projects/unsaved-changes-dialog";
import { BlockLibrary } from "@/components/shell/block-library";
import { type BottomPanelTab, OutputConsole } from "@/components/shell/output-console";
import { ResizeHandle } from "@/components/shell/resize-handle";
import { StatusBar } from "@/components/shell/status-bar";
import { TopBar } from "@/components/shell/top-bar";
import { Toaster } from "@/components/ui/sonner";
import { defaultEditorEdgeStyle, type EditorEdgeStyle, toReactFlowEdgeType } from "@/data/editor/flow-canvas";
import { createSwitchOutputPorts, getSwitchCaseRowsFromValue } from "@/data/nodes/definitions/rows";
import { createDevelopmentEditorNodes, isDevelopmentGraphEnabled } from "@/data/nodes/development-graph";
import { createNodeFromPaletteItem, getFlatPaletteItems, getRuntimeDataOutputs } from "@/data/nodes/registry";
import { getScriptSettingSimulationProblems } from "@/data/project/script-settings";
import { createSimulationSecretValues, getSecretSimulationProblems } from "@/data/project/secrets";
import { getProjectHistoryCoalesceKey } from "@/data/projects/history";
import type { EditorProject } from "@/data/projects/model";
import { projectContentSignature } from "@/data/projects/serialization";
import { useDocumentHistory } from "@/hooks/use-document-history";
import { useEditorPanelSizes } from "@/hooks/use-editor-panel-sizes";
import { useEditorShortcuts } from "@/hooks/use-editor-shortcuts";
import { useProjectSaveLifecycle } from "@/hooks/use-project-save-lifecycle";
import type {
	CommentNodeData,
	DefaultVariable,
	EditorAsset,
	InspectorTab,
	JsonValue,
	LogEntry,
	PaletteItem,
	ProjectSettings,
	ScriptSetting,
	SecretDeclaration,
	SimulationOverride,
	SimulationOverrideOutcome,
	SimulationRunStatus,
	SimulationSettings,
	SimulationTraceEntry,
	SimulationTriggerInputDraft,
	SimulationTriggerPayload,
	SimulationVariableSnapshot,
} from "@/lib/types";
import { DEFAULT_MINIMUM_RUNNER_VERSION } from "@/lib/version";
import {
	calculateCapabilities,
	calculatePermissions,
	calculateRiskLevel,
	createConsoleLogs,
	createExportSummary,
} from "@/utils/analysis";
import { buildBbsPackage } from "@/utils/bbs-package";
import {
	createEditorVerificationSignature,
	createGraphFragment,
	createGraphFragmentCopy,
	createGraphNodeCopy,
	DUPLICATE_OFFSET,
	type GraphFragment,
	getCenteredScriptNodePosition,
	hasManualTrigger,
	normalizeEdgeExecutionOrders,
	reorderEdgeExecutionGroup,
} from "@/utils/editor-graph";
import { truncateLogEntry, truncateSimulationTrace } from "@/utils/editor-log";
import { createVariablePanelEntries } from "@/utils/editor-variables";
import {
	createSimulationRun,
	type SimulationSideEffect,
	type SimulationSideEffectResult,
	type SimulationStep,
} from "@/utils/simulation";
import { getSimulationStepDelay, getSimulationTriggers } from "@/utils/simulation-settings";
import { executeSimulationSideEffects } from "@/utils/simulation-side-effects";
import { renameVariableReferences, type VariableRename } from "@/utils/variable-reference-renaming";
import {
	createVerificationChecks,
	getVerificationFindings,
	summarizeVerification,
	type VerificationCheck,
	type VerificationStatus,
} from "@/utils/verification";

type EditorClipboard = {
	fragment: GraphFragment<EditorFlowNode, Edge>;
	type: "graph";
};

type VerificationRecord = {
	signature: string | null;
	status: VerificationStatus;
};

type VerificationErrorDialog = {
	checks: VerificationCheck[];
	description: string;
	open: boolean;
	title: string;
};

function renameNodeVariableReferences(
	nodes: EditorFlowNode[],
	rename: VariableRename,
	renameVariableOperationTarget: boolean,
) {
	return nodes.map((node) => {
		if (!isScriptFlowNode(node)) {
			return node;
		}

		let config = renameVariableReferences(node.data.config, rename) as Record<string, JsonValue>;
		if (
			renameVariableOperationTarget &&
			node.data.actionType === "runtime.set_variable" &&
			config.name === rename.from
		) {
			config = { ...config, name: rename.to };
		}

		if (config === node.data.config) {
			return node;
		}

		return {
			...node,
			data: {
				...node.data,
				config,
				runtimeOutputs: getRuntimeDataOutputs(node.data.actionType, config),
			},
		};
	});
}

function createVerificationLogEntries(prefix: string, checks: VerificationCheck[]): SimulationTraceEntry[] {
	const summary = summarizeVerification(checks);
	const level: SimulationTraceEntry["level"] =
		summary.status === "failed" ? "error" : summary.status === "warning" ? "warn" : "info";
	const findings = getVerificationFindings(checks);
	return findings.length > 0
		? findings.map((message) => ({ level, message: `${prefix}: ${message}` }))
		: [{ level, message: `${prefix}: all checks passed.` }];
}

type SimulationMessageBoxState = Extract<SimulationSideEffect, { type: "message_box" }> | null;

type SimulationLifecycle = {
	abortController: AbortController | null;
	active: boolean;
	runId: number;
};

const MAX_OUTPUT_LOG_ENTRIES = 800;
const MAX_SIMULATION_LOG_ENTRIES = 800;
const paletteItemByActionType: ReadonlyMap<string, PaletteItem> = new Map(
	getFlatPaletteItems().map((item) => [item.actionType, item]),
);
export function EditorPage({
	initialProject,
	onDirtyChange,
}: {
	initialProject: EditorProject;
	onDirtyChange?: (dirty: boolean) => void;
}) {
	const router = useRouter();
	const handleCopyGraphRef = useRef<(nodeId?: string) => boolean>(() => false);
	const nodeFocusRequestIdRef = useRef(0);
	const simulationLifecycleRef = useRef<SimulationLifecycle>({ abortController: null, active: false, runId: 0 });
	const simulationMessageBoxResolveRef = useRef<((button: string) => void) | null>(null);
	const simulationPersistentVariablesRef = useRef<Record<string, JsonValue>>(
		Object.fromEntries(
			initialProject.defaultVariables
				.filter((variable) => variable.scope === "persistent")
				.map((variable) => [variable.name, structuredClone(variable.value)]),
		),
	);
	const simulationGlobalVariablesRef = useRef<Record<string, JsonValue>>({});
	const initialNodes = useMemo<EditorFlowNode[]>(
		() => [
			...(initialProject.nodes as ScriptFlowNode[]),
			...initialProject.comments.map((comment) => toCommentFlowNode(comment)),
		],
		[initialProject],
	);
	const initialEdges = useMemo(
		() =>
			initialProject.edges.map((edge) => ({
				...edge,
				type: toReactFlowEdgeType(initialProject.edgeStyle),
				style: undefined,
			})),
		[initialProject],
	);
	const [persistedProject, setPersistedProject] = useState(initialProject);
	const [projectSettings, setProjectSettings] = useState<ProjectSettings>(initialProject.settings);
	const [activeTab, setActiveTab] = useState<InspectorTab>("properties");
	const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
	const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
	const [bottomPanelTab, setBottomPanelTab] = useState<BottomPanelTab>("system");
	const [verificationOpen, setVerificationOpen] = useState(false);
	const [verificationRecord, setVerificationRecord] = useState<VerificationRecord>({
		signature: null,
		status: "unverified",
	});
	const [verificationErrorDialog, setVerificationErrorDialog] = useState<VerificationErrorDialog>({
		checks: [],
		description: "",
		open: false,
		title: "",
	});
	const [projectSettingsOpen, setProjectSettingsOpen] = useState(false);
	const [assetEditorOpen, setAssetEditorOpen] = useState(false);
	const [helpOpen, setHelpOpen] = useState(false);
	const [nodeFinderOpen, setNodeFinderOpen] = useState(false);
	const [nodeFocusRequest, setNodeFocusRequest] = useState<CanvasNodeFocusRequest | null>(null);
	const [exportOpen, setExportOpen] = useState(false);
	const [clipboard, setClipboard] = useState<EditorClipboard | null>(null);
	const [assets, setAssets] = useState<EditorAsset[]>(initialProject.assets);
	const [defaultVariables, setDefaultVariables] = useState<DefaultVariable[]>(initialProject.defaultVariables);
	const [secretDeclarations, setSecretDeclarations] = useState<SecretDeclaration[]>(initialProject.secretDeclarations);
	const [scriptSettings, setScriptSettings] = useState<ScriptSetting[]>(initialProject.scriptSettings);
	const [simulationSecretValues, setSimulationSecretValues] = useState<Record<string, string>>({});
	const [edgeStyle, setEdgeStyle] = useState<EditorEdgeStyle>(initialProject.edgeStyle ?? defaultEditorEdgeStyle);
	const [viewportCenter, setViewportCenter] = useState<XYPosition | null>(null);
	const [bottomPanelFollow, setBottomPanelFollow] = useState({
		system: true,
		output: true,
		simulation: true,
	});
	const [simulationSettings, setSimulationSettings] = useState<SimulationSettings>({
		speed: "instant",
	});
	const [simulationOverrides, setSimulationOverrides] = useState<SimulationOverride[]>([]);
	const [simulationTriggerInputDrafts, setSimulationTriggerInputDrafts] = useState<
		Record<string, SimulationTriggerInputDraft>
	>({});
	const [simulationStatus, setSimulationStatus] = useState<SimulationRunStatus>("idle");
	const [activeScheduleTriggerId, setActiveScheduleTriggerId] = useState<string | null>(null);
	const [simulationLogs, setSimulationLogs] = useState<SimulationTraceEntry[]>([]);
	const [simulationEdgeIds, setSimulationEdgeIds] = useState<ReadonlySet<string>>(() => new Set());
	const [simulationNodeIds, setSimulationNodeIds] = useState<ReadonlySet<string>>(() => new Set());
	const [simulationVariables, setSimulationVariables] = useState<SimulationVariableSnapshot[]>([]);
	const [simulationMessageBox, setSimulationMessageBox] = useState<SimulationMessageBoxState>(null);
	const [systemLogs, setSystemLogs] = useState<LogEntry[]>(() =>
		createConsoleLogs(
			initialProject.settings.name,
			initialProject.settings.targetRuntimes,
			calculatePermissions(initialNodes.filter(isScriptFlowNode)),
		),
	);
	const [logs, setLogs] = useState<LogEntry[]>([]);
	const [nodes, setNodes, onNodesChange] = useNodesState<EditorFlowNode>(initialNodes);
	const [edges, setEdges] = useEdgesState<Edge>(initialEdges);
	const { collapsed, expandPanel, sizes, startResize, togglePanel } = useEditorPanelSizes();

	const scriptNodes = useMemo(() => nodes.filter(isScriptFlowNode), [nodes]);
	const comments = useMemo(() => nodes.filter(isCommentFlowNode).map(toEditorComment), [nodes]);

	const selectedNode = useMemo(
		() => scriptNodes.find((node) => node.id === selectedNodeId) ?? null,
		[scriptNodes, selectedNodeId],
	);
	const selectedEdge = useMemo(() => edges.find((edge) => edge.id === selectedEdgeId) ?? null, [edges, selectedEdgeId]);
	const handleEdgesChange = useCallback(
		(changes: EdgeChange<Edge>[]) => {
			setEdges((currentEdges) => normalizeEdgeExecutionOrders(applyEdgeChanges(changes, currentEdges)));
		},
		[setEdges],
	);
	const permissions = useMemo(
		() => calculatePermissions(scriptNodes, secretDeclarations, defaultVariables),
		[scriptNodes, secretDeclarations, defaultVariables],
	);
	const capabilities = useMemo(
		() => calculateCapabilities(scriptNodes, secretDeclarations, defaultVariables),
		[scriptNodes, secretDeclarations, defaultVariables],
	);
	const riskLevel = useMemo(() => calculateRiskLevel(permissions), [permissions]);
	const exportSummary = useMemo(
		() =>
			createExportSummary(
				projectSettings.name,
				projectSettings.version,
				projectSettings.targetRuntimes,
				projectSettings.minimumRunnerVersion,
				assets,
			),
		[
			assets,
			projectSettings.minimumRunnerVersion,
			projectSettings.name,
			projectSettings.targetRuntimes,
			projectSettings.version,
		],
	);
	const verificationChecks = useMemo(
		() =>
			createVerificationChecks({
				assets,
				edges,
				nodes: scriptNodes,
				permissions,
				defaultVariables,
				secretDeclarations,
				scriptName: projectSettings.name,
				targetRuntimes: projectSettings.targetRuntimes,
			}),
		[
			assets,
			defaultVariables,
			edges,
			scriptNodes,
			permissions,
			projectSettings.name,
			projectSettings.targetRuntimes,
			secretDeclarations,
		],
	);
	const verificationSignature = useMemo(
		() =>
			createEditorVerificationSignature(
				projectSettings,
				scriptNodes,
				edges,
				assets,
				secretDeclarations,
				defaultVariables,
			),
		[projectSettings, scriptNodes, edges, assets, secretDeclarations, defaultVariables],
	);
	const variableEntries = useMemo(
		() =>
			createVariablePanelEntries(
				projectSettings,
				scriptNodes,
				simulationVariables,
				secretDeclarations,
				defaultVariables,
				scriptSettings,
			),
		[projectSettings, scriptNodes, simulationVariables, secretDeclarations, defaultVariables, scriptSettings],
	);
	const normalizedProjectSettings = {
		...projectSettings,
		name: projectSettings.name.trim() || "untitled-script",
		version: projectSettings.version.trim(),
		repositoryUrl: projectSettings.repositoryUrl.trim(),
		minimumRunnerVersion: projectSettings.minimumRunnerVersion.trim() || DEFAULT_MINIMUM_RUNNER_VERSION,
	};
	const currentProject = useMemo<EditorProject>(
		() => ({
			assets,
			comments,
			defaultVariables,
			edgeStyle,
			edges,
			identity: persistedProject.identity,
			nodes: scriptNodes,
			revision: persistedProject.revision,
			schemaVersion: persistedProject.schemaVersion,
			secretDeclarations,
			scriptSettings,
			settings: projectSettings,
			updatedAt: persistedProject.updatedAt,
		}),
		[
			assets,
			comments,
			defaultVariables,
			edgeStyle,
			edges,
			persistedProject,
			projectSettings,
			scriptNodes,
			secretDeclarations,
			scriptSettings,
		],
	);
	const currentSignature = useMemo(() => projectContentSignature(currentProject), [currentProject]);
	const returnToProjects = useCallback(() => router.push("/"), [router]);
	const projectSave = useProjectSaveLifecycle({
		currentProject,
		currentSignature,
		expectedRevision: persistedProject.revision,
		initialSavedSignature: projectContentSignature(initialProject),
		onCommitted: setPersistedProject,
		onDirtyChange,
		onReturn: returnToProjects,
	});

	const appendOutputLogs = useCallback((entries: LogEntry[]) => {
		setLogs((currentLogs) => [...currentLogs, ...entries.map(truncateLogEntry)].slice(-MAX_OUTPUT_LOG_ENTRIES));
	}, []);

	const appendSystemLogs = useCallback((entries: LogEntry[]) => {
		setSystemLogs((currentLogs) => [...currentLogs, ...entries.map(truncateLogEntry)].slice(-MAX_OUTPUT_LOG_ENTRIES));
	}, []);

	const appendSimulationLogs = useCallback((entries: SimulationTraceEntry[]) => {
		setSimulationLogs((currentLogs) =>
			[...currentLogs, ...entries.map(truncateSimulationTrace)].slice(-MAX_SIMULATION_LOG_ENTRIES),
		);
	}, []);

	const abortSimulationLifecycle = useCallback((reason: string) => {
		const lifecycle = simulationLifecycleRef.current;
		lifecycle.abortController?.abort(reason);
		lifecycle.abortController = null;
		lifecycle.active = false;
		lifecycle.runId += 1;
		setActiveScheduleTriggerId(null);
	}, []);

	const restoreDocument = useCallback(
		(project: EditorProject) => {
			abortSimulationLifecycle("history restored");
			setProjectSettings(project.settings);
			setAssets(project.assets);
			setDefaultVariables(project.defaultVariables);
			setSecretDeclarations(project.secretDeclarations);
			setScriptSettings(project.scriptSettings);
			setEdgeStyle(project.edgeStyle);
			setNodes([
				...(project.nodes as ScriptFlowNode[]),
				...project.comments.map((comment) => toCommentFlowNode(comment)),
			]);
			setEdges(
				project.edges.map((edge) => ({
					...edge,
					type: toReactFlowEdgeType(project.edgeStyle),
					style: undefined,
				})),
			);
			setSelectedNodeId(null);
			setSelectedEdgeId(null);
			setSimulationEdgeIds(new Set());
			setSimulationNodeIds(new Set());
		},
		[abortSimulationLifecycle, setEdges, setNodes],
	);
	const history = useDocumentHistory({
		getCoalesceKey: getProjectHistoryCoalesceKey,
		signature: currentSignature,
		value: currentProject,
		onRestore: restoreDocument,
	});
	const handleCopyShortcut = useCallback(() => handleCopyGraphRef.current(), []);
	const handleOpenNodeFinder = useCallback(() => setNodeFinderOpen(true), []);
	const handleSaveShortcut = useCallback(() => void projectSave.save(), [projectSave.save]);
	useEditorShortcuts({
		onCopy: handleCopyShortcut,
		onFind: handleOpenNodeFinder,
		onRedo: history.redo,
		onSave: handleSaveShortcut,
		onUndo: history.undo,
	});

	const startSimulationLifecycle = useCallback((abortController: AbortController) => {
		const lifecycle = simulationLifecycleRef.current;
		lifecycle.abortController = abortController;
		lifecycle.active = true;
		lifecycle.runId += 1;
		return lifecycle.runId;
	}, []);

	const completeSimulationLifecycle = useCallback((runId: number) => {
		const lifecycle = simulationLifecycleRef.current;
		if (lifecycle.runId !== runId) {
			return;
		}

		lifecycle.abortController = null;
		lifecycle.active = false;
		setActiveScheduleTriggerId(null);
	}, []);

	useEffect(() => {
		const disableNativeContextMenu = (event: MouseEvent) => event.preventDefault();

		document.addEventListener("contextmenu", disableNativeContextMenu);

		return () => document.removeEventListener("contextmenu", disableNativeContextMenu);
	}, []);

	useEffect(() => {
		return () => {
			abortSimulationLifecycle("editor unmounted");
		};
	}, [abortSimulationLifecycle]);

	useEffect(() => {
		setVerificationRecord((currentRecord) => {
			if (!currentRecord.signature || currentRecord.signature === verificationSignature) {
				return currentRecord;
			}

			return { signature: null, status: "unverified" };
		});
		setSimulationStatus("idle");
		setSimulationEdgeIds(new Set());
		setSimulationNodeIds(new Set());
		setSimulationVariables([]);
		abortSimulationLifecycle("graph changed");
	}, [abortSimulationLifecycle, verificationSignature]);

	useEffect(() => {
		const nodeIds = new Set(scriptNodes.map((node) => node.id));
		setSimulationOverrides((currentOverrides) => currentOverrides.filter((override) => nodeIds.has(override.nodeId)));
	}, [scriptNodes]);

	useEffect(() => {
		const currentValues = simulationPersistentVariablesRef.current;
		simulationPersistentVariablesRef.current = Object.fromEntries(
			defaultVariables
				.filter((variable) => variable.scope === "persistent")
				.map((variable) => [
					variable.name,
					variable.name in currentValues ? currentValues[variable.name] : structuredClone(variable.value),
				]),
		);
	}, [defaultVariables]);

	const handleExport = () => {
		setExportOpen(true);
	};

	const handlePrepareExport = async () => {
		return buildBbsPackage({
			identity: persistedProject.identity,
			projectSettings: normalizedProjectSettings,
			nodes: scriptNodes,
			edges,
			assets,
			comments,
			edgeStyle,
			secretDeclarations,
			defaultVariables,
			scriptSettings,
		});
	};

	const handleExportVerificationComplete = useCallback(
		(summary: ReturnType<typeof summarizeVerification>) => {
			setVerificationRecord({ signature: verificationSignature, status: summary.status });
			appendSystemLogs(createVerificationLogEntries("Export verification", verificationChecks));
			expandPanel("bottom");
		},
		[appendSystemLogs, expandPanel, verificationChecks, verificationSignature],
	);

	const handleVerify = () => {
		const summary = summarizeVerification(verificationChecks);
		setVerificationRecord({ signature: verificationSignature, status: summary.status });
		setVerificationOpen(true);
		appendSystemLogs(createVerificationLogEntries("Verification", verificationChecks));
		expandPanel("bottom");
	};

	const showSimulationMessageBox = useCallback(
		(sideEffect: Extract<SimulationSideEffect, { type: "message_box" }>, signal: AbortSignal) =>
			new Promise<string>((resolve) => {
				if (signal.aborted) {
					resolve("aborted");
					return;
				}

				simulationMessageBoxResolveRef.current?.("replaced");
				const finish = (button: string) => {
					signal.removeEventListener("abort", handleAbort);
					if (simulationMessageBoxResolveRef.current === finish) {
						simulationMessageBoxResolveRef.current = null;
					}
					setSimulationMessageBox(null);
					resolve(button);
				};
				const handleAbort = () => finish("aborted");

				simulationMessageBoxResolveRef.current = finish;
				setSimulationMessageBox(sideEffect);
				signal.addEventListener("abort", handleAbort, { once: true });
			}),
		[],
	);

	const handleSimulationMessageBoxSelect = useCallback((button: string) => {
		const resolve = simulationMessageBoxResolveRef.current;
		simulationMessageBoxResolveRef.current = null;
		setSimulationMessageBox(null);
		resolve?.(button);
	}, []);

	const handleSimulationStep = useCallback(
		async (step: SimulationStep, runId: number, signal: AbortSignal): Promise<SimulationSideEffectResult[]> => {
			if (simulationLifecycleRef.current.runId !== runId || signal.aborted) {
				return [];
			}

			let sideEffectResults: SimulationSideEffectResult[] = [];
			if (step.sideEffects.length > 0) {
				const sideEffectResult = await executeSimulationSideEffects(step.sideEffects, assets, signal, {
					showMessageBox: showSimulationMessageBox,
				});
				sideEffectResults = sideEffectResult.results;
				const sideEffectErrors = sideEffectResult.traces;
				if (sideEffectErrors.length > 0) {
					appendSimulationLogs(sideEffectErrors);
				}
			}
			if (step.outputLogs.length > 0) {
				appendOutputLogs(step.outputLogs);
			}
			if (step.traces.length > 0) {
				appendSimulationLogs(step.traces);
			}
			if (step.traversedEdgeIds.length > 0) {
				setSimulationEdgeIds((currentEdgeIds) => {
					const nextEdgeIds = new Set(currentEdgeIds);
					for (const edgeId of step.traversedEdgeIds) {
						nextEdgeIds.add(edgeId);
					}
					return nextEdgeIds;
				});
				setSimulationNodeIds((currentNodeIds) => {
					const nextNodeIds = new Set(currentNodeIds);
					for (const edgeId of step.traversedEdgeIds) {
						const traversedEdge = edges.find((edge) => edge.id === edgeId);
						if (traversedEdge) {
							nextNodeIds.add(traversedEdge.source);
							nextNodeIds.add(traversedEdge.target);
						}
					}
					return nextNodeIds;
				});
			}
			setSimulationVariables(step.variables);
			return sideEffectResults;
		},
		[appendOutputLogs, appendSimulationLogs, assets, edges, showSimulationMessageBox],
	);

	const runSimulationTrigger = useCallback(
		async ({
			abortController,
			keepWaiting,
			payload,
			runId,
			triggerNodeId,
		}: {
			abortController: AbortController;
			keepWaiting: boolean;
			payload: SimulationTriggerPayload;
			runId: number;
			triggerNodeId: string;
		}) => {
			setSimulationEdgeIds(new Set());
			setSimulationNodeIds(new Set());
			const secretProblems = getSecretSimulationProblems(secretDeclarations, simulationSecretValues);
			const settingProblems = getScriptSettingSimulationProblems(scriptSettings);
			if (secretProblems.length > 0 || settingProblems.length > 0) {
				setSimulationStatus("failed");
				appendSimulationLogs(
					[...secretProblems, ...settingProblems].map((message) => ({
						level: "error",
						message: `[Simulation] ${message}`,
					})),
				);
				completeSimulationLifecycle(runId);
				return;
			}
			setSimulationStatus("running");
			setSimulationNodeIds(new Set([triggerNodeId]));

			try {
				const run = await createSimulationRun({
					assets,
					nodes: scriptNodes,
					edges,
					overrides: simulationOverrides,
					projectSettings,
					defaultVariables,
					scriptSettings,
					globalVariables: simulationGlobalVariablesRef.current,
					persistentVariables: simulationPersistentVariablesRef.current,
					secretValues: createSimulationSecretValues(secretDeclarations, simulationSecretValues),
					signal: abortController.signal,
					stepDelayMs: getSimulationStepDelay(simulationSettings.speed),
					triggerNodeId,
					triggerPayload: payload,
					onStep: (step) => handleSimulationStep(step, runId, abortController.signal),
				});
				if (simulationLifecycleRef.current.runId !== runId) {
					return;
				}

				simulationGlobalVariablesRef.current = run.globalVariables;
				simulationPersistentVariablesRef.current = run.persistentVariables;
				setSimulationVariables(run.finalVariables);
				setSimulationStatus(abortController.signal.aborted ? "stopped" : keepWaiting ? "waiting" : run.status);
				if (keepWaiting && !abortController.signal.aborted) {
					appendSimulationLogs([{ level: "info", message: "[Simulation] Waiting for the next trigger input." }]);
				}
			} finally {
				if (simulationLifecycleRef.current.runId === runId && !keepWaiting) {
					completeSimulationLifecycle(runId);
				}
			}
		},
		[
			appendSimulationLogs,
			assets,
			completeSimulationLifecycle,
			edges,
			handleSimulationStep,
			projectSettings,
			defaultVariables,
			secretDeclarations,
			scriptSettings,
			scriptNodes,
			simulationSecretValues,
			simulationOverrides,
			simulationSettings.speed,
		],
	);

	const startSimulationSession = useCallback(
		(initialLogs: SimulationTraceEntry[] = []) => {
			const currentLifecycle = simulationLifecycleRef.current;
			if (currentLifecycle.active && currentLifecycle.abortController) {
				return currentLifecycle;
			}

			const triggerNodes = getSimulationTriggers(scriptNodes);
			if (triggerNodes.length === 0) {
				setVerificationErrorDialog({
					open: true,
					title: "Simulation Blocked",
					description: "Add at least one trigger node before starting simulation.",
					checks: [
						{
							id: "simulation-trigger",
							title: "Simulation Trigger",
							description: "Checking selected simulation triggers.",
							outcome: "failed",
							message: "No trigger nodes are available.",
						},
					],
				});
				appendSystemLogs([{ level: "error", message: "Simulation blocked: no trigger nodes are available." }]);
				appendSimulationLogs([
					{ level: "error", message: "[Simulation] Simulation blocked: no trigger nodes are available." },
				]);
				expandPanel("bottom");
				return null;
			}

			const abortController = new AbortController();
			const runId = startSimulationLifecycle(abortController);
			expandPanel("bottom");
			setSimulationStatus("waiting");
			setSimulationLogs([
				...initialLogs,
				{
					level: "info",
					message: `[Simulation] Waiting for input from ${triggerNodes.length} trigger${triggerNodes.length === 1 ? "" : "s"}. Start a Schedule trigger from its simulator card when you want to test its interval.`,
				},
			]);
			setSimulationVariables([]);
			return { abortController, active: true, runId };
		},
		[appendSimulationLogs, appendSystemLogs, expandPanel, scriptNodes, startSimulationLifecycle],
	);

	const startVerifiedSimulationSession = useCallback(() => {
		const currentLifecycle = simulationLifecycleRef.current;
		if (currentLifecycle.active && currentLifecycle.abortController) {
			return currentLifecycle;
		}

		const summary = summarizeVerification(verificationChecks);
		const verificationLogs = createVerificationLogEntries("[Simulation] Verification", verificationChecks);

		setVerificationRecord({ signature: verificationSignature, status: summary.status });
		appendSystemLogs(createVerificationLogEntries("Simulation verification", verificationChecks));

		if (summary.status === "failed") {
			setVerificationErrorDialog({
				open: true,
				title: "Simulation Blocked",
				description: "The current script failed verification and cannot be simulated.",
				checks: verificationChecks,
			});
			appendSimulationLogs([
				...verificationLogs,
				{
					level: "error",
					message: "[Simulation] Simulation was blocked because the verification findings listed above must be fixed.",
				},
			]);
			expandPanel("bottom");
			return null;
		}

		return startSimulationSession(verificationLogs);
	}, [
		appendSimulationLogs,
		appendSystemLogs,
		expandPanel,
		startSimulationSession,
		verificationChecks,
		verificationSignature,
	]);

	const handleTriggerSimulation = useCallback(
		(triggerNodeId: string, payload: SimulationTriggerPayload) => {
			if (simulationStatus === "running") {
				appendSimulationLogs([
					{
						level: "warn",
						message: "[Simulation] A trigger is already running. Stop it before firing another trigger.",
					},
				]);
				expandPanel("bottom");
				return;
			}

			const lifecycle = startVerifiedSimulationSession();
			if (!lifecycle?.abortController) {
				return;
			}

			void runSimulationTrigger({
				abortController: lifecycle.abortController,
				keepWaiting: true,
				payload,
				runId: lifecycle.runId,
				triggerNodeId,
			});
		},
		[appendSimulationLogs, expandPanel, runSimulationTrigger, simulationStatus, startVerifiedSimulationSession],
	);

	const handleStartScheduleSimulation = useCallback(
		(triggerNodeId: string) => {
			if (activeScheduleTriggerId && activeScheduleTriggerId !== triggerNodeId) {
				appendSimulationLogs([
					{
						level: "warn",
						message: "[Simulation] Stop the active schedule before starting another schedule.",
					},
				]);
				expandPanel("bottom");
				return;
			}
			if (simulationStatus === "running") {
				appendSimulationLogs([
					{
						level: "warn",
						message: "[Simulation] Wait for the active trigger to finish before starting a schedule.",
					},
				]);
				expandPanel("bottom");
				return;
			}

			const lifecycle = startVerifiedSimulationSession();
			if (!lifecycle?.abortController) {
				return;
			}

			setActiveScheduleTriggerId(triggerNodeId);
			appendSimulationLogs([
				{
					level: "info",
					message: `[Simulation] Schedule ${triggerNodeId} started. The first trigger will run after its configured interval.`,
				},
			]);
		},
		[activeScheduleTriggerId, appendSimulationLogs, expandPanel, simulationStatus, startVerifiedSimulationSession],
	);

	const handleStopScheduleSimulation = useCallback(
		(triggerNodeId: string) => {
			if (activeScheduleTriggerId !== triggerNodeId) {
				return;
			}

			abortSimulationLifecycle("schedule stopped by user");
			setSimulationStatus("stopped");
			appendSimulationLogs([{ level: "info", message: `[Simulation] Schedule ${triggerNodeId} stopped.` }]);
		},
		[abortSimulationLifecycle, activeScheduleTriggerId, appendSimulationLogs],
	);

	const handleStopSimulation = () => {
		if (!simulationLifecycleRef.current.active) {
			return;
		}

		abortSimulationLifecycle("stopped by user");
		setSimulationStatus("stopped");
		appendSimulationLogs([{ level: "warn", message: "[Simulation] Stop requested by user." }]);
	};

	const handleSaveProjectSettings = (settings: ProjectSettings) => {
		setProjectSettings(settings);
		appendSystemLogs([
			{
				level: "info",
				message: `Project settings saved: ${settings.name} (${settings.targetRuntimes.join(", ")})`,
			},
		]);
		expandPanel("bottom");
	};

	const handleAssetsChange = (nextAssets: EditorAsset[]) => {
		setAssets(nextAssets);
		appendSystemLogs([
			{
				level: "info",
				message: `Assets updated: ${nextAssets.length} file${nextAssets.length === 1 ? "" : "s"} attached.`,
			},
		]);
		expandPanel("bottom");
	};

	const handleAddSimulationOverride = (nodeId: string) => {
		if (!nodeId) {
			return;
		}

		setSimulationOverrides((currentOverrides) => {
			if (currentOverrides.some((override) => override.nodeId === nodeId)) {
				return currentOverrides;
			}

			return [...currentOverrides, { nodeId, outcome: "failed" }];
		});
	};

	const handleUpdateSimulationOverride = (nodeId: string, outcome: SimulationOverrideOutcome) => {
		setSimulationOverrides((currentOverrides) =>
			currentOverrides.map((override) => (override.nodeId === nodeId ? { ...override, outcome } : override)),
		);
	};

	const handleRemoveSimulationOverride = (nodeId: string) => {
		setSimulationOverrides((currentOverrides) => currentOverrides.filter((override) => override.nodeId !== nodeId));
	};

	const showManualTriggerLimitError = () => {
		setVerificationErrorDialog({
			open: true,
			title: "Manual Trigger Already Exists",
			description: "A script can only contain one Manual Trigger node.",
			checks: [
				{
					id: "manual-trigger-limit",
					title: "Manual Trigger Limit",
					description: "Checking manual trigger count before creating the node.",
					outcome: "failed",
					message: "Remove the existing Manual Trigger before adding another one.",
				},
			],
		});
		appendSystemLogs([
			{ level: "error", message: "Manual Trigger was not added: only one Manual Trigger is allowed." },
		]);
		expandPanel("bottom");
	};

	const handleClearBottomPanelTab = (tab: Exclude<BottomPanelTab, "variables">) => {
		if (tab === "system") {
			setSystemLogs([]);
			return;
		}

		if (tab === "output") {
			setLogs([]);
			return;
		}

		if (tab === "simulation") {
			setSimulationLogs([]);
			setSimulationVariables([]);
		}
	};

	const handleResetStoredSimulationValues = useCallback(() => {
		abortSimulationLifecycle("stored simulation values reset");
		const persistentVariables = Object.fromEntries(
			defaultVariables
				.filter((variable) => variable.scope === "persistent")
				.map((variable) => [variable.name, structuredClone(variable.value)]),
		);

		simulationPersistentVariablesRef.current = persistentVariables;
		simulationGlobalVariablesRef.current = {};
		setSimulationStatus("idle");
		setSimulationVariables((currentVariables) => [
			...currentVariables.filter((variable) => variable.source !== "persistent" && variable.source !== "global"),
			...Object.entries(persistentVariables).map(([name, value]) => ({
				name,
				source: "persistent" as const,
				value,
			})),
		]);
		appendSystemLogs([
			{
				level: "info",
				message: "Reset simulated persistent values to their defaults and cleared simulated global values.",
			},
		]);
	}, [abortSimulationLifecycle, appendSystemLogs, defaultVariables]);

	const handleDefaultVariablesChange = useCallback(
		(nextVariables: DefaultVariable[], renames: VariableRename[] = []) => {
			if (renames.length > 0) {
				setNodes((currentNodes) =>
					renames.reduce((nextNodes, rename) => renameNodeVariableReferences(nextNodes, rename, true), currentNodes),
				);

				for (const rename of renames) {
					const nextDeclaration = nextVariables.find((variable) => variable.name === rename.to);
					const currentStoredValues = simulationPersistentVariablesRef.current;
					const nextStoredValues = { ...currentStoredValues };
					const previousStoredValue = currentStoredValues[rename.from];
					const hadStoredValue = Object.hasOwn(currentStoredValues, rename.from);
					delete nextStoredValues[rename.from];
					if (nextDeclaration?.scope === "persistent") {
						nextStoredValues[rename.to] = hadStoredValue ? previousStoredValue : structuredClone(nextDeclaration.value);
					}
					simulationPersistentVariablesRef.current = nextStoredValues;

					appendSystemLogs([
						{
							level: "info",
							message: `Renamed default variable "${rename.from}" to "${rename.to}" and updated its node references.`,
						},
					]);
				}
			}

			setDefaultVariables(nextVariables);
		},
		[appendSystemLogs, setNodes],
	);

	const handleSecretDeclarationsChange = useCallback(
		(nextDeclarations: SecretDeclaration[], renames: VariableRename[] = []) => {
			if (renames.length > 0) {
				setNodes((currentNodes) =>
					renames.reduce((nextNodes, rename) => renameNodeVariableReferences(nextNodes, rename, false), currentNodes),
				);
				appendSystemLogs(
					renames.map((rename) => ({
						level: "info" as const,
						message: `Renamed secret reference "${rename.from}" to "${rename.to}" and updated its node references.`,
					})),
				);
			}

			setSecretDeclarations(nextDeclarations);
		},
		[appendSystemLogs, setNodes],
	);

	const handleScriptSettingsChange = useCallback(
		(nextSettings: ScriptSetting[], renames: VariableRename[] = []) => {
			if (renames.length > 0) {
				setNodes((currentNodes) =>
					renames.reduce((nextNodes, rename) => renameNodeVariableReferences(nextNodes, rename, false), currentNodes),
				);
				appendSystemLogs(
					renames.map((rename) => ({
						level: "info" as const,
						message: `Renamed Script Setting "${rename.from}" to "${rename.to}" and updated its node references.`,
					})),
				);
			}
			setScriptSettings(nextSettings);
		},
		[appendSystemLogs, setNodes],
	);

	const handleFollowBottomPanelTab = (tab: Exclude<BottomPanelTab, "variables">, enabled: boolean) => {
		setBottomPanelFollow((currentFollow) => ({ ...currentFollow, [tab]: enabled }));
	};

	const handleEdgeStyleChange = (nextEdgeStyle: EditorEdgeStyle) => {
		setEdgeStyle(nextEdgeStyle);
		setEdges((currentEdges) =>
			currentEdges.map((edge) => ({
				...edge,
				type: toReactFlowEdgeType(nextEdgeStyle),
				style: undefined,
			})),
		);
	};

	const handleAddBlock = (item: PaletteItem, centerPosition = viewportCenter) => {
		if (item.actionType === "trigger.manual" && hasManualTrigger(scriptNodes)) {
			showManualTriggerLimitError();
			return;
		}

		const node = createNodeFromPaletteItem(item, scriptNodes.length, {
			position: centerPosition ? getCenteredScriptNodePosition(centerPosition) : undefined,
		}) as ScriptFlowNode;
		setNodes((currentNodes) => [
			...currentNodes.map((currentNode) => ({ ...currentNode, selected: false })),
			{ ...node, selected: true },
		]);
		setSelectedNodeId((currentNodeId) => (currentNodeId === node.id ? currentNodeId : node.id));
		setSelectedEdgeId((currentEdgeId) => (currentEdgeId === null ? currentEdgeId : null));
		setActiveTab("properties");
	};

	const handleDropPaletteNode = (actionType: string, position: XYPosition) => {
		const item = paletteItemByActionType.get(actionType);
		if (!item) {
			return;
		}

		handleAddBlock(item, position);
	};

	const handleCreateComment = (position: XYPosition) => {
		const commentNode = createCommentFlowNode({
			x: position.x - DEFAULT_COMMENT_SIZE.width / 2,
			y: position.y - 20,
		});

		setNodes((currentNodes) => [...currentNodes.map((node) => ({ ...node, selected: false })), commentNode]);
		setSelectedNodeId(null);
		setSelectedEdgeId(null);
	};

	const handleUpdateComment = (commentId: string, patch: Partial<CommentNodeData>) => {
		setNodes((currentNodes) => {
			let changed = false;
			const nextNodes = currentNodes.map((node) => {
				if (!isCommentFlowNode(node) || node.id !== commentId) {
					return node;
				}

				const nextData = { ...node.data, ...patch };
				if (areCommentNodeDataEqual(node.data, nextData)) {
					return node;
				}

				changed = true;
				return {
					...node,
					data: nextData,
					style: {
						...node.style,
						width: nextData.size.width,
						height: nextData.size.height,
					},
				};
			});

			return changed ? nextNodes : currentNodes;
		});
	};

	const handleDeleteComment = (commentId: string) => {
		setNodes((currentNodes) => currentNodes.filter((node) => node.id !== commentId));
	};

	const handleSpawnDevelopmentNodes = () => {
		const developmentNodes = createDevelopmentEditorNodes(viewportCenter ?? undefined);
		setNodes(developmentNodes as ScriptFlowNode[]);
		setEdges([]);
		setSelectedNodeId(null);
		setSelectedEdgeId(null);
		setActiveTab("properties");
		appendSystemLogs([
			{
				level: "info",
				message: `Development node grid spawned: ${developmentNodes.length} nodes.`,
			},
		]);
		expandPanel("bottom");
	};

	const handleUpdateNodeConfig = (nodeId: string, key: string, value: JsonValue) => {
		const nextSwitchOutputs = key === "cases" ? createSwitchOutputPorts(getSwitchCaseRowsFromValue(value)) : null;

		setNodes((currentNodes) =>
			currentNodes.map((node) => {
				if (!isScriptFlowNode(node) || node.id !== nodeId) {
					return node;
				}

				const outputs =
					node.data.actionType === "control.switch" && nextSwitchOutputs ? nextSwitchOutputs : node.data.outputs;

				const config = {
					...node.data.config,
					[key]: value,
				};

				return {
					...node,
					data: {
						...node.data,
						config,
						outputs,
						runtimeOutputs: getRuntimeDataOutputs(node.data.actionType, config),
					},
				};
			}),
		);

		if (nextSwitchOutputs) {
			const validOutputIds = new Set(nextSwitchOutputs.map((output) => output.id));
			setEdges((currentEdges) => {
				const remainingEdges = currentEdges.filter(
					(edge) => edge.source !== nodeId || validOutputIds.has(edge.sourceHandle ?? ""),
				);
				if (selectedEdgeId && !remainingEdges.some((edge) => edge.id === selectedEdgeId)) {
					setSelectedEdgeId(null);
				}

				return normalizeEdgeExecutionOrders(remainingEdges);
			});
		}
	};

	const handleDeleteNode = (nodeId: string) => {
		setNodes((currentNodes) => currentNodes.filter((node) => node.id !== nodeId));
		setEdges((currentEdges) => {
			const remainingEdges = currentEdges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId);
			if (selectedEdgeId && !remainingEdges.some((edge) => edge.id === selectedEdgeId)) {
				setSelectedEdgeId(null);
			}

			return normalizeEdgeExecutionOrders(remainingEdges);
		});

		if (selectedNodeId === nodeId) {
			setSelectedNodeId(null);
		}
	};

	const handleDeleteEdge = (edgeId: string) => {
		setEdges((currentEdges) => normalizeEdgeExecutionOrders(currentEdges.filter((edge) => edge.id !== edgeId)));
		if (selectedEdgeId === edgeId) {
			setSelectedEdgeId(null);
		}
	};

	const handleCopyGraph = (nodeId?: string) => {
		const selectedNodes = nodes.filter((node) => node.selected);
		const targetNode = nodeId ? nodes.find((node) => node.id === nodeId) : undefined;
		const nodesToCopy = targetNode && !targetNode.selected ? [targetNode] : selectedNodes;
		if (nodesToCopy.length === 0) {
			return false;
		}

		setClipboard({ type: "graph", fragment: createGraphFragment(nodesToCopy, edges) });
		return true;
	};
	const handleCopyNode = (nodeId: string) => {
		handleCopyGraph(nodeId);
	};

	const handleDuplicateNode = (nodeId: string) => {
		const node = nodes.find((currentNode) => currentNode.id === nodeId);
		if (!node) {
			return;
		}

		if (isScriptFlowNode(node) && node.data.actionType === "trigger.manual" && hasManualTrigger(scriptNodes)) {
			showManualTriggerLimitError();
			return;
		}

		const duplicatedNode = createGraphNodeCopy(node, {
			x: node.position.x + DUPLICATE_OFFSET,
			y: node.position.y + DUPLICATE_OFFSET,
		}) as EditorFlowNode;

		setNodes((currentNodes) => [...currentNodes, duplicatedNode]);
		setSelectedNodeId(isScriptFlowNode(duplicatedNode) ? duplicatedNode.id : null);
		setSelectedEdgeId(null);
		if (isScriptFlowNode(duplicatedNode)) {
			setActiveTab("properties");
		}
	};

	const handlePasteClipboard = (centerPosition: XYPosition) => {
		if (!clipboard) {
			return;
		}

		const clipboardScriptNodes = clipboard.fragment.nodes.filter(isScriptFlowNode);
		if (hasManualTrigger(clipboardScriptNodes) && hasManualTrigger(scriptNodes)) {
			showManualTriggerLimitError();
			return;
		}

		const pastedFragment = createGraphFragmentCopy(clipboard.fragment, centerPosition);
		setNodes((currentNodes) => [
			...currentNodes.map((node) => ({ ...node, selected: false })),
			...pastedFragment.nodes,
		]);
		setEdges((currentEdges) =>
			normalizeEdgeExecutionOrders([
				...currentEdges.map((edge) => ({ ...edge, selected: false })),
				...pastedFragment.edges,
			]),
		);
		setSelectedNodeId(pastedFragment.nodes.find(isScriptFlowNode)?.id ?? null);
		setSelectedEdgeId(null);
		if (pastedFragment.nodes.some(isScriptFlowNode)) {
			setActiveTab("properties");
		}
	};

	handleCopyGraphRef.current = handleCopyGraph;

	const handleNodesDelete = (deletedNodes: EditorFlowNode[]) => {
		const deletedNodeIds = new Set(deletedNodes.filter(isScriptFlowNode).map((node) => node.id));
		setEdges((currentEdges) =>
			normalizeEdgeExecutionOrders(
				currentEdges.filter((edge) => {
					const shouldDelete = deletedNodeIds.has(edge.source) || deletedNodeIds.has(edge.target);
					if (shouldDelete && edge.id === selectedEdgeId) {
						setSelectedEdgeId(null);
					}

					return !shouldDelete;
				}),
			),
		);

		if (selectedNodeId && deletedNodeIds.has(selectedNodeId)) {
			setSelectedNodeId(null);
		}
	};

	const handleEdgesDelete = (deletedEdges: Array<{ id: string }>) => {
		if (selectedEdgeId && deletedEdges.some((edge) => edge.id === selectedEdgeId)) {
			setSelectedEdgeId(null);
		}
	};

	const handleReorderEdges = (orderedEdgeIds: string[]) => {
		setEdges((currentEdges) => reorderEdgeExecutionGroup(currentEdges, orderedEdgeIds));
	};

	const handleSelectEdge = (edgeId: string | null) => {
		setSelectedEdgeId(edgeId);
		if (edgeId) {
			setActiveTab("properties");
		}
	};

	const handleFindNode = (nodeId: string) => {
		setNodes((currentNodes) =>
			currentNodes.map((node) => ({
				...node,
				selected: isScriptFlowNode(node) && node.id === nodeId,
			})),
		);
		setSelectedNodeId(nodeId);
		setSelectedEdgeId(null);
		setActiveTab("properties");
		expandPanel("right");
		nodeFocusRequestIdRef.current += 1;
		setNodeFocusRequest({ nodeId, requestId: nodeFocusRequestIdRef.current });
		setNodeFinderOpen(false);
	};

	return (
		<div className="flex h-dvh min-h-0 select-none flex-col overflow-hidden bg-baud-bg text-baud-text">
			<TopBar
				leftCollapsed={collapsed.left}
				leftWidth={sizes.left}
				rightCollapsed={collapsed.right}
				rightWidth={sizes.right}
				saveDisabled={!projectSave.hasUnsavedChanges || projectSave.saving}
				canRedo={history.canRedo}
				canUndo={history.canUndo}
				onAssetEditorClick={() => setAssetEditorOpen(true)}
				onExportClick={handleExport}
				onHomeClick={projectSave.requestReturn}
				onHelpClick={() => setHelpOpen(true)}
				onNodeFinderClick={handleOpenNodeFinder}
				onProjectSettingsClick={() => setProjectSettingsOpen(true)}
				onRedoClick={history.redo}
				onSaveClick={() => void projectSave.save()}
				onUndoClick={history.undo}
				onVerifyClick={handleVerify}
			/>

			<div className="flex min-h-0 flex-1">
				<BlockLibrary
					collapsed={collapsed.left}
					width={sizes.left}
					targetRuntimes={projectSettings.targetRuntimes}
					onAddBlock={handleAddBlock}
					onToggleCollapsed={() => togglePanel("left")}
				/>
				{!collapsed.left && (
					<ResizeHandle
						axis="horizontal"
						label="Resize block library"
						onPointerDown={(event) => startResize("left", event)}
					/>
				)}

				<main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
					<FlowCanvas
						nodes={nodes}
						edges={edges}
						nodeFocusRequest={nodeFocusRequest}
						simulatedEdgeIds={simulationEdgeIds}
						simulatedNodeIds={simulationNodeIds}
						selectedEdgeId={selectedEdgeId}
						onNodesChange={onNodesChange}
						onEdgesChange={handleEdgesChange}
						onEdgesCommit={setEdges}
						onNodesDelete={handleNodesDelete}
						onEdgesDelete={handleEdgesDelete}
						onSelectNode={(nodeId) => {
							setSelectedNodeId(nodeId);
							if (nodeId && activeTab === "simulator") {
								setActiveTab("properties");
							}
						}}
						onSelectEdge={handleSelectEdge}
						canPaste={clipboard !== null}
						onCopyNode={handleCopyNode}
						onDeleteNode={handleDeleteNode}
						onDeleteEdge={handleDeleteEdge}
						onCreateComment={handleCreateComment}
						onDeleteComment={handleDeleteComment}
						onUpdateComment={handleUpdateComment}
						onDuplicateNode={handleDuplicateNode}
						onPaste={handlePasteClipboard}
						onDropPaletteNode={handleDropPaletteNode}
						edgeStyle={edgeStyle}
						onEdgeStyleChange={handleEdgeStyleChange}
						onSpawnDevelopmentNodes={handleSpawnDevelopmentNodes}
						showDevelopmentNodeSpawner={isDevelopmentGraphEnabled}
						onViewportCenterChange={setViewportCenter}
						targetRuntimes={projectSettings.targetRuntimes}
					/>
					{!collapsed.bottom && (
						<ResizeHandle
							axis="vertical"
							label="Resize output console"
							onPointerDown={(event) => startResize("bottom", event)}
						/>
					)}
					<OutputConsole
						activeTab={bottomPanelTab}
						follow={bottomPanelFollow}
						logs={logs}
						open={!collapsed.bottom}
						systemLogs={systemLogs}
						simulationLogs={simulationLogs}
						variables={variableEntries}
						height={sizes.bottom}
						onClearTab={handleClearBottomPanelTab}
						onFollowChange={handleFollowBottomPanelTab}
						onResetStoredValues={handleResetStoredSimulationValues}
						onTabChange={setBottomPanelTab}
						onToggle={() => togglePanel("bottom")}
					/>
				</main>

				{!collapsed.right && (
					<ResizeHandle
						axis="horizontal"
						label="Resize inspector"
						onPointerDown={(event) => startResize("right", event)}
					/>
				)}
				<Inspector
					activeTab={activeTab}
					activeScheduleTriggerId={activeScheduleTriggerId}
					assets={assets}
					edges={edges}
					nodes={scriptNodes}
					selectedEdge={selectedEdge}
					selectedNode={selectedNode}
					simulationOverrides={simulationOverrides}
					simulationSettings={simulationSettings}
					simulationStatus={simulationStatus}
					simulationTriggerInputDrafts={simulationTriggerInputDrafts}
					variables={variableEntries}
					width={sizes.right}
					collapsed={collapsed.right}
					onAddSimulationOverride={handleAddSimulationOverride}
					onRemoveSimulationOverride={handleRemoveSimulationOverride}
					onSimulationSettingsChange={setSimulationSettings}
					onStartScheduleSimulation={handleStartScheduleSimulation}
					onStopSimulation={handleStopSimulation}
					onStopScheduleSimulation={handleStopScheduleSimulation}
					onTriggerSimulation={handleTriggerSimulation}
					onTriggerSimulationInputChange={(triggerNodeId, draft) =>
						setSimulationTriggerInputDrafts((current) => ({ ...current, [triggerNodeId]: draft }))
					}
					onTabChange={setActiveTab}
					onUpdateNodeConfig={handleUpdateNodeConfig}
					onUpdateSimulationOverride={handleUpdateSimulationOverride}
					onDeleteEdge={handleDeleteEdge}
					onDeleteNode={handleDeleteNode}
					onReorderEdges={handleReorderEdges}
					onSelectEdge={handleSelectEdge}
					onToggleCollapsed={() => togglePanel("right")}
				/>
			</div>

			<StatusBar
				nodes={scriptNodes}
				edges={edges}
				riskLevel={riskLevel}
				targetRuntimes={projectSettings.targetRuntimes}
				verificationStatus={verificationRecord.status}
				saveStatus={projectSave.status}
			/>
			<UnsavedChangesDialog
				open={projectSave.leaveDialogOpen}
				saving={projectSave.saving}
				onCancel={projectSave.closeLeaveDialog}
				onDiscard={projectSave.discardAndReturn}
				onSave={() => void projectSave.saveAndReturn()}
			/>
			<SaveRecoveryDialog
				failure={projectSave.failure}
				saving={projectSave.saving}
				onClose={projectSave.closeFailure}
				onExport={() => {
					projectSave.closeFailure();
					setExportOpen(true);
				}}
				onRetry={() => void projectSave.save()}
			/>
			<VerificationModal
				checks={verificationChecks}
				open={verificationOpen}
				onClose={() => setVerificationOpen(false)}
			/>
			<VerificationErrorModal
				checks={verificationErrorDialog.checks}
				description={verificationErrorDialog.description}
				open={verificationErrorDialog.open}
				title={verificationErrorDialog.title}
				onClose={() => setVerificationErrorDialog((currentDialog) => ({ ...currentDialog, open: false }))}
			/>
			<ProjectSettingsModal
				open={projectSettingsOpen}
				projectId={persistedProject.identity.id}
				settings={projectSettings}
				defaultVariables={defaultVariables}
				secretDeclarations={secretDeclarations}
				scriptSettings={scriptSettings}
				simulationSecretValues={simulationSecretValues}
				onClose={() => setProjectSettingsOpen(false)}
				onSave={handleSaveProjectSettings}
				onDefaultVariablesChange={handleDefaultVariablesChange}
				onSecretDeclarationsChange={handleSecretDeclarationsChange}
				onScriptSettingsChange={handleScriptSettingsChange}
				onSimulationSecretValuesChange={setSimulationSecretValues}
			/>
			<AssetEditorModal
				assets={assets}
				open={assetEditorOpen}
				onAssetsChange={handleAssetsChange}
				onClose={() => setAssetEditorOpen(false)}
			/>
			<ExportWizardModal
				capabilities={capabilities}
				checks={verificationChecks}
				exportSummary={exportSummary}
				open={exportOpen}
				permissions={permissions}
				projectSettings={normalizedProjectSettings}
				riskLevel={riskLevel}
				onClose={() => setExportOpen(false)}
				onPrepareExport={handlePrepareExport}
				onVerificationComplete={handleExportVerificationComplete}
			/>
			<HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
			<NodeFinderModal
				nodes={scriptNodes}
				open={nodeFinderOpen}
				onClose={() => setNodeFinderOpen(false)}
				onSelectNode={handleFindNode}
			/>
			<SimulationMessageBoxDialog messageBox={simulationMessageBox} onSelect={handleSimulationMessageBoxSelect} />
			<Toaster position="bottom-right" closeButton richColors />
		</div>
	);
}

function isScriptFlowNode(node: EditorFlowNode): node is ScriptFlowNode {
	return node.type !== "commentNode";
}
