import type { Edge, Node } from "@xyflow/react";
import type { EditorEdgeStyle } from "@/data/editor/flow-canvas";
import { toAssetManifestEntry } from "@/data/project/assets";
import { packageLimits } from "@/data/project/package-limits";
import type { ProjectIdentity } from "@/data/projects/model";
import type {
	DeclaredVariable,
	EditorAsset,
	EditorComment,
	JsonValue,
	ProjectSettings,
	ScriptNodeData,
	ScriptSetting,
	SecretDeclaration,
} from "@/lib/types";
import { EDITOR_CREATED_WITH } from "@/lib/version";
import { calculateCapabilities, calculatePermissions, calculateRiskLevel, toProgramJson } from "./analysis";

export type BbsPackageMetadataParams = {
	identity: ProjectIdentity;
	projectSettings: ProjectSettings;
	nodes: Node<ScriptNodeData>[];
	edges: Edge[];
	assets: EditorAsset[];
	comments: EditorComment[];
	edgeStyle: EditorEdgeStyle;
	secretDeclarations: SecretDeclaration[];
	declaredVariables: DeclaredVariable[];
	scriptSettings: ScriptSetting[];
};

export type BbsPackageMetadata = {
	capabilitiesJson: Record<string, unknown>;
	editorJson: Record<string, unknown>;
	manifestJson: Record<string, unknown>;
	permissionsJson: Record<string, unknown>;
	programJson: Record<string, unknown>;
};

export const EDITOR_PACKAGE_FILE = "editor.json";
export const EDITOR_METADATA_FORMAT_VERSION = 1;

const DEFAULT_COMMENT_FONT_SIZE = 14;
const MIN_COMMENT_FONT_SIZE = 12;
const MAX_COMMENT_FONT_SIZE = 72;

export function createBbsPackageMetadata(params: BbsPackageMetadataParams): BbsPackageMetadata {
	const permissions = calculatePermissions(params.nodes, params.secretDeclarations, params.declaredVariables);
	const capabilities = calculateCapabilities(params.nodes, params.secretDeclarations, params.declaredVariables);
	const assetManifest = params.assets.map(toAssetManifestEntry);
	const now = new Date().toISOString();

	return {
		manifestJson: compactObject({
			format_version: 1,
			script_language_version: 1,
			id: params.identity.id,
			name: params.projectSettings.name,
			version: params.projectSettings.version,
			repository_url: params.projectSettings.repositoryUrl,
			description: params.projectSettings.description,
			author: params.projectSettings.author,
			website: params.projectSettings.website,
			source: params.projectSettings.source,
			created_with: EDITOR_CREATED_WITH,
			created_at: params.identity.createdAt,
			updated_at: now,
			tags: params.projectSettings.tags,
			minimum_runner_version: params.projectSettings.minimumRunnerVersion,
			assets: assetManifest.map((asset) => ({
				id: asset.id,
				kind: asset.kind,
				media_type: asset.mediaType,
				name: asset.name,
				path: asset.packagePath,
				size: asset.size,
			})),
			secrets: params.secretDeclarations.map((secret) => ({
				name: secret.name,
				type: secret.type,
				description: secret.description,
				required: secret.required,
			})),
			variables: params.declaredVariables.map((variable) => ({
				name: variable.name,
				scope: variable.scope,
				type: variable.type,
				...(variable.type === "list" ? { item_type: variable.itemType } : {}),
				description: variable.description,
				value: variable.value,
			})),
			settings: params.scriptSettings.map((setting) =>
				compactObject({
					name: setting.name,
					type: setting.type,
					item_type: setting.type === "list" ? setting.itemType : undefined,
					description: setting.description,
					required: setting.required,
					default_value: setting.defaultValue,
				}),
			),
		}),
		programJson: toProgramJson(params.nodes, params.edges, {
			identity: params.identity,
			settings: params.projectSettings,
		}) as Record<string, unknown>,
		editorJson: toEditorJson(params.nodes, params.comments, params.edgeStyle),
		permissionsJson: {
			declared_permissions: permissions.map((permission) => permission.name),
			risk_level: calculateRiskLevel(permissions),
		},
		capabilitiesJson: {
			required_capabilities: capabilities.map((capability) => capability.name),
			target_runtimes: params.projectSettings.targetRuntimes,
		},
	};
}

export function toPackageJsonFiles(metadata: BbsPackageMetadata): Record<string, unknown> {
	return {
		"manifest.json": metadata.manifestJson,
		"program.json": metadata.programJson,
		[EDITOR_PACKAGE_FILE]: metadata.editorJson,
		"permissions.json": metadata.permissionsJson,
		"capabilities.json": metadata.capabilitiesJson,
	};
}

export function getBbsPackageMetadataSizes(metadata: BbsPackageMetadata) {
	return [
		metadata.manifestJson,
		metadata.programJson,
		metadata.editorJson,
		metadata.permissionsJson,
		metadata.capabilitiesJson,
	].map((value) => new TextEncoder().encode(JSON.stringify(value, null, 2)).byteLength);
}

export function getBbsPackageSizeErrors(metadata: BbsPackageMetadata, assets: EditorAsset[]) {
	const metadataSizes = getBbsPackageMetadataSizes(metadata);
	const packageSize =
		metadataSizes.reduce((total, size) => total + size, 0) + assets.reduce((total, asset) => total + asset.size, 0);
	const errors: string[] = [];

	for (const size of metadataSizes) {
		if (size > packageLimits.max_metadata_bytes) {
			errors.push(`Export metadata exceeds the maximum of ${packageLimits.max_metadata_bytes} bytes per file.`);
			break;
		}
	}
	if (packageSize > packageLimits.max_total_uncompressed_bytes) {
		errors.push(
			`Export package exceeds the maximum of ${packageLimits.max_total_uncompressed_bytes} uncompressed bytes.`,
		);
	}
	if (assets.length + 6 > packageLimits.max_entry_count) {
		errors.push(`Export package exceeds the maximum of ${packageLimits.max_entry_count} entries.`);
	}

	return errors;
}

function compactObject(value: Record<string, unknown>) {
	return Object.fromEntries(
		Object.entries(value).filter(([, entry]) => {
			if (Array.isArray(entry)) {
				return entry.length > 0;
			}

			return entry !== "";
		}),
	);
}

function toEditorJson(nodes: Node<ScriptNodeData>[], comments: EditorComment[], edgeStyle: EditorEdgeStyle) {
	return {
		format_version: EDITOR_METADATA_FORMAT_VERSION,
		created_with: EDITOR_CREATED_WITH,
		canvas: {
			edge_style: edgeStyle,
		},
		nodes: nodes.map((node) => ({
			id: node.id,
			position: {
				x: finiteNumberOrZero(node.position.x),
				y: finiteNumberOrZero(node.position.y),
			},
		})),
		comments: comments.map((comment) => ({
			id: comment.id,
			text: comment.text,
			color: comment.color,
			font_size: finiteNumberInRangeOrDefault(
				comment.fontSize,
				DEFAULT_COMMENT_FONT_SIZE,
				MIN_COMMENT_FONT_SIZE,
				MAX_COMMENT_FONT_SIZE,
			),
			position: {
				x: finiteNumberOrZero(comment.position.x),
				y: finiteNumberOrZero(comment.position.y),
			},
			size: {
				width: finitePositiveNumberOrDefault(comment.size.width, 320),
				height: finitePositiveNumberOrDefault(comment.size.height, 196),
			},
		})),
	} satisfies Record<string, JsonValue>;
}

function finiteNumberOrZero(value: number) {
	return Number.isFinite(value) ? value : 0;
}

function finitePositiveNumberOrDefault(value: number, fallback: number) {
	return Number.isFinite(value) && value > 0 ? value : fallback;
}

function finiteNumberInRangeOrDefault(value: number | undefined, fallback: number, min: number, max: number) {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return fallback;
	}

	return Math.min(max, Math.max(min, value));
}
