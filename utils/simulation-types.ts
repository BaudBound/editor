import type { Edge, Node } from "@xyflow/react";
import type { ProjectIdentity } from "@/data/projects/model";
import type {
	DeclaredVariable,
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
	/**
	 * The project's identity, which `@manifest.id` is resolved from.
	 *
	 * The id is not part of the settings, so a simulation given only those
	 * could not answer it and reported the script's name instead.
	 */
	identity: ProjectIdentity;
	projectSettings: ProjectSettings;
	scriptSettings?: ScriptSetting[];
	declaredVariables?: DeclaredVariable[];
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
			numberType: "float" | "integer";
			placeholder: string;
			required: boolean;
			type: "number";
	  }
	| {
			defaultValue: string;
			description: string;
			key: string;
			label: string;
			placeholder: string;
			required: boolean;
			type: "multiline" | "text";
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
			display?: Record<string, JsonValue>;
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
	/**
	 * The scope and type each variable was declared with.
	 *
	 * A Variable Operation node names a declared variable; the declaration
	 * settles its scope and type. The simulator looks them up here so it picks
	 * the same store and the same type the runner does.
	 */
	declaredVariables: Record<string, { scope: string; type: string; itemType?: string; value: JsonValue }>;
	assetsByPackagePath: Map<string, EditorAsset>;
	edgesBySource: Map<string, Edge[]>;
	failed: boolean;
	halted: boolean;
	globalVariables: Record<string, JsonValue>;
	lastYieldAt: number;
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
