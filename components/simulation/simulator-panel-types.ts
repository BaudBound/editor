import type { Node } from "@xyflow/react";
import type { EditorVariable } from "@/data/project/variables";
import type {
	ScriptNodeData,
	SimulationOverride,
	SimulationOverrideOutcome,
	SimulationRunStatus,
	SimulationSettings,
	SimulationTriggerInputDraft,
	SimulationTriggerPayload,
} from "@/lib/types";

export type SimulatorPanelProps = {
	activeScheduleTriggerId: string | null;
	nodes: Node<ScriptNodeData>[];
	overrides: SimulationOverride[];
	settings: SimulationSettings;
	status: SimulationRunStatus;
	triggerInputDrafts: Record<string, SimulationTriggerInputDraft>;
	variables: EditorVariable[];
	onAddOverride: (nodeId: string) => void;
	onRemoveOverride: (nodeId: string) => void;
	onSettingsChange: (settings: SimulationSettings) => void;
	onStartScheduleSimulation: (triggerNodeId: string) => void;
	onStopSimulation: () => void;
	onStopScheduleSimulation: (triggerNodeId: string) => void;
	onTriggerSimulation: (triggerNodeId: string, payload: SimulationTriggerPayload) => void;
	onTriggerInputDraftChange: (triggerNodeId: string, draft: SimulationTriggerInputDraft) => void;
	onUpdateOverride: (nodeId: string, outcome: SimulationOverrideOutcome) => void;
};

export type NodeOption = {
	label: string;
	value: string;
};
