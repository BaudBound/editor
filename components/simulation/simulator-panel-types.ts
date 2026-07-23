import type { Node } from "@xyflow/react";
import type {
	ScriptNodeData,
	SimulationOverride,
	SimulationOverrideOutcome,
	SimulationRunStatus,
	SimulationSettings,
	SimulationTriggerPayload,
} from "@/lib/types";

export type SimulatorPanelProps = {
	activeScheduleTriggerId: string | null;
	nodes: Node<ScriptNodeData>[];
	overrides: SimulationOverride[];
	settings: SimulationSettings;
	status: SimulationRunStatus;
	onAddOverride: (nodeId: string) => void;
	onRemoveOverride: (nodeId: string) => void;
	onSettingsChange: (settings: SimulationSettings) => void;
	onStartScheduleSimulation: (triggerNodeId: string) => void;
	onStopSimulation: () => void;
	onStopScheduleSimulation: (triggerNodeId: string) => void;
	onTriggerSimulation: (triggerNodeId: string, payload: SimulationTriggerPayload) => void;
	onUpdateOverride: (nodeId: string, outcome: SimulationOverrideOutcome) => void;
};

export type NodeOption = {
	label: string;
	value: string;
};
