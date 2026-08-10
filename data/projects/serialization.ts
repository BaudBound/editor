import type { Edge, Node } from "@xyflow/react";
import type { EditorEdgeStyle } from "@/data/editor/flow-canvas";
import { isEditorEdgeStyle } from "@/data/editor/flow-canvas";
import { getNodeDefinition, getNodePorts, getRuntimeDataOutputs } from "@/data/nodes/registry";
import { targetRuntimes } from "@/data/project/runtimes";
import {
	inferListItemType,
	inferTypedValueType,
	normalizeListItemType,
	validateTypedValue,
} from "@/data/project/typed-values";
import { variableTypes } from "@/data/project/variables";
import {
	type ActionType,
	type AssetKind,
	type DeclaredVariable,
	type EditorAsset,
	type EditorComment,
	type JsonValue,
	type ProjectSettings,
	type RiskLevel,
	type ScriptNodeData,
	type ScriptSetting,
	type SecretDeclaration,
	scriptSettingTypes,
} from "@/lib/types";
import { isSelfConnection, withEdgeExecutionOrder } from "@/utils/editor-graph";
import { DEFAULT_SCRIPT_VERSION } from "@/utils/script-repository";
import { type EditorProject, editorProjectSchemaVersion, type ProjectSummary } from "./model";

export type StoredProjectRecord = {
	assetCount: number;
	assets: StoredAssetMetadata[];
	comments: EditorComment[];
	createdAt: string;
	declaredVariables: DeclaredVariable[];
	edgeStyle: EditorEdgeStyle;
	edges: StoredEdge[];
	id: string;
	nodes: StoredScriptNode[];
	revision: number;
	schemaVersion: number;
	secretDeclarations: SecretDeclaration[];
	scriptSettings: ScriptSetting[];
	settings: ProjectSettings;
	updatedAt: string;
};

export type StoredAssetMetadata = {
	createdAt: string;
	fileLastModified: number;
	fileName: string;
	fileType: string;
	id: string;
	kind: AssetKind;
	mediaType: string;
	name: string;
	packagePath: string;
	size: number;
};

export type StoredProjectAsset = {
	assetId: string;
	blob: Blob;
	fingerprint?: string;
	key: string;
	projectId: string;
};

type StoredScriptNode = {
	actionType: ActionType;
	config: Record<string, JsonValue>;
	id: string;
	position: { x: number; y: number };
};

type StoredEdge = {
	executionOrder: number;
	id: string;
	source: string;
	sourceHandle: string;
	target: string;
	targetHandle: string;
};

export function toStoredProject(project: EditorProject): StoredProjectRecord {
	return {
		assetCount: project.assets.length,
		assets: project.assets.map(toStoredAssetMetadata),
		comments: project.comments.map(cloneEditorComment),
		createdAt: project.identity.createdAt,
		declaredVariables: structuredClone(project.declaredVariables),
		edgeStyle: project.edgeStyle,
		edges: project.edges.map(toStoredEdge),
		id: project.identity.id,
		nodes: project.nodes.map(toStoredNode),
		revision: project.revision,
		schemaVersion: editorProjectSchemaVersion,
		secretDeclarations: structuredClone(project.secretDeclarations),
		scriptSettings: structuredClone(project.scriptSettings),
		settings: structuredClone(project.settings),
		updatedAt: project.updatedAt,
	};
}

export function toStoredProjectAsset(projectId: string, asset: EditorAsset): StoredProjectAsset {
	return {
		assetId: asset.id,
		blob: asset.file,
		fingerprint: assetStorageFingerprint(asset),
		key: projectAssetKey(projectId, asset.id),
		projectId,
	};
}

export function assetStorageFingerprint(asset: EditorAsset) {
	return JSON.stringify(toStoredAssetMetadata(asset));
}

export function projectAssetKey(projectId: string, assetId: string) {
	return `${projectId}\u0000${assetId}`;
}

export function hydrateProject(recordValue: unknown, assetValues: unknown[]): EditorProject {
	const record = requireStoredProjectRecord(recordValue);
	const assetsById = new Map(
		assetValues.map((value) => {
			const asset = requireStoredProjectAsset(value, record.id);
			return [asset.assetId, asset] as const;
		}),
	);

	const assets = record.assets.map((metadata) => {
		const storedAsset = assetsById.get(metadata.id);
		if (!storedAsset) {
			throw new Error(`Project ${record.id} is missing stored asset ${metadata.id}.`);
		}
		if (storedAsset.blob.size !== metadata.size) {
			throw new Error(`Project ${record.id} asset ${metadata.id} has an invalid stored size.`);
		}

		return {
			...metadata,
			file: new File([storedAsset.blob], metadata.fileName, {
				lastModified: metadata.fileLastModified,
				type: metadata.fileType || metadata.mediaType,
			}),
		};
	});

	return {
		assets,
		comments: record.comments,
		declaredVariables: record.declaredVariables,
		edgeStyle: record.edgeStyle,
		edges: record.edges.map(fromStoredEdge),
		identity: { id: record.id, createdAt: record.createdAt },
		nodes: record.nodes.map(fromStoredNode),
		revision: record.revision,
		schemaVersion: editorProjectSchemaVersion,
		secretDeclarations: record.secretDeclarations,
		scriptSettings: record.scriptSettings,
		settings: record.settings,
		updatedAt: record.updatedAt,
	};
}

export function toProjectSummary(recordValue: unknown): ProjectSummary {
	const record = requireStoredProjectRecord(recordValue);
	return {
		assetCount: record.assets.length,
		createdAt: record.createdAt,
		edgeCount: record.edges.length,
		id: record.id,
		name: record.settings.name,
		nodeCount: record.nodes.length,
		revision: record.revision,
		targetRuntimes: record.settings.targetRuntimes,
		updatedAt: record.updatedAt,
	};
}

export function projectContentSignature(project: EditorProject) {
	const stored = toStoredProject(project);
	return JSON.stringify({
		assets: stored.assets,
		comments: stored.comments,
		declaredVariables: stored.declaredVariables,
		edgeStyle: stored.edgeStyle,
		edges: stored.edges,
		nodes: stored.nodes,
		secretDeclarations: stored.secretDeclarations,
		scriptSettings: stored.scriptSettings,
		settings: stored.settings,
	});
}

function toStoredNode(node: Node<ScriptNodeData>): StoredScriptNode {
	return {
		actionType: node.data.actionType,
		config: structuredClone(node.data.config),
		id: node.id,
		position: finitePosition(node.position),
	};
}

function fromStoredNode(node: StoredScriptNode): Node<ScriptNodeData> {
	const definition = getNodeDefinition(node.actionType);
	if (!definition) {
		throw new Error(`Stored project uses unsupported node action type ${node.actionType}.`);
	}
	const ports = getNodePorts(node.actionType, node.config);
	return {
		id: node.id,
		position: finitePosition(node.position),
		type: "scriptNode",
		data: {
			actionType: node.actionType,
			config: structuredClone(node.config),
			inputs: ports.inputs,
			kind: definition.kind,
			label:
				definition.kind === "trigger" && !definition.label.endsWith("Trigger")
					? `${definition.label} Trigger`
					: definition.label,
			outputs: ports.outputs,
			risk: definition.risk as RiskLevel,
			runtimeOutputs: getRuntimeDataOutputs(node.actionType, node.config),
		},
	};
}

function toStoredEdge(edge: Edge): StoredEdge {
	const executionOrder = edge.data?.executionOrder;
	if (!Number.isSafeInteger(executionOrder) || (executionOrder as number) < 0) {
		throw new Error(`Edge ${edge.id} is missing a valid execution order.`);
	}
	if (!edge.sourceHandle || !edge.targetHandle || isSelfConnection(edge)) {
		throw new Error(`Edge ${edge.id} is not a valid project connection.`);
	}

	return {
		executionOrder: executionOrder as number,
		id: edge.id,
		source: edge.source,
		sourceHandle: edge.sourceHandle,
		target: edge.target,
		targetHandle: edge.targetHandle,
	};
}

function fromStoredEdge(edge: StoredEdge): Edge {
	return withEdgeExecutionOrder(
		{
			id: edge.id,
			source: edge.source,
			sourceHandle: edge.sourceHandle,
			target: edge.target,
			targetHandle: edge.targetHandle,
		},
		edge.executionOrder,
	);
}

function toStoredAssetMetadata(asset: EditorAsset): StoredAssetMetadata {
	return {
		createdAt: asset.createdAt,
		fileLastModified: asset.file.lastModified,
		fileName: asset.file.name,
		fileType: asset.file.type,
		id: asset.id,
		kind: asset.kind,
		mediaType: asset.mediaType,
		name: asset.name,
		packagePath: asset.packagePath,
		size: asset.size,
	};
}

function requireStoredProjectRecord(value: unknown): StoredProjectRecord {
	value = migrateStoredProjectRecord(value);
	if (!isRecord(value)) {
		throw new Error("Stored project record is not an object.");
	}
	if (
		value.schemaVersion !== editorProjectSchemaVersion ||
		typeof value.id !== "string" ||
		!isUuid(value.id) ||
		!isIsoDate(value.createdAt) ||
		!isIsoDate(value.updatedAt) ||
		!Number.isSafeInteger(value.revision) ||
		(value.revision as number) < 1 ||
		!isProjectSettings(value.settings) ||
		!Array.isArray(value.nodes) ||
		!Array.isArray(value.edges) ||
		!Array.isArray(value.comments) ||
		!Array.isArray(value.assets) ||
		!Array.isArray(value.secretDeclarations) ||
		!Array.isArray(value.scriptSettings) ||
		!Array.isArray(value.declaredVariables) ||
		!value.nodes.every(isStoredNode) ||
		!value.edges.every(isStoredEdge) ||
		!value.comments.every(isEditorComment) ||
		!value.assets.every(isStoredAssetMetadata) ||
		!value.secretDeclarations.every(isSecretDeclaration) ||
		!value.scriptSettings.every(isScriptSetting) ||
		!value.declaredVariables.every(isDeclaredVariable) ||
		typeof value.edgeStyle !== "string" ||
		!isEditorEdgeStyle(value.edgeStyle)
	) {
		throw new Error("Stored project record does not match the current editor project schema.");
	}

	return value as StoredProjectRecord;
}

function requireStoredProjectAsset(value: unknown, projectId: string): StoredProjectAsset {
	if (
		!isRecord(value) ||
		value.projectId !== projectId ||
		typeof value.assetId !== "string" ||
		typeof value.key !== "string" ||
		(value.fingerprint !== undefined && typeof value.fingerprint !== "string") ||
		!(value.blob instanceof Blob)
	) {
		throw new Error(`Project ${projectId} contains an invalid asset record.`);
	}
	return value as StoredProjectAsset;
}

function isProjectSettings(value: unknown): value is ProjectSettings {
	return (
		isRecord(value) &&
		typeof value.name === "string" &&
		typeof value.version === "string" &&
		typeof value.repositoryUrl === "string" &&
		typeof value.description === "string" &&
		typeof value.author === "string" &&
		typeof value.website === "string" &&
		typeof value.source === "string" &&
		Array.isArray(value.tags) &&
		value.tags.every((tag) => typeof tag === "string") &&
		Array.isArray(value.targetRuntimes) &&
		value.targetRuntimes.length > 0 &&
		value.targetRuntimes.every(
			(runtime) =>
				typeof runtime === "string" && targetRuntimes.includes(runtime as ProjectSettings["targetRuntimes"][number]),
		) &&
		new Set(value.targetRuntimes).size === value.targetRuntimes.length &&
		typeof value.minimumRunnerVersion === "string"
	);
}

function migrateStoredProjectRecord(value: unknown): unknown {
	if (!isRecord(value) || !isRecord(value.settings) || ![1, 2, 3, 4, 5].includes(Number(value.schemaVersion))) {
		return value;
	}

	const migratedTargetRuntimes = migrateTargetRuntimes(value.settings);
	return {
		...value,
		nodes: Array.isArray(value.nodes) ? value.nodes.map(migrateStoredNode) : value.nodes,
		schemaVersion: editorProjectSchemaVersion,
		scriptSettings: Array.isArray(value.scriptSettings) ? value.scriptSettings.map(migrateStoredTypedDeclaration) : [],
		declaredVariables: Array.isArray(value.declaredVariables)
			? value.declaredVariables.map(migrateStoredTypedDeclaration)
			: value.declaredVariables,
		secretDeclarations: Array.isArray(value.secretDeclarations)
			? value.secretDeclarations.map((declaration) =>
					isRecord(declaration) ? { ...declaration, type: "string" } : declaration,
				)
			: value.secretDeclarations,
		settings: {
			...value.settings,
			version: typeof value.settings.version === "string" ? value.settings.version : DEFAULT_SCRIPT_VERSION,
			repositoryUrl: typeof value.settings.repositoryUrl === "string" ? value.settings.repositoryUrl : "",
			targetRuntimes: migratedTargetRuntimes,
		},
	};
}

function migrateStoredTypedDeclaration(value: unknown): unknown {
	if (!isRecord(value) || value.type !== "list" || typeof value.itemType === "string") {
		return value;
	}
	const candidate = value.value ?? value.defaultValue ?? value.simulationValue;
	if (!isJsonValue(candidate)) {
		return value;
	}
	const itemType = inferListItemType(candidate);
	return itemType ? { ...value, itemType } : value;
}

function migrateStoredNode(value: unknown): unknown {
	if (!isRecord(value) || !isRecord(value.config)) {
		return value;
	}

	const config = { ...value.config };
	if (value.actionType === "control.for_each") {
		delete config.itemVariable;
		delete config.indexVariable;
	}
	if (value.actionType === "runtime.set_variable") {
		const operation = typeof config.operation === "string" ? config.operation : "set";
		const targetType = typeof config.valueType === "string" ? config.valueType : "string";
		const parsedValue = parseStoredConfigValue(config.value);
		if (
			(targetType === "list" || operation === "append_list" || operation === "remove_list_items") &&
			typeof config.itemType !== "string"
		) {
			const inferred =
				operation === "append_list" || operation === "remove_list_items"
					? parsedValue === undefined
						? undefined
						: inferTypedValueType(parsedValue)
					: parsedValue === undefined
						? undefined
						: inferListItemType(parsedValue);
			if (inferred) config.itemType = inferred;
		}
		if (operation === "set_object_field" && typeof config.fieldValueType !== "string" && parsedValue !== undefined) {
			const inferred = Array.isArray(parsedValue) ? "list" : inferTypedValueType(parsedValue);
			if (inferred) config.fieldValueType = inferred;
			if (inferred === "list" && typeof config.fieldItemType !== "string") {
				const itemType = inferListItemType(parsedValue);
				if (itemType) config.fieldItemType = itemType;
			}
		}
	}
	return { ...value, config };
}

function parseStoredConfigValue(value: unknown): JsonValue | undefined {
	if (isJsonValue(value) && typeof value !== "string") {
		return value;
	}
	if (typeof value !== "string" || /^\{\{\s*[^{}]+\s*\}\}$/.test(value.trim())) {
		return undefined;
	}
	try {
		const parsed = JSON.parse(value) as unknown;
		return isJsonValue(parsed) ? parsed : undefined;
	} catch {
		return value;
	}
}

function migrateTargetRuntimes(settings: Record<string, unknown>): ProjectSettings["targetRuntimes"] {
	if (Array.isArray(settings.targetRuntimes)) {
		const valid = settings.targetRuntimes.filter(
			(value): value is ProjectSettings["targetRuntimes"][number] =>
				typeof value === "string" && targetRuntimes.includes(value as ProjectSettings["targetRuntimes"][number]),
		);
		if (valid.length > 0) {
			return [...new Set(valid)];
		}
	}

	switch (settings.targetRuntime) {
		case "Linux Headless":
		case "Windows Headless":
		case "Windows Desktop":
		case "Linux Desktop":
			return [settings.targetRuntime];
		case "Generic Headless":
			return ["Windows Headless", "Linux Headless"];
		default:
			return ["Windows Desktop", "Linux Desktop"];
	}
}

function isStoredNode(value: unknown): value is StoredScriptNode {
	return (
		isRecord(value) &&
		typeof value.id === "string" &&
		typeof value.actionType === "string" &&
		getNodeDefinition(value.actionType as ActionType) !== undefined &&
		isJsonObject(value.config) &&
		isFinitePosition(value.position)
	);
}

function isStoredEdge(value: unknown): value is StoredEdge {
	return (
		isRecord(value) &&
		Number.isSafeInteger(value.executionOrder) &&
		(value.executionOrder as number) >= 0 &&
		["id", "source", "sourceHandle", "target", "targetHandle"].every(
			(key) => typeof value[key] === "string" && value[key].length > 0,
		) &&
		value.source !== value.target
	);
}

function isEditorComment(value: unknown): value is EditorComment {
	return (
		isRecord(value) &&
		typeof value.id === "string" &&
		typeof value.text === "string" &&
		isFinitePosition(value.position) &&
		isRecord(value.size) &&
		typeof value.size.width === "number" &&
		Number.isFinite(value.size.width) &&
		typeof value.size.height === "number" &&
		Number.isFinite(value.size.height) &&
		["amber", "blue", "green", "rose", "violet"].includes(String(value.color)) &&
		typeof value.fontSize === "number" &&
		Number.isFinite(value.fontSize)
	);
}

function isStoredAssetMetadata(value: unknown): value is StoredAssetMetadata {
	return (
		isRecord(value) &&
		["id", "mediaType", "name", "packagePath", "createdAt", "fileName", "fileType"].every(
			(key) => typeof value[key] === "string",
		) &&
		["audio", "image", "text"].includes(String(value.kind)) &&
		typeof value.size === "number" &&
		Number.isSafeInteger(value.size) &&
		value.size >= 0 &&
		typeof value.fileLastModified === "number" &&
		Number.isFinite(value.fileLastModified) &&
		isIsoDate(value.createdAt)
	);
}

function isSecretDeclaration(value: unknown): value is SecretDeclaration {
	return (
		isRecord(value) &&
		typeof value.name === "string" &&
		typeof value.description === "string" &&
		typeof value.required === "boolean" &&
		value.type === "string"
	);
}

function isScriptSetting(value: unknown): value is ScriptSetting {
	const type = isRecord(value) && typeof value.type === "string" ? value.type : "";
	const itemType = isRecord(value) ? normalizeListItemType(value.itemType) : undefined;
	if (
		!isRecord(value) ||
		typeof value.name !== "string" ||
		typeof value.description !== "string" ||
		typeof value.required !== "boolean" ||
		!scriptSettingTypes.includes(type as ScriptSetting["type"]) ||
		(type === "list" ? !itemType : value.itemType !== undefined)
	) {
		return false;
	}

	return (
		(value.defaultValue === undefined ||
			(isJsonValue(value.defaultValue) &&
				validateTypedValue(type as ScriptSetting["type"], value.defaultValue, itemType) === null)) &&
		(value.simulationValue === undefined ||
			(isJsonValue(value.simulationValue) &&
				validateTypedValue(type as ScriptSetting["type"], value.simulationValue, itemType) === null))
	);
}

function cloneEditorComment(comment: EditorComment): EditorComment {
	return {
		id: comment.id,
		text: comment.text,
		position: structuredClone(comment.position),
		size: structuredClone(comment.size),
		color: comment.color,
		fontSize: comment.fontSize,
	};
}

function finitePosition(position: { x: number; y: number }) {
	return {
		x: Number.isFinite(position.x) ? position.x : 0,
		y: Number.isFinite(position.y) ? position.y : 0,
	};
}

function isUuid(value: string) {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isIsoDate(value: unknown): value is string {
	return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isDeclaredVariable(value: unknown): value is DeclaredVariable {
	const type = isRecord(value) && typeof value.type === "string" ? value.type : "";
	const itemType = isRecord(value) ? normalizeListItemType(value.itemType) : undefined;
	return (
		isRecord(value) &&
		typeof value.name === "string" &&
		typeof value.description === "string" &&
		(value.scope === "runtime" || value.scope === "persistent") &&
		variableTypes.includes(type as DeclaredVariable["type"]) &&
		(type === "list" ? !!itemType : value.itemType === undefined) &&
		isJsonValue(value.value) &&
		validateTypedValue(type as DeclaredVariable["type"], value.value, itemType) === null
	);
}

function isFinitePosition(value: unknown): value is { x: number; y: number } {
	return (
		isRecord(value) &&
		typeof value.x === "number" &&
		Number.isFinite(value.x) &&
		typeof value.y === "number" &&
		Number.isFinite(value.y)
	);
}

function isJsonObject(value: unknown): value is Record<string, JsonValue> {
	return isRecord(value) && Object.values(value).every(isJsonValue);
}

function isJsonValue(value: unknown): value is JsonValue {
	if (value === null || typeof value === "string" || typeof value === "boolean") return true;
	if (typeof value === "number") return Number.isFinite(value);
	if (Array.isArray(value)) return value.every(isJsonValue);
	return isRecord(value) && Object.values(value).every(isJsonValue);
}
