import type { Edge, Node } from "@xyflow/react";
import { type EditorEdgeStyle, isEditorEdgeStyle } from "@/data/editor/flow-canvas";
import {
	getTargetRuntimeCompatibilityErrors as getRegistryTargetRuntimeCompatibilityErrors,
	validateNodeConfig,
	validateNodeGraph,
} from "@/data/nodes/registry";
import { isAllowedPackageFile, validateEditorAssets, validatePackageAssetPaths } from "@/data/project/assets";
import { builtInVariableNames } from "@/data/project/built-in-variables";
import type { VariableReferenceCandidate } from "@/data/project/variables";
import {
	createConfiguredVariableDefinitions,
	createNodeOutputVariables,
	normalizeVariableReferenceName,
} from "@/data/project/variables";
import type {
	DeclaredVariable,
	EditorAsset,
	EditorComment,
	PermissionSummary,
	ProjectSettings,
	ScriptNodeData,
	ScriptSetting,
	SecretDeclaration,
	TargetRuntime,
} from "@/lib/types";
import { getEdgeExecutionOrderErrors, isSelfConnection } from "@/utils/editor-graph";
import type { ProjectIdentity } from "../data/projects/model";
import {
	type BbsPackageMetadata,
	createBbsPackageMetadata,
	getBbsPackageSizeErrors,
	toPackageJsonFiles,
} from "./bbs-package-metadata";
import {
	validateCapabilitiesContract,
	validateDeclaredVariableProgramContract,
	validateEditorContract,
	validateManifestContract,
	validatePackageJsonContracts,
	validatePermissionsContract,
	validateProgramContract,
} from "./package-contract";

export type VerificationOutcome = "passed" | "warning" | "failed";
export type VerificationStatus = "unverified" | "verified" | "warning" | "failed";

export type VerificationCheck = {
	description: string;
	details?: string[];
	id: string;
	message: string;
	outcome: VerificationOutcome;
	title: string;
};

type VerificationRule<Context> = {
	description: string;
	id: string;
	run: (
		context: Context,
	) => Pick<VerificationCheck, "message" | "outcome"> & Partial<Pick<VerificationCheck, "details">>;
	title: string;
};

type CreateVerificationChecksOptions = {
	assets: EditorAsset[];
	comments?: EditorComment[];
	declaredVariables?: DeclaredVariable[];
	edgeStyle?: EditorEdgeStyle;
	edges: Edge[];
	identity?: ProjectIdentity;
	nodes: Node<ScriptNodeData>[];
	permissions: PermissionSummary[];
	projectSettings?: ProjectSettings;
	secretDeclarations?: SecretDeclaration[];
	scriptName: string;
	scriptSettings?: ScriptSetting[];
	targetRuntimes: TargetRuntime[];
	variables?: readonly VariableReferenceCandidate[];
};

type EditorVerificationContext = CreateVerificationChecksOptions & {
	packageBuildErrors: string[];
	packageJsonFiles: Record<string, unknown> | null;
	packageMetadata: BbsPackageMetadata | null;
	packageSizeErrors: string[];
};

export type PackageVerificationContext = {
	fileNames: string[];
	jsonFiles: Record<string, unknown>;
	parseErrors: Record<string, string>;
};

export type VerificationSummary = {
	failed: number;
	passed: number;
	status: VerificationStatus;
	warnings: number;
};

export function createVerificationChecks(options: CreateVerificationChecksOptions): VerificationCheck[] {
	const context = createEditorVerificationContext(options);
	return editorVerificationRules.map((rule) => {
		const result = rule.run(context);
		return {
			id: rule.id,
			title: rule.title,
			description: rule.description,
			...result,
		};
	});
}

export function createPackageVerificationChecks(context: PackageVerificationContext): VerificationCheck[] {
	return packageVerificationRules.map((rule) => {
		const result = rule.run(context);
		return {
			id: rule.id,
			title: rule.title,
			description: rule.description,
			...result,
		};
	});
}

export function summarizeVerification(checks: VerificationCheck[]): VerificationSummary {
	const failed = checks.filter((check) => check.outcome === "failed").length;
	const warnings = checks.filter((check) => check.outcome === "warning").length;
	const passed = checks.filter((check) => check.outcome === "passed").length;

	return {
		failed,
		warnings,
		passed,
		status: failed > 0 ? "failed" : warnings > 0 ? "warning" : "verified",
	};
}

export function getVerificationFindings(
	checks: VerificationCheck[],
	outcomes: VerificationOutcome[] = ["failed", "warning"],
) {
	const matchingChecks = checks.filter((check) => outcomes.includes(check.outcome));
	const specificChecks = matchingChecks.filter((check) => check.id !== "export-readiness");
	return (specificChecks.length > 0 ? specificChecks : matchingChecks).flatMap((check) =>
		(check.details?.length ? check.details : [check.message]).map((detail) => `${check.title}: ${detail}`),
	);
}

function createEditorVerificationContext(options: CreateVerificationChecksOptions): EditorVerificationContext {
	const { identity, projectSettings } = options;
	const missingInputs = [
		...(!identity ? ["Project identity is not available."] : []),
		...(!projectSettings ? ["Project settings are not available."] : []),
	];

	if (!identity || !projectSettings) {
		return {
			...options,
			packageBuildErrors: missingInputs,
			packageJsonFiles: null,
			packageMetadata: null,
			packageSizeErrors: [],
		};
	}

	try {
		const packageMetadata = createBbsPackageMetadata({
			assets: options.assets,
			comments: options.comments ?? [],
			declaredVariables: options.declaredVariables ?? [],
			edges: options.edges,
			edgeStyle: options.edgeStyle ?? "bezier",
			identity,
			nodes: options.nodes,
			projectSettings,
			secretDeclarations: options.secretDeclarations ?? [],
			scriptSettings: options.scriptSettings ?? [],
		});

		return {
			...options,
			packageBuildErrors: [],
			packageJsonFiles: toPackageJsonFiles(packageMetadata),
			packageMetadata,
			packageSizeErrors: getBbsPackageSizeErrors(packageMetadata, options.assets),
		};
	} catch (error) {
		return {
			...options,
			packageBuildErrors: [error instanceof Error ? error.message : "Package metadata could not be generated."],
			packageJsonFiles: null,
			packageMetadata: null,
			packageSizeErrors: [],
		};
	}
}

function packageBuildFailureResult(context: EditorVerificationContext) {
	return {
		outcome: "failed" as const,
		message: "Package metadata could not be generated.",
		details: context.packageBuildErrors,
	};
}

const editorVerificationRules: VerificationRule<EditorVerificationContext>[] = [
	{
		id: "metadata",
		title: "Script metadata",
		description: "Checking script identity and target runtimes.",
		run: ({ scriptName, targetRuntimes }) => {
			const name = scriptName.trim();
			const details = [
				...(!name ? ["Project Settings > Script name: enter a name for the script."] : []),
				...(targetRuntimes.length === 0 ? ["Project Settings > Target runtimes: select at least one runtime."] : []),
			];
			return {
				outcome: details.length === 0 ? "passed" : "failed",
				message: details.length === 0 ? `${name} targets ${targetRuntimes.join(", ")}.` : "Script metadata is invalid.",
				...(details.length > 0 ? { details } : {}),
			};
		},
	},
	{
		id: "secret-references",
		title: "Secret references",
		description: "Checking secret declarations and writable variable conflicts.",
		run: ({ declaredVariables, nodes, secretDeclarations }) => {
			const declarations = secretDeclarations ?? [];
			const writableNames = new Set([
				...createConfiguredVariableDefinitions(nodes).map((variable) => variable.name),
				...(declaredVariables ?? []).map((variable) => variable.name),
			]);
			const names = new Set<string>();
			const problems = declarations.flatMap((secret) => {
				const errors = [];
				if (names.has(secret.name)) errors.push(`Secret "${secret.name}" is declared more than once.`);
				if (writableNames.has(secret.name)) errors.push(`Secret "${secret.name}" conflicts with a writable variable.`);
				names.add(secret.name);
				return errors;
			});
			return {
				outcome: problems.length === 0 ? "passed" : "failed",
				message:
					problems.length === 0
						? `${declarations.length} secret reference${declarations.length === 1 ? "" : "s"} declared.`
						: "Secret declarations contain conflicts.",
				...(problems.length > 0
					? { details: problems.map((problem) => `Variables > Secret references: ${problem}`) }
					: {}),
			};
		},
	},
	{
		id: "target-runtime",
		title: "Target runtimes",
		description: "Checking that nodes are compatible with every selected target runtime.",
		run: ({ nodes, targetRuntimes }) => {
			const incompatibleNodes = getTargetRuntimeCompatibilityErrors(nodes, targetRuntimes);

			return {
				outcome: incompatibleNodes.length === 0 ? "passed" : "failed",
				message:
					incompatibleNodes.length === 0
						? `${targetRuntimes.join(", ")} support all nodes in this script.`
						: "Some nodes do not support every selected target runtime.",
				...(incompatibleNodes.length > 0 ? { details: incompatibleNodes } : {}),
			};
		},
	},
	{
		id: "graph",
		title: "Graph structure",
		description: "Checking that the script contains runnable nodes.",
		run: ({ nodes }) => {
			const manualTriggers = nodes.filter((node) => node.data.actionType === "trigger.manual");
			const failureReasons = [
				...(nodes.length === 0 ? ["Canvas: no nodes exist. Add at least one trigger and its workflow nodes."] : []),
				...(manualTriggers.length > 1
					? [
							`Canvas: only one Manual Trigger is allowed, but these were found: ${manualTriggers.map(getNodeLocation).join(", ")}. Remove the extra Manual Trigger nodes.`,
						]
					: []),
			];

			return {
				outcome: failureReasons.length === 0 ? "passed" : "failed",
				message:
					failureReasons.length === 0
						? `${nodes.length} node${nodes.length === 1 ? "" : "s"} found.`
						: "The canvas graph cannot run.",
				...(failureReasons.length > 0 ? { details: failureReasons } : {}),
			};
		},
	},
	{
		id: "entry-points",
		title: "Entry points",
		description: "Checking trigger nodes that can start the script.",
		run: ({ nodes, variables }) => {
			const triggerCount = nodes.filter((node) => node.data.kind === "trigger").length;
			const invalidTriggerConfig = getInvalidNodeConfigKeys(
				nodes.filter((node) => node.data.kind === "trigger"),
				variables,
			);

			if (invalidTriggerConfig.length > 0) {
				return {
					outcome: "failed",
					message: "One or more trigger configurations are invalid.",
					details: invalidTriggerConfig,
				};
			}

			return {
				outcome: triggerCount > 0 ? "passed" : "failed",
				message:
					triggerCount > 0
						? `${triggerCount} trigger${triggerCount === 1 ? "" : "s"} available.`
						: "No trigger node was found.",
				...(triggerCount === 0
					? { details: ["Canvas > Triggers: add at least one trigger node that can start the script."] }
					: {}),
			};
		},
	},
	{
		id: "connections",
		title: "Connections",
		description: "Checking edge endpoints and port references.",
		run: ({ nodes, edges }) => {
			const connectionErrors = getConnectionVerificationErrors(nodes, edges);
			const orderErrors = getEdgeExecutionOrderErrors(edges);
			const details = [...connectionErrors, ...orderErrors.map((error) => `Connection execution order: ${error}`)];
			const valid = details.length === 0;
			return {
				outcome: valid ? "passed" : "failed",
				message: valid
					? `${edges.length} connection${edges.length === 1 ? "" : "s"} validated.`
					: "Connections are invalid.",
				...(details.length > 0 ? { details } : {}),
			};
		},
	},
	{
		id: "permissions",
		title: "Permissions",
		description: "Checking risk level and approval-sensitive capabilities.",
		run: ({ permissions }) => {
			const dangerousPermissions = permissions.filter((permission) => permission.risk === "dangerous");
			const highRiskPermissions = permissions.filter((permission) => permission.risk === "high");
			const mediumRiskPermissions = permissions.filter((permission) => permission.risk === "medium");
			const elevatedPermissionCount =
				dangerousPermissions.length + highRiskPermissions.length + mediumRiskPermissions.length;
			const elevatedPermissions = permissions.filter((permission) =>
				["dangerous", "high", "medium"].includes(permission.risk),
			);

			return {
				outcome: elevatedPermissionCount > 0 ? "warning" : "passed",
				message:
					elevatedPermissionCount > 0 ? "Elevated permissions require review." : "No elevated permissions detected.",
				...(elevatedPermissions.length > 0
					? {
							details: elevatedPermissions.map(
								(permission) =>
									`Project permissions > ${permission.name}: this permission has ${permission.risk} risk and must be reviewed before installing the package.`,
							),
						}
					: {}),
			};
		},
	},
	{
		id: "variables",
		title: "Variables",
		description: "Checking variable writes and read-only runtime references.",
		run: ({ assets, declaredVariables, edges, nodes, secretDeclarations, variables }) => {
			const invalidWrites = getInvalidVariableWrites(nodes, declaredVariables ?? []);
			const invalidGraphConfigs = getInvalidNodeGraphConfigs(nodes, edges, assets);
			const invalidNodeConfigKeys = getInvalidNodeConfigKeys(nodes, variables);
			const invalidDefaults = getInvalidDeclaredVariables(declaredVariables ?? [], secretDeclarations ?? []);
			const errors = [...invalidWrites, ...invalidGraphConfigs, ...invalidNodeConfigKeys, ...invalidDefaults];

			return {
				outcome: errors.length === 0 ? "passed" : "failed",
				message:
					errors.length === 0
						? "Variable writes, calculations, and action configs are valid."
						: "Variable or node configuration is invalid.",
				...(errors.length > 0 ? { details: errors } : {}),
			};
		},
	},
	{
		id: "assets",
		title: "Assets",
		description: "Checking packaged assets and file restrictions.",
		run: ({ assets, nodes }) => {
			const validation = validateEditorAssets(assets);
			const invalidReferences = nodes
				.filter((node) => node.data.actionType === "action.sound.play")
				.flatMap((node) => validateNodeGraph(node, { assets, edges: [], nodes }));

			if (validation.errors.length > 0 || invalidReferences.length > 0) {
				return {
					outcome: "failed",
					message: "Package assets or asset references are invalid.",
					details: [...validation.errors, ...invalidReferences],
				};
			}

			return {
				outcome: validation.warnings.length > 0 ? "warning" : "passed",
				message:
					validation.warnings.length > 0
						? "Package assets have warnings."
						: `${assets.length} package asset${assets.length === 1 ? "" : "s"} validated.`,
				...(validation.warnings.length > 0 ? { details: validation.warnings } : {}),
			};
		},
	},
	{
		id: "package-manifest",
		title: "Manifest",
		description: "Checking generated manifest metadata before export.",
		run: (context) => {
			if (!context.packageJsonFiles) {
				return packageBuildFailureResult(context);
			}

			const errors = validateManifestContract(context.packageJsonFiles["manifest.json"]);
			return {
				outcome: errors.length === 0 ? "passed" : "failed",
				message:
					errors.length === 0 ? "Generated manifest metadata is valid." : "Generated manifest metadata is invalid.",
				...(errors.length > 0 ? { details: errors } : {}),
			};
		},
	},
	{
		id: "package-program",
		title: "Program JSON",
		description: "Checking generated runner program metadata before export.",
		run: (context) => {
			if (!context.packageJsonFiles) {
				return packageBuildFailureResult(context);
			}

			const errors = [
				...validateProgramContract(context.packageJsonFiles["program.json"]),
				...validateDeclaredVariableProgramContract(
					context.packageJsonFiles["manifest.json"],
					context.packageJsonFiles["program.json"],
				),
			];
			return {
				outcome: errors.length === 0 ? "passed" : "failed",
				message:
					errors.length === 0 ? "Generated program metadata is valid." : "Generated program metadata is invalid.",
				...(errors.length > 0 ? { details: errors } : {}),
			};
		},
	},
	{
		id: "package-permissions",
		title: "Package permissions",
		description: "Checking generated permission declarations before export.",
		run: (context) => {
			if (!context.packageJsonFiles) {
				return packageBuildFailureResult(context);
			}

			const errors = validatePermissionsContract(
				context.packageJsonFiles["permissions.json"],
				context.packageJsonFiles["program.json"],
				context.packageJsonFiles["manifest.json"],
			);
			return {
				outcome: errors.length === 0 ? "passed" : "failed",
				message:
					errors.length === 0
						? "Generated permission declarations are valid."
						: "Generated permission declarations are invalid.",
				...(errors.length > 0 ? { details: errors } : {}),
			};
		},
	},
	{
		id: "package-capabilities",
		title: "Package capabilities",
		description: "Checking generated runtime capability declarations before export.",
		run: (context) => {
			if (!context.packageJsonFiles) {
				return packageBuildFailureResult(context);
			}

			const errors = validateCapabilitiesContract(
				context.packageJsonFiles["capabilities.json"],
				context.packageJsonFiles["program.json"],
				context.packageJsonFiles["manifest.json"],
			);
			return {
				outcome: errors.length === 0 ? "passed" : "failed",
				message:
					errors.length === 0
						? "Generated capability declarations are valid."
						: "Generated capability declarations are invalid.",
				...(errors.length > 0 ? { details: errors } : {}),
			};
		},
	},
	{
		id: "package-editor-metadata",
		title: "Editor metadata",
		description: "Checking generated editor layout metadata before export.",
		run: (context) => {
			if (!context.packageJsonFiles) {
				return packageBuildFailureResult(context);
			}

			const errors = validateEditorContract(context.packageJsonFiles["editor.json"]);
			return {
				outcome: errors.length === 0 ? "passed" : "failed",
				message: errors.length === 0 ? "Generated editor metadata is valid." : "Generated editor metadata is invalid.",
				...(errors.length > 0 ? { details: errors } : {}),
			};
		},
	},
	{
		id: "package-limits",
		title: "Package limits",
		description: "Checking generated metadata size and package entry limits before export.",
		run: (context) => {
			if (!context.packageMetadata) {
				return packageBuildFailureResult(context);
			}

			return {
				outcome: context.packageSizeErrors.length === 0 ? "passed" : "failed",
				message:
					context.packageSizeErrors.length === 0
						? "Generated package is within size and entry limits."
						: "Generated package exceeds export limits.",
				...(context.packageSizeErrors.length > 0 ? { details: context.packageSizeErrors } : {}),
			};
		},
	},
	{
		id: "serial",
		title: "Serial devices",
		description: "Checking serial device ids and write targets.",
		run: ({ nodes }) => {
			const invalidSerialConfig = nodes
				.filter(
					(node) => node.data.actionType === "trigger.serial_input" || node.data.actionType === "action.serial.write",
				)
				.flatMap((node) => validateNodeGraph(node, { assets: [], edges: [], nodes }));

			return {
				outcome: invalidSerialConfig.length === 0 ? "passed" : "failed",
				message:
					invalidSerialConfig.length === 0
						? "Serial device configuration is valid."
						: "Serial configuration is invalid.",
				...(invalidSerialConfig.length > 0 ? { details: invalidSerialConfig } : {}),
			};
		},
	},
	{
		id: "export-readiness",
		title: "Export readiness",
		description: "Checking whether the package can be prepared.",
		run: (context) => {
			const connectionErrors = getConnectionVerificationErrors(context.nodes, context.edges);
			const invalidEdgeOrders = getEdgeExecutionOrderErrors(context.edges);
			const triggerCount = context.nodes.filter((node) => node.data.kind === "trigger").length;
			const manualTriggers = context.nodes.filter((node) => node.data.actionType === "trigger.manual");
			const invalidVariableWrites = getInvalidVariableWrites(context.nodes, context.declaredVariables ?? []);
			const invalidGraphConfigs = getInvalidNodeGraphConfigs(context.nodes, context.edges, context.assets);
			const invalidNodeConfigKeys = getInvalidNodeConfigKeys(context.nodes, context.variables);
			const invalidAssets = validateEditorAssets(context.assets).errors;
			const invalidTargetRuntime = getTargetRuntimeCompatibilityErrors(context.nodes, context.targetRuntimes);
			const invalidDefaults = getInvalidDeclaredVariables(
				context.declaredVariables ?? [],
				context.secretDeclarations ?? [],
			);
			const packageContractErrors = context.packageJsonFiles
				? validatePackageJsonContracts(context.packageJsonFiles)
				: context.packageBuildErrors;
			const details = [
				...(!context.scriptName.trim() ? ["Project Settings > Script name: enter a name for the script."] : []),
				...(context.targetRuntimes.length === 0
					? ["Project Settings > Target runtimes: select at least one runtime."]
					: []),
				...(context.nodes.length === 0 ? ["Canvas: add nodes before exporting the script."] : []),
				...(triggerCount === 0 ? ["Canvas > Triggers: add at least one trigger node."] : []),
				...connectionErrors,
				...invalidEdgeOrders.map((error) => `Connection execution order: ${error}`),
				...(manualTriggers.length > 1
					? [
							`Canvas: only one Manual Trigger is allowed, but these were found: ${manualTriggers.map(getNodeLocation).join(", ")}.`,
						]
					: []),
				...invalidVariableWrites,
				...invalidGraphConfigs,
				...invalidNodeConfigKeys,
				...invalidDefaults,
				...invalidAssets,
				...invalidTargetRuntime,
				...packageContractErrors,
				...context.packageSizeErrors,
			];

			return {
				outcome: details.length === 0 ? "passed" : "failed",
				message:
					details.length === 0
						? "Script is ready for package export."
						: "Package export is blocked by the failed verification checks listed above.",
			};
		},
	},
];

const packageVerificationRules: VerificationRule<PackageVerificationContext>[] = [
	{
		id: "package-files",
		title: "Package files",
		description: "Checking required and allowed files inside the imported package.",
		run: ({ fileNames }) => {
			const missingFiles = getRequiredPackageFiles().filter((fileName) => !fileNames.includes(fileName));
			const disallowedFiles = fileNames.filter((fileName) => !isAllowedPackageFile(fileName));

			return {
				outcome: missingFiles.length === 0 && disallowedFiles.length === 0 ? "passed" : "failed",
				message:
					missingFiles.length === 0 && disallowedFiles.length === 0
						? "All required package files are present and package contents are allowed."
						: "Package files are incomplete or contain unsupported paths.",
				...(missingFiles.length > 0 || disallowedFiles.length > 0
					? {
							details: [
								...missingFiles.map((fileName) => `Package root > ${fileName}: required file is missing.`),
								...disallowedFiles.map(
									(fileName) => `Package entry "${fileName}": this path or file type is not allowed.`,
								),
							],
						}
					: {}),
			};
		},
	},
	{
		id: "package-assets",
		title: "Package assets",
		description: "Checking asset paths and supported file types.",
		run: ({ fileNames }) => {
			const validation = validatePackageAssetPaths(fileNames);

			if (validation.errors.length > 0) {
				return {
					outcome: "failed",
					message: "Package asset paths or file types are invalid.",
					details: validation.errors,
				};
			}

			return {
				outcome: validation.warnings.length > 0 ? "warning" : "passed",
				message: validation.warnings.length > 0 ? "Package assets have warnings." : "Package assets are valid.",
				...(validation.warnings.length > 0 ? { details: validation.warnings } : {}),
			};
		},
	},
	{
		id: "package-json",
		title: "Package JSON",
		description: "Checking that JSON package files can be parsed.",
		run: ({ parseErrors }) => {
			const failedFiles = Object.keys(parseErrors);

			return {
				outcome: failedFiles.length === 0 ? "passed" : "failed",
				message:
					failedFiles.length === 0
						? "Package JSON files parsed successfully."
						: "One or more package JSON files cannot be parsed.",
				...(failedFiles.length > 0
					? {
							details: failedFiles.map(
								(fileName) => `Package file "${fileName}": ${parseErrors[fileName] || "invalid JSON."}`,
							),
						}
					: {}),
			};
		},
	},
	{
		id: "package-contract",
		title: "Package contract",
		description: "Checking package schemas and recalculated declarations.",
		run: ({ jsonFiles, parseErrors }) => {
			if (Object.keys(parseErrors).length > 0) {
				return {
					outcome: "failed",
					message: "Package contract checks cannot run until the JSON files are valid.",
					details: Object.entries(parseErrors).map(
						([fileName, error]) => `Package file "${fileName}": ${error || "invalid JSON."}`,
					),
				};
			}

			const errors = validatePackageJsonContracts(jsonFiles);
			return {
				outcome: errors.length === 0 ? "passed" : "failed",
				message: errors.length === 0 ? "Package contract is internally consistent." : "Package contract is invalid.",
				...(errors.length > 0 ? { details: errors } : {}),
			};
		},
	},
	{
		id: "manifest",
		title: "Manifest",
		description: "Checking required manifest metadata.",
		run: ({ jsonFiles }) => {
			const manifest = asRecord(jsonFiles["manifest.json"]);
			const missingFields = [
				"format_version",
				"script_language_version",
				"id",
				"name",
				"created_with",
				"created_at",
				"minimum_runner_version",
			].filter((field) => !manifest || manifest[field] === undefined || manifest[field] === "");

			return {
				outcome: missingFields.length === 0 ? "passed" : "failed",
				message:
					missingFields.length === 0
						? `Manifest found for ${String(manifest?.name ?? "imported script")}.`
						: "Required manifest metadata is missing.",
				...(missingFields.length > 0
					? {
							details: missingFields.map(
								(field) => `manifest.json > ${field}: provide a non-empty value for this required field.`,
							),
						}
					: {}),
			};
		},
	},
	{
		id: "editor-metadata",
		title: "Editor metadata",
		description: "Checking optional editor layout metadata.",
		run: ({ jsonFiles }) => {
			if (jsonFiles["editor.json"] === undefined) {
				return {
					outcome: "passed",
					message: "No editor metadata found. Nodes will be laid out automatically on import.",
				};
			}

			const editorMetadata = asRecord(jsonFiles["editor.json"]);
			const nodes = Array.isArray(editorMetadata?.nodes) ? editorMetadata.nodes : null;
			const canvas = asRecord(editorMetadata?.canvas);
			const validCanvas =
				editorMetadata?.canvas === undefined ||
				(!!canvas &&
					(canvas.edge_style === undefined ||
						(typeof canvas.edge_style === "string" && isEditorEdgeStyle(canvas.edge_style))));
			const invalidNodes =
				nodes?.filter((node) => {
					const nodeRecord = asRecord(node);
					const position = asRecord(nodeRecord?.position);
					return (
						typeof nodeRecord?.id !== "string" ||
						typeof position?.x !== "number" ||
						typeof position?.y !== "number" ||
						!Number.isFinite(position.x) ||
						!Number.isFinite(position.y)
					);
				}) ?? [];
			const details = [
				...(!editorMetadata ? ['Package file "editor.json": the root value must be a JSON object.'] : []),
				...(editorMetadata && !nodes
					? ["editor.json > nodes: this field must be an array of saved node positions."]
					: []),
				...invalidNodes.map((node, index) => {
					const nodeRecord = asRecord(node);
					const id = typeof nodeRecord?.id === "string" ? nodeRecord.id : `entry ${index + 1}`;
					return `editor.json > nodes > ${id}: id must be a string and position.x and position.y must be finite numbers.`;
				}),
				...(!validCanvas
					? [`editor.json > canvas.edge_style: "${String(canvas?.edge_style)}" is not a supported edge style.`]
					: []),
			];

			return {
				outcome: details.length === 0 ? "passed" : "failed",
				message:
					details.length === 0
						? `${nodes?.length ?? 0} editor node position${nodes?.length === 1 ? "" : "s"} and canvas preferences validated.`
						: "Editor layout metadata is invalid.",
				...(details.length > 0 ? { details } : {}),
			};
		},
	},
	{
		id: "capabilities",
		title: "Capabilities",
		description: "Checking target runtime metadata.",
		run: ({ jsonFiles }) => {
			const capabilities = asRecord(jsonFiles["capabilities.json"]);
			const targetRuntimes = capabilities?.target_runtimes;
			const validTargetRuntimes =
				Array.isArray(targetRuntimes) &&
				targetRuntimes.length > 0 &&
				targetRuntimes.every((targetRuntime) => typeof targetRuntime === "string" && targetRuntime.trim());

			return {
				outcome: validTargetRuntimes ? "passed" : "failed",
				message: validTargetRuntimes
					? `Target runtimes: ${targetRuntimes.join(", ")}.`
					: "Package target runtime metadata is invalid.",
				...(!validTargetRuntimes
					? {
							details: [
								"capabilities.json > target_runtimes: provide a non-empty array containing only supported runtime strings.",
							],
						}
					: {}),
			};
		},
	},
];

export function getRequiredPackageFiles() {
	return ["manifest.json", "program.json", "permissions.json", "capabilities.json"];
}

function asRecord(value: unknown) {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function getConnectionVerificationErrors(nodes: Node<ScriptNodeData>[], edges: Edge[]) {
	return getConnectionVerificationIssues(nodes, edges).map((issue) => issue.message);
}

function getConnectionVerificationIssues(nodes: Node<ScriptNodeData>[], edges: Edge[]) {
	const nodesById = new Map(nodes.map((node) => [node.id, node]));

	return edges.flatMap((edge) => {
		const edgeLocation = `Connection "${edge.id}"`;
		if (isSelfConnection(edge)) {
			const node = nodesById.get(edge.source);
			return [
				{
					edgeId: edge.id,
					message: `${edgeLocation}: ${node ? getNodeLocation(node) : `node "${edge.source}"`} connects to itself from output "${edge.sourceHandle ?? "unknown"}" to input "${edge.targetHandle ?? "unknown"}". Connect the output to a different node or remove this connection.`,
				},
			];
		}

		const sourceNode = nodesById.get(edge.source);
		const targetNode = nodesById.get(edge.target);
		const issues: { edgeId: string; message: string }[] = [];

		if (!sourceNode) {
			issues.push({
				edgeId: edge.id,
				message: `${edgeLocation}: source node "${edge.source}" no longer exists. Remove this stale connection.`,
			});
		}
		if (!targetNode) {
			issues.push({
				edgeId: edge.id,
				message: `${edgeLocation}: target node "${edge.target}" no longer exists. Remove this stale connection.`,
			});
		}

		if (sourceNode && !sourceNode.data.outputs.some((output) => output.id === edge.sourceHandle)) {
			const availableOutputs = sourceNode.data.outputs.map((output) => `"${output.id}"`).join(", ") || "none";
			issues.push({
				edgeId: edge.id,
				message: `${edgeLocation}: ${getNodeLocation(sourceNode)} has no output port "${edge.sourceHandle ?? "unknown"}". Available outputs are ${availableOutputs}. Reconnect this edge from a valid output.`,
			});
		}
		if (targetNode && !targetNode.data.inputs.some((input) => input.id === edge.targetHandle)) {
			const availableInputs = targetNode.data.inputs.map((input) => `"${input.id}"`).join(", ") || "none";
			issues.push({
				edgeId: edge.id,
				message: `${edgeLocation}: ${getNodeLocation(targetNode)} has no input port "${edge.targetHandle ?? "unknown"}". Available inputs are ${availableInputs}. Reconnect this edge to a valid input.`,
			});
		}

		return issues;
	});
}

function getNodeLocation(node: Node<ScriptNodeData>) {
	const customName = configString(node, "customName").trim();
	return `${customName || node.data.label} (${node.id})`;
}

function getTargetRuntimeCompatibilityErrors(nodes: Node<ScriptNodeData>[], targetRuntimes: TargetRuntime[]) {
	return getRegistryTargetRuntimeCompatibilityErrors(
		nodes.map((node) => ({
			actionType: node.data.actionType,
			config: node.data.config,
			id: node.id,
			label: node.data.label,
		})),
		targetRuntimes,
	);
}

function getInvalidNodeConfigKeys(nodes: Node<ScriptNodeData>[], variables?: readonly VariableReferenceCandidate[]) {
	return nodes.flatMap((node) => {
		const availableVariables =
			node.data.kind === "trigger" ? variables?.filter((variable) => variable.preTrigger) : variables;
		return validateNodeConfig(node.data.actionType, node.data.config, availableVariables).map(
			(error) => `${getNodeLocation(node)} > Configuration: ${error}`,
		);
	});
}

function getInvalidNodeGraphConfigs(nodes: Node<ScriptNodeData>[], edges: Edge[], assets: EditorAsset[]) {
	return nodes.flatMap((node) =>
		validateNodeGraph(node, { assets, edges, nodes }).map((error) =>
			error.includes(node.id) ? error : `${getNodeLocation(node)}: ${error}`,
		),
	);
}

function getInvalidVariableWrites(nodes: Node<ScriptNodeData>[], declaredVariables: DeclaredVariable[]) {
	const readOnlyNames = new Set([
		...builtInVariableNames,
		...createNodeOutputVariables(nodes).map((variable) => variable.name),
	]);
	const declaredNames = new Set(declaredVariables.map((variable) => variable.name));

	return nodes
		.filter((node) => node.data.actionType === "runtime.set_variable")
		.flatMap((node) => {
			const name = configString(node, "name");
			const normalizedName = normalizeVariableReferenceName(name);

			if (normalizedName && readOnlyNames.has(normalizedName)) {
				return [
					`${getNodeLocation(node)} > Variable name: "${normalizedName}" is read-only. Select a writable variable.`,
				];
			}

			// A declaration is the only thing that brings a variable into
			// existence, so a write to an undeclared name has no target. The
			// runner refuses such a run outright; catching it here means the
			// simulator says so before the export does.
			if (!normalizedName) {
				return [`${getNodeLocation(node)} > Variable name: select a declared variable to write.`];
			}
			if (!declaredNames.has(normalizedName)) {
				return [
					`${getNodeLocation(node)} > Variable name: "${normalizedName}" is not declared. Declare it under Settings > Variables.`,
				];
			}

			return [];
		});
}

function getInvalidDeclaredVariables(declaredVariables: DeclaredVariable[], secrets: SecretDeclaration[]) {
	const errors: string[] = [];
	const names = new Set<string>();
	const secretNames = new Set(secrets.map((secret) => secret.name));

	for (const variable of declaredVariables) {
		const location = `Variables > Declared variables > "${variable.name}"`;
		if (names.has(variable.name)) errors.push(`${location}: this variable is declared more than once.`);
		if (secretNames.has(variable.name)) {
			errors.push(`${location}: this name is also used by a secret reference. Rename one of them.`);
		}
		names.add(variable.name);
		// A Variable Operation used to carry its own scope and type, so this
		// checked the two answers against each other. The node carries neither
		// now — it names a declared variable and the declaration settles both,
		// leaving nothing that could disagree.
	}

	return errors;
}

function configString(node: Node<ScriptNodeData>, key: string) {
	const value = node.data.config[key];
	if (typeof value === "string") {
		return value;
	}

	if (value === undefined || value === null) {
		return "";
	}

	return String(value);
}
