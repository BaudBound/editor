import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { createContext, useContext } from "react";
import { kindAccentClassName } from "@/data/editor/risk";
import { sanitizeNodeConfig } from "@/data/nodes/registry";
import type { ActionType, JsonValue, ScriptNodeData } from "@/lib/types";
import { RiskBadge } from "../shell/risk-badge";

type ScriptFlowNode = Node<ScriptNodeData, "scriptNode">;

type ScriptNodeSimulationState = {
	activeNodeId: string | null;
	completedNodeIds: ReadonlySet<string>;
};

export const ScriptNodeSimulationContext = createContext<ScriptNodeSimulationState>({
	activeNodeId: null,
	completedNodeIds: new Set(),
});

const namedHeaderHeight = 68;
const outputHandleSpacing = 40;
const baseBodyHeight = 56;

export function ScriptNode({ data, id, selected }: NodeProps<ScriptFlowNode>) {
	const simulationState = useContext(ScriptNodeSimulationContext);
	const active = simulationState.activeNodeId === id;
	const completed = simulationState.completedNodeIds.has(id);
	const customName = typeof data.config.customName === "string" ? data.config.customName.trim() : "";
	const subtitle = customName || id;
	const configSummary = getConfigSummary(data.actionType, data.config);
	const headerHeight = namedHeaderHeight;
	const bodyMinHeight = getBodyMinHeight(data.outputs.length);

	return (
		<div
			data-simulation-state={active ? "active" : completed ? "completed" : undefined}
			className={`baud-script-node nokey relative w-80 rounded border bg-baud-node shadow-[0_14px_40px_rgba(0,0,0,0.24)] ${
				active
					? "border-baud-amber ring-2 ring-baud-amber/40 shadow-[0_0_14px_rgba(245,185,66,0.32)]"
					: completed
						? "border-[#2ed98f] ring-2 ring-[#2ed98f]/35 shadow-[0_0_12px_rgba(46,217,143,0.28)]"
						: selected
							? "border-baud-red ring-2 ring-baud-red/35"
							: "border-baud-border"
			}`}
		>
			<div
				className="flex items-center gap-2.5 border-b border-baud-border px-4 py-2"
				style={{ minHeight: headerHeight }}
			>
				<span className={`size-2.5 rounded-sm ${kindAccentClassName[data.kind]}`} />
				<div className="min-w-0 flex-1">
					<div className="truncate text-lg leading-6 font-bold text-white">{data.label}</div>
					<div className="mt-0.5 truncate font-mono text-base leading-5 text-baud-text">{subtitle}</div>
				</div>
				<div className="shrink-0 self-start pt-0.5 font-mono text-sm text-baud-muted uppercase">{data.kind}</div>
			</div>

			<div aria-hidden="true" style={{ minHeight: bodyMinHeight }} />

			<div className="border-t border-baud-border px-4 py-2">
				<div className="flex min-w-0 items-center justify-between gap-2">
					<div className="min-w-0 truncate font-mono text-base text-baud-muted">{data.actionType}</div>
					<RiskBadge risk={data.risk} />
				</div>
				{configSummary && <div className="mt-0.5 truncate font-mono text-base text-baud-text">{configSummary}</div>}
			</div>

			{data.inputs.map((input) => {
				const top = headerHeight + bodyMinHeight / 2;

				return (
					<div key={input.id}>
						<span
							className="pointer-events-none absolute left-5 right-28 -translate-y-1/2 truncate font-mono text-base text-baud-muted"
							style={{ top }}
						>
							Input
						</span>
						<Handle
							type="target"
							id={input.id}
							position={Position.Left}
							style={{ top }}
							className="size-3! border-baud-blue! bg-baud-panel!"
						/>
					</div>
				);
			})}
			{data.outputs.map((output, index) => {
				const top = getOutputTop(index, data.outputs.length, bodyMinHeight, headerHeight);

				return (
					<div key={output.id}>
						<span
							className="pointer-events-none absolute left-28 right-5 -translate-y-1/2 truncate text-right font-mono text-base text-baud-muted"
							style={{ top }}
						>
							{output.label}
						</span>
						<Handle
							type="source"
							id={output.id}
							position={Position.Right}
							style={{ top }}
							className={getOutputHandleClassName(output.id)}
						/>
					</div>
				);
			})}
		</div>
	);
}

function getBodyMinHeight(totalOutputs: number) {
	return Math.max(baseBodyHeight, totalOutputs * outputHandleSpacing);
}

function getOutputTop(index: number, total: number, bodyHeight: number, headerHeight: number) {
	if (total === 1) {
		return headerHeight + bodyHeight / 2;
	}

	const first = headerHeight + outputHandleSpacing / 2;
	return first + index * outputHandleSpacing;
}

function getOutputHandleClassName(outputId: string) {
	if (
		[
			"success",
			"out",
			"submitted",
			"ok",
			"confirm",
			"yes",
			"exited_zero",
			"running",
			"read",
			"focused",
			"killed",
			"sent",
			"created",
		].includes(outputId)
	) {
		return "!size-3 !border-baud-green !bg-baud-panel";
	}

	if (["failed", "exited_nonzero", "timed_out", "client_error", "server_error", "deleted"].includes(outputId)) {
		return "!size-3 !border-baud-danger !bg-baud-panel";
	}

	if (["modified"].includes(outputId)) {
		return "!size-3 !border-baud-blue !bg-baud-panel";
	}

	if (["renamed"].includes(outputId)) {
		return "!size-3 !border-violet-400 !bg-baud-panel";
	}

	return "!size-3 !border-baud-amber !bg-baud-panel";
}

function getConfigSummary(actionType: ActionType, config: Record<string, JsonValue>) {
	return Object.entries(sanitizeNodeConfig(actionType, config))
		.filter(([key, value]) => key !== "customName" && !isEmptyConfigValue(value))
		.slice(0, 3)
		.map(([, value]) => formatConfigValue(value))
		.join(" · ");
}

function isEmptyConfigValue(value: JsonValue) {
	return value === "" || (Array.isArray(value) && value.length === 0);
}

function formatConfigValue(value: JsonValue) {
	if (Array.isArray(value)) {
		const operationNames = value.map((item) =>
			typeof item === "object" && item !== null && !Array.isArray(item) && typeof item.operation === "string"
				? item.operation
				: undefined,
		);
		if (operationNames.every((operation) => operation !== undefined)) {
			return operationNames.join(" -> ");
		}
		return `${value.length} item${value.length === 1 ? "" : "s"}`;
	}

	if (typeof value === "object" && value !== null) {
		return "configured";
	}

	return String(value);
}
