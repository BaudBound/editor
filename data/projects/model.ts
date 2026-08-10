import type { Edge, Node } from "@xyflow/react";
import type { EditorEdgeStyle } from "@/data/editor/flow-canvas";
import type {
	DeclaredVariable,
	EditorAsset,
	EditorComment,
	ProjectSettings,
	ScriptNodeData,
	ScriptSetting,
	SecretDeclaration,
} from "@/lib/types";

export const editorProjectSchemaVersion = 6;

export type ProjectIdentity = {
	createdAt: string;
	id: string;
};

export type EditorProject = {
	assets: EditorAsset[];
	comments: EditorComment[];
	declaredVariables: DeclaredVariable[];
	edgeStyle: EditorEdgeStyle;
	edges: Edge[];
	identity: ProjectIdentity;
	nodes: Node<ScriptNodeData>[];
	revision: number;
	schemaVersion: typeof editorProjectSchemaVersion;
	secretDeclarations: SecretDeclaration[];
	scriptSettings: ScriptSetting[];
	settings: ProjectSettings;
	updatedAt: string;
};

export type ProjectSummary = {
	assetCount: number;
	createdAt: string;
	edgeCount: number;
	id: string;
	name: string;
	nodeCount: number;
	revision: number;
	targetRuntimes: ProjectSettings["targetRuntimes"];
	updatedAt: string;
};

export type ProjectSaveResult = {
	project: EditorProject;
	revision: number;
};

export class ProjectRevisionConflictError extends Error {
	constructor(
		readonly projectId: string,
		readonly expectedRevision: number,
		readonly actualRevision: number,
	) {
		super(
			`Project ${projectId} changed in another session. Expected revision ${expectedRevision}, found ${actualRevision}.`,
		);
		this.name = "ProjectRevisionConflictError";
	}
}

export class ProjectNotFoundError extends Error {
	constructor(readonly projectId: string) {
		super(`Project ${projectId} was not found in this browser profile.`);
		this.name = "ProjectNotFoundError";
	}
}
