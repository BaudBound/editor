"use client";

import {
	addEdge,
	Background,
	type Connection,
	Controls,
	type Edge,
	MiniMap,
	type Node,
	type OnEdgesChange,
	type OnNodesChange,
	ReactFlow,
	ReactFlowProvider,
	SelectionMode,
	useReactFlow,
	type XYPosition,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Grid3X3, StickyNote } from "lucide-react";
import { type DragEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { OptionCombobox } from "@/components/ui/option-combobox";
import { paletteNodeDragDataType } from "@/data/editor/drag-drop";
import {
	createDefaultEdgeOptions,
	type EditorEdgeStyle,
	edgeColors,
	edgeStyleOptions,
	isEditorEdgeStyle,
	reactFlowProOptions,
	toReactFlowEdgeType,
} from "@/data/editor/flow-canvas";
import type { CommentNodeData, ScriptNodeData, TargetRuntime } from "@/lib/types";
import {
	createGraphEdgeId,
	getEdgeExecutionOrder,
	getNextEdgeExecutionOrder,
	isSelfConnection,
	withEdgeExecutionOrder,
} from "@/utils/editor-graph";
import { isEditableShortcutTarget } from "@/utils/editor-shortcuts";
import { CanvasContextMenu, type CanvasContextMenuState } from "./canvas-context-menu";
import { CommentCard, type CommentFlowNode, CommentNodeActionsContext, isCommentFlowNode } from "./comment-card";
import { ScriptNode, ScriptNodeSimulationContext } from "./script-node";

export type ScriptFlowNode = Node<ScriptNodeData, "scriptNode">;
export type EditorFlowNode = ScriptFlowNode | CommentFlowNode;
export type CanvasNodeFocusRequest = {
	nodeId: string;
	requestId: number;
};

type FlowCanvasProps = {
	activeSimulationNodeId: string | null;
	nodes: EditorFlowNode[];
	edges: Edge[];
	nodeFocusRequest: CanvasNodeFocusRequest | null;
	simulatedEdgeIds: ReadonlySet<string>;
	simulatedNodeIds: ReadonlySet<string>;
	selectedEdgeId: string | null;
	onNodesChange: OnNodesChange<EditorFlowNode>;
	onEdgesChange: OnEdgesChange<Edge>;
	onEdgesCommit: (updater: (edges: Edge[]) => Edge[]) => void;
	onNodesDelete: (deletedNodes: EditorFlowNode[]) => void;
	onSelectNode: (nodeId: string | null) => void;
	onSelectEdge: (edgeId: string | null) => void;
	onEdgesDelete: (deletedEdges: Edge[]) => void;
	canPaste: boolean;
	onCopyNode: (nodeId: string) => void;
	onDeleteNode: (nodeId: string) => void;
	onDeleteEdge: (edgeId: string) => void;
	onDuplicateNode: (nodeId: string) => void;
	onPaste: (position: XYPosition) => void;
	onCreateComment: (position: XYPosition) => void;
	onDeleteComment: (commentId: string) => void;
	onUpdateComment: (commentId: string, patch: Partial<CommentNodeData>) => void;
	onDropPaletteNode: (actionType: string, position: XYPosition) => void;
	onSpawnDevelopmentNodes?: () => void;
	showDevelopmentNodeSpawner?: boolean;
	edgeStyle: EditorEdgeStyle;
	onEdgeStyleChange: (edgeStyle: EditorEdgeStyle) => void;
	onViewportCenterChange: (position: XYPosition) => void;
	targetRuntimes: TargetRuntime[];
};

type FlowCanvasContentProps = Omit<FlowCanvasProps, "activeSimulationNodeId">;

const nodeTypes = {
	commentNode: CommentCard,
	scriptNode: ScriptNode,
};

type ContextMenuEvent = {
	clientX: number;
	clientY: number;
	preventDefault: () => void;
	stopPropagation?: () => void;
};

export function FlowCanvas({
	activeSimulationNodeId,
	canPaste,
	edges,
	nodes,
	nodeFocusRequest,
	onCreateComment,
	onCopyNode,
	onDeleteComment,
	onDeleteEdge,
	onDeleteNode,
	onDuplicateNode,
	onDropPaletteNode,
	edgeStyle,
	onEdgeStyleChange,
	onEdgesChange,
	onEdgesCommit,
	onEdgesDelete,
	onNodesChange,
	onNodesDelete,
	onPaste,
	onSpawnDevelopmentNodes,
	onSelectEdge,
	onSelectNode,
	onUpdateComment,
	showDevelopmentNodeSpawner,
	onViewportCenterChange,
	selectedEdgeId,
	simulatedEdgeIds,
	simulatedNodeIds,
	targetRuntimes,
}: FlowCanvasProps) {
	const simulationState = useMemo(
		() => ({ activeNodeId: activeSimulationNodeId, completedNodeIds: simulatedNodeIds }),
		[activeSimulationNodeId, simulatedNodeIds],
	);

	return (
		<ScriptNodeSimulationContext.Provider value={simulationState}>
			<ReactFlowProvider>
				<FlowCanvasContent
					canPaste={canPaste}
					edges={edges}
					nodes={nodes}
					nodeFocusRequest={nodeFocusRequest}
					onCreateComment={onCreateComment}
					onCopyNode={onCopyNode}
					onDeleteComment={onDeleteComment}
					onDeleteEdge={onDeleteEdge}
					onDeleteNode={onDeleteNode}
					onDuplicateNode={onDuplicateNode}
					onDropPaletteNode={onDropPaletteNode}
					edgeStyle={edgeStyle}
					onEdgeStyleChange={onEdgeStyleChange}
					onEdgesChange={onEdgesChange}
					onEdgesCommit={onEdgesCommit}
					onEdgesDelete={onEdgesDelete}
					onNodesChange={onNodesChange}
					onNodesDelete={onNodesDelete}
					onPaste={onPaste}
					onSpawnDevelopmentNodes={onSpawnDevelopmentNodes}
					onSelectEdge={onSelectEdge}
					onSelectNode={onSelectNode}
					onUpdateComment={onUpdateComment}
					showDevelopmentNodeSpawner={showDevelopmentNodeSpawner}
					onViewportCenterChange={onViewportCenterChange}
					selectedEdgeId={selectedEdgeId}
					simulatedEdgeIds={simulatedEdgeIds}
					simulatedNodeIds={simulatedNodeIds}
					targetRuntimes={targetRuntimes}
				/>
			</ReactFlowProvider>
		</ScriptNodeSimulationContext.Provider>
	);
}

function FlowCanvasContent({
	nodes,
	edges,
	nodeFocusRequest,
	selectedEdgeId,
	simulatedEdgeIds,
	targetRuntimes,
	onNodesChange,
	onEdgesChange,
	onEdgesCommit,
	onNodesDelete,
	onSelectNode,
	onSelectEdge,
	onEdgesDelete,
	canPaste,
	onCopyNode,
	onDeleteNode,
	onDeleteEdge,
	onDeleteComment,
	onDuplicateNode,
	onCreateComment,
	onUpdateComment,
	onDropPaletteNode,
	edgeStyle,
	onEdgeStyleChange,
	onPaste,
	onSpawnDevelopmentNodes,
	showDevelopmentNodeSpawner,
	onViewportCenterChange,
}: FlowCanvasContentProps) {
	const { fitView, screenToFlowPosition } = useReactFlow<EditorFlowNode, Edge>();
	const viewportRef = useRef<HTMLDivElement>(null);
	const initFrameRef = useRef<number | null>(null);
	const lastViewportCenterRef = useRef<XYPosition | null>(null);
	const lastCanvasPointerPositionRef = useRef<XYPosition | null>(null);
	const [contextMenu, setContextMenu] = useState<CanvasContextMenuState | null>(null);
	const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(null);

	const onConnect = useCallback(
		(connection: Connection) => {
			if (isSelfConnection(connection)) {
				return;
			}

			const edgeId = createGraphEdgeId(connection);
			onEdgesCommit((current) => {
				const edge: Edge = withEdgeExecutionOrder(
					{ ...connection, id: edgeId, type: toReactFlowEdgeType(edgeStyle) },
					getNextEdgeExecutionOrder(current, connection.source, connection.sourceHandle),
				);
				return addEdge(edge, current);
			});
			onSelectNode(null);
			onSelectEdge(edgeId);
		},
		[edgeStyle, onEdgesCommit, onSelectEdge, onSelectNode],
	);
	const isValidConnection = useCallback((connection: Connection | Edge) => !isSelfConnection(connection), []);

	const closeContextMenu = useCallback(() => setContextMenu(null), []);
	// Shared by clicking and by starting a drag, so the inspector follows the
	// node however the selection was made.
	const selectClickedNode = useCallback(
		(node: EditorFlowNode) => {
			setContextMenu(null);
			onSelectEdge(null);
			onSelectNode(isCommentFlowNode(node) ? null : node.id);
		},
		[onSelectEdge, onSelectNode],
	);

	const getViewportCenterPosition = useCallback(() => {
		const viewport = viewportRef.current;
		if (!viewport) {
			return { x: 0, y: 0 };
		}

		const bounds = viewport.getBoundingClientRect();
		return screenToFlowPosition({
			x: bounds.left + bounds.width / 2,
			y: bounds.top + bounds.height / 2,
		});
	}, [screenToFlowPosition]);

	const updateViewportCenter = useCallback(() => {
		const viewport = viewportRef.current;
		if (!viewport) {
			return;
		}

		const bounds = viewport.getBoundingClientRect();
		const nextCenter = screenToFlowPosition({
			x: bounds.left + bounds.width / 2,
			y: bounds.top + bounds.height / 2,
		});
		const previousCenter = lastViewportCenterRef.current;
		if (
			previousCenter &&
			Math.abs(previousCenter.x - nextCenter.x) < 0.5 &&
			Math.abs(previousCenter.y - nextCenter.y) < 0.5
		) {
			return;
		}

		lastViewportCenterRef.current = nextCenter;
		onViewportCenterChange(nextCenter);
	}, [onViewportCenterChange, screenToFlowPosition]);

	useEffect(() => {
		window.addEventListener("contextmenu", closeContextMenu, { capture: true });

		return () => window.removeEventListener("contextmenu", closeContextMenu, { capture: true });
	}, [closeContextMenu]);

	useEffect(() => {
		const viewport = viewportRef.current;
		if (!viewport) {
			return;
		}

		const resizeObserver = new ResizeObserver(updateViewportCenter);
		resizeObserver.observe(viewport);
		const frame = window.requestAnimationFrame(updateViewportCenter);

		return () => {
			window.cancelAnimationFrame(frame);
			resizeObserver.disconnect();
		};
	}, [updateViewportCenter]);

	const openContextMenu = useCallback(
		(event: ContextMenuEvent, target: CanvasContextMenuState["target"]) => {
			event.preventDefault();
			event.stopPropagation?.();
			setContextMenu({
				x: event.clientX,
				y: event.clientY,
				flowPosition: screenToFlowPosition({ x: event.clientX, y: event.clientY }),
				target,
			});
		},
		[screenToFlowPosition],
	);

	const handleDragOver = useCallback((event: DragEvent) => {
		if (!event.dataTransfer.types.includes(paletteNodeDragDataType)) {
			return;
		}

		event.preventDefault();
		event.dataTransfer.dropEffect = "copy";
	}, []);

	const handleDrop = useCallback(
		(event: DragEvent) => {
			const actionType = event.dataTransfer.getData(paletteNodeDragDataType);
			if (!actionType) {
				return;
			}

			event.preventDefault();
			closeContextMenu();
			onDropPaletteNode(
				actionType,
				screenToFlowPosition({
					x: event.clientX,
					y: event.clientY,
				}),
			);
		},
		[closeContextMenu, onDropPaletteNode, screenToFlowPosition],
	);

	useEffect(() => {
		const viewport = viewportRef.current;
		if (!viewport) {
			return;
		}

		const clearPointerPosition = () => {
			lastCanvasPointerPositionRef.current = null;
		};
		const trackPointerPosition = (event: MouseEvent) => {
			const target = event.target instanceof Element ? event.target : null;
			const overCanvasControl = target?.closest(".react-flow__controls, .react-flow__minimap, [data-canvas-overlay]");
			if (overCanvasControl) {
				clearPointerPosition();
				return;
			}

			lastCanvasPointerPositionRef.current = screenToFlowPosition({
				x: event.clientX,
				y: event.clientY,
			});
		};

		window.addEventListener("blur", clearPointerPosition);
		viewport.addEventListener("mouseleave", clearPointerPosition);
		viewport.addEventListener("mousemove", trackPointerPosition, { capture: true, passive: true });

		return () => {
			window.removeEventListener("blur", clearPointerPosition);
			viewport.removeEventListener("mouseleave", clearPointerPosition);
			viewport.removeEventListener("mousemove", trackPointerPosition, { capture: true });
		};
	}, [screenToFlowPosition]);

	useEffect(() => {
		const handlePasteShortcut = (event: KeyboardEvent) => {
			if (!canPaste || isEditableShortcutTarget(event.target) || !event.ctrlKey || event.key.toLowerCase() !== "v") {
				return;
			}

			event.preventDefault();
			onPaste(lastCanvasPointerPositionRef.current ?? getViewportCenterPosition());
		};

		window.addEventListener("keydown", handlePasteShortcut);
		return () => window.removeEventListener("keydown", handlePasteShortcut);
	}, [canPaste, getViewportCenterPosition, onPaste]);

	useEffect(() => {
		if (!contextMenu) {
			return;
		}

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				closeContextMenu();
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		window.addEventListener("pointerdown", closeContextMenu);

		return () => {
			window.removeEventListener("keydown", handleKeyDown);
			window.removeEventListener("pointerdown", closeContextMenu);
		};
	}, [closeContextMenu, contextMenu]);

	useEffect(() => {
		return () => {
			if (initFrameRef.current !== null) {
				window.cancelAnimationFrame(initFrameRef.current);
				initFrameRef.current = null;
			}
		};
	}, []);

	useEffect(() => {
		if (!nodeFocusRequest) {
			return;
		}

		setHighlightedNodeId(nodeFocusRequest.nodeId);
		const frame = window.requestAnimationFrame(() => {
			void fitView({
				nodes: [{ id: nodeFocusRequest.nodeId }],
				duration: 260,
				padding: 1.2,
				maxZoom: 1,
			});
		});
		const highlightTimeout = window.setTimeout(() => setHighlightedNodeId(null), 1_400);

		return () => {
			window.cancelAnimationFrame(frame);
			window.clearTimeout(highlightTimeout);
		};
	}, [fitView, nodeFocusRequest]);

	const displayedEdges = useMemo(() => {
		const groupSizes = new Map<string, number>();
		for (const edge of edges) {
			const key = `${edge.source}\u0000${edge.sourceHandle ?? ""}`;
			groupSizes.set(key, (groupSizes.get(key) ?? 0) + 1);
		}

		return edges.map((edge) => {
			const selected = edge.selected || edge.id === selectedEdgeId;
			const simulated = simulatedEdgeIds.has(edge.id);
			const groupSize = groupSizes.get(`${edge.source}\u0000${edge.sourceHandle ?? ""}`) ?? 0;
			const executionOrder = getEdgeExecutionOrder(edge);

			return {
				...edge,
				className:
					[edge.className, simulated ? "baud-edge-simulated" : "", selected ? "baud-edge-selected" : ""]
						.filter(Boolean)
						.join(" ") || undefined,
				label: groupSize > 1 && executionOrder !== null ? String(executionOrder + 1) : undefined,
				labelBgBorderRadius: 4,
				labelBgPadding: [5, 3] as [number, number],
				labelBgStyle: {
					fill: selected ? edgeColors.selected : simulated ? "#176b4b" : "#182033",
					fillOpacity: 1,
				},
				labelStyle: { fill: "#ffffff", fontSize: 11, fontWeight: 700 },
				type: toReactFlowEdgeType(edgeStyle),
				style: {
					stroke: selected ? edgeColors.selected : simulated ? edgeColors.simulated : edgeColors.default,
					strokeWidth: selected || simulated ? 4 : 2,
				},
			};
		});
	}, [edgeStyle, edges, selectedEdgeId, simulatedEdgeIds]);
	const displayedNodes = useMemo(
		() =>
			nodes.map((node) => ({
				...node,
				className:
					[node.className, node.id === highlightedNodeId ? "baud-node-found" : ""].filter(Boolean).join(" ") ||
					undefined,
			})),
		[highlightedNodeId, nodes],
	);
	const currentDefaultEdgeOptions = useMemo(() => createDefaultEdgeOptions(edgeStyle), [edgeStyle]);

	return (
		<div ref={viewportRef} className="relative min-h-0 flex-1 bg-baud-canvas">
			<CommentNodeActionsContext.Provider value={{ onDelete: onDeleteComment, onUpdate: onUpdateComment }}>
				<ReactFlow
					nodes={displayedNodes}
					edges={displayedEdges}
					nodeTypes={nodeTypes}
					onNodesChange={onNodesChange}
					onEdgesChange={onEdgesChange}
					onConnect={onConnect}
					isValidConnection={isValidConnection}
					onDragOver={handleDragOver}
					onDrop={handleDrop}
					onNodeClick={(_, node) => selectClickedNode(node)}
					// A node drag never raises a click, so without this the panel keeps
					// showing whatever was selected before the drag started.
					onNodeDragStart={(_, node) => selectClickedNode(node)}
					// The default threshold is a single pixel, so the smallest movement
					// while pressing turned a click into a drag and the selection was
					// never reported.
					nodeDragThreshold={4}
					onNodeContextMenu={(event, node) => {
						openContextMenu(event, { type: "node", id: node.id });
						onSelectEdge(null);
						onSelectNode(isCommentFlowNode(node) ? null : node.id);
					}}
					onEdgeClick={(event, edge) => {
						event.stopPropagation();
						closeContextMenu();
						onSelectNode(null);
						onSelectEdge(edge.id);
					}}
					onEdgeContextMenu={(event, edge) => {
						onSelectNode(null);
						onSelectEdge(edge.id);
						openContextMenu(event, { type: "edge", id: edge.id });
					}}
					onPaneClick={() => {
						closeContextMenu();
						onSelectNode(null);
						onSelectEdge(null);
					}}
					onPaneContextMenu={(event) => {
						onSelectNode(null);
						onSelectEdge(null);
						openContextMenu(event, { type: "pane" });
					}}
					onInit={() => {
						if (initFrameRef.current !== null) {
							window.cancelAnimationFrame(initFrameRef.current);
						}
						initFrameRef.current = window.requestAnimationFrame(() => {
							initFrameRef.current = null;
							updateViewportCenter();
						});
					}}
					onMoveStart={closeContextMenu}
					onMoveEnd={updateViewportCenter}
					onNodesDelete={onNodesDelete}
					onEdgesDelete={onEdgesDelete}
					deleteKeyCode={["Backspace", "Delete"]}
					edgesFocusable
					elementsSelectable
					multiSelectionKeyCode="Control"
					nodesFocusable
					selectionKeyCode="Control"
					selectionMode={SelectionMode.Partial}
					minZoom={0.02}
					fitViewOptions={{ padding: 0.25 }}
					defaultEdgeOptions={currentDefaultEdgeOptions}
					proOptions={reactFlowProOptions}
				>
					<Background color="#25304a" gap={22} size={1.2} />
					<Controls
						className="baud-flow-controls"
						position="bottom-left"
						showInteractive={false}
						fitViewOptions={{ padding: 0.25 }}
					/>
					<MiniMap
						className="baud-flow-minimap"
						position="bottom-right"
						bgColor="#080a0f"
						nodeBorderRadius={4}
						nodeColor="#171b27"
						nodeStrokeColor="#53627d"
						maskColor="rgb(8 10 15 / 62%)"
						pannable
						zoomable
					/>
				</ReactFlow>
			</CommentNodeActionsContext.Provider>
			<div data-canvas-overlay className="pointer-events-auto absolute left-4 top-4 z-10 flex items-center gap-2">
				<Button
					type="button"
					size="default"
					variant="toolbar"
					title="Add comment"
					onClick={() => onCreateComment(getViewportCenterPosition())}
				>
					<StickyNote size={15} />
					Add comment
				</Button>
				<OptionCombobox
					ariaLabel="Edge style"
					className="h-8 w-40 bg-baud-bg/95"
					value={edgeStyle}
					options={edgeStyleOptions.map((option) => ({ ...option }))}
					onChange={(nextEdgeStyle) => {
						if (isEditorEdgeStyle(nextEdgeStyle)) {
							onEdgeStyleChange(nextEdgeStyle);
						}
					}}
				/>
			</div>
			{showDevelopmentNodeSpawner && onSpawnDevelopmentNodes && (
				<div data-canvas-overlay className="pointer-events-none absolute top-4 right-4 z-10">
					<Button
						type="button"
						onClick={onSpawnDevelopmentNodes}
						className="pointer-events-auto"
						size="sm"
						variant="toolbar"
					>
						<Grid3X3 size={14} />
						Spawn dev nodes
					</Button>
				</div>
			)}
			{contextMenu && (
				<CanvasContextMenu
					canPaste={canPaste}
					menu={contextMenu}
					targetRuntimes={targetRuntimes}
					onAddNode={(item, position) => onDropPaletteNode(item.actionType, position)}
					onClose={closeContextMenu}
					onCopyNode={onCopyNode}
					onDeleteNode={onDeleteNode}
					onDeleteEdge={onDeleteEdge}
					onDuplicateNode={onDuplicateNode}
					onPaste={onPaste}
				/>
			)}
		</div>
	);
}
