import type { Edge, Node } from "@xyflow/react";
import type {
	DefaultVariable,
	EditorAsset,
	JsonValue,
	LogEntry,
	ProjectSettings,
	ScriptNodeData,
	ScriptSetting,
	SimulationOverride,
	SimulationTraceEntry,
	SimulationTriggerPayload,
	SimulationVariableSnapshot,
} from "@/lib/types";

export type SimulationRunOptions = {
	assets: EditorAsset[];
	edges: Edge[];
	nodes: Node<ScriptNodeData>[];
	onStep?: (
		step: SimulationStep,
	) => Promise<SimulationSideEffectResult[] | undefined> | SimulationSideEffectResult[] | undefined;
	overrides: SimulationOverride[];
	projectSettings: ProjectSettings;
	scriptSettings?: ScriptSetting[];
	defaultVariables?: DefaultVariable[];
	globalVariables?: Record<string, JsonValue>;
	httpSimulation: {
		authorizedOrigins: readonly string[];
		mode: "live" | "mock";
	};
	persistentVariables?: Record<string, JsonValue>;
	secretValues?: Record<string, JsonValue>;
	signal?: AbortSignal;
	stepDelayMs?: number;
	triggerNodeId?: string;
	triggerPayload?: SimulationTriggerPayload;
};

export type SimulationStep = {
	nodeState?: {
		nodeId: string;
		status: "active" | "completed";
	};
	outputLogs: LogEntry[];
	sideEffects: SimulationSideEffect[];
	traces: SimulationTraceEntry[];
	traversedEdgeIds: string[];
	variables: SimulationVariableSnapshot[];
};

export type SimulationFormDialogField =
	| {
			accentColor: string;
			description: string;
			label: string;
			type: "information";
	  }
	| {
			accentColor: string;
			description: string;
			label: string;
			type: "section_heading";
	  }
	| {
			accentColor: string;
			type: "divider";
	  }
	| {
			assetPath: string;
			description: string;
			imageFit: "contain" | "cover";
			imageHeight: number;
			label: string;
			type: "image";
	  }
	| {
			defaultChecked: boolean;
			description: string;
			key: string;
			label: string;
			required: boolean;
			type: "checkbox";
	  }
	| {
			choices: { displayValue: string; key: string }[];
			description: string;
			key: string;
			label: string;
			required: boolean;
			type: "dropdown" | "multi_choice" | "single_choice";
	  }
	| {
			defaultValue: number | string;
			description: string;
			key: string;
			label: string;
			placeholder: string;
			required: boolean;
			type: "multiline" | "number" | "text";
	  }
	| {
			defaultValue: string;
			description: string;
			key: string;
			label: string;
			required: boolean;
			timezone?: string;
			type: "color" | "date" | "datetime" | "time";
	  }
	| {
			description: string;
			key: string;
			label: string;
			multiple?: boolean;
			required: boolean;
			type: "file" | "folder";
	  }
	| {
			defaultValue: number;
			description: string;
			key: string;
			label: string;
			maximum: number;
			minimum: number;
			required: boolean;
			step: number;
			type: "slider";
	  }
	| {
			description: string;
			key: string;
			label: string;
			placeholder: string;
			required: boolean;
			type: "password";
	  };

export type SimulationSideEffect = {
	nodeId: string;
} & (
	| {
			assetPath: string;
			type: "play_audio_asset";
	  }
	| {
			message: string;
			title: string;
			type: "notification_toast";
	  }
	| {
			buttons: string[];
			dialogSize: "large" | "medium" | "small";
			message: string;
			timeoutSeconds?: number;
			title: string;
			type: "message_box";
			variant: "error" | "info" | "warning";
	  }
	| {
			description: string;
			dialogSize: "large" | "medium" | "small";
			fields: SimulationFormDialogField[];
			timeoutSeconds?: number;
			title: string;
			type: "form_dialog";
	  }
	| {
			durationMs: number;
			frequencyHz: number;
			type: "system_beep";
	  }
);

export type SimulationSideEffectResult = {
	button: string;
	nodeId: string;
} & (
	| { type: "message_box" }
	| {
			submitted: boolean;
			type: "form_dialog";
			values: Record<string, JsonValue>;
	  }
);

export type SimulationRun = {
	finalVariables: SimulationVariableSnapshot[];
	globalVariables: Record<string, JsonValue>;
	persistentVariables: Record<string, JsonValue>;
	status: "completed" | "failed";
};

export type SimulationContext = {
	assetsByPackagePath: Map<string, EditorAsset>;
	edgesBySource: Map<string, Edge[]>;
	failed: boolean;
	halted: boolean;
	globalVariables: Record<string, JsonValue>;
	nodeOutputs: Record<string, Record<string, JsonValue>>;
	httpSimulation: {
		authorizedOrigins: ReadonlySet<string>;
		mode: "live" | "mock";
	};
	nodesById: Map<string, Node<ScriptNodeData>>;
	onStep?: (
		step: SimulationStep,
	) => Promise<SimulationSideEffectResult[] | undefined> | SimulationSideEffectResult[] | undefined;
	overridesByNodeId: Map<string, SimulationOverride["outcome"]>;
	persistentVariables: Record<string, JsonValue>;
	runtimeVariables: Record<string, JsonValue>;
	secretNames: Set<string>;
	secretValues: JsonValue[];
	signal?: AbortSignal;
	stepDelayMs: number;
	triggerPayload: SimulationTriggerPayload;
	webhookResponse: {
		fallback: Record<string, JsonValue>;
		response?: Record<string, JsonValue>;
		sent: boolean;
		triggerNodeId: string;
		waiting: boolean;
	} | null;
};

export type NodeExecutionResult = {
	failed: boolean;
	outputData: Record<string, JsonValue>;
};
