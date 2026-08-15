import type { Node } from "@xyflow/react";
import {
	createSimulationBuiltInVariableValues,
	getBuiltInVariableRuntimeEntries,
	MANIFEST_NAMESPACE,
	type ManifestVariableSource,
	SETTINGS_NAMESPACE,
	SYSTEM_NAMESPACE,
} from "@/data/project/built-in-variables";
import { createSimulationScriptSettingValues } from "@/data/project/script-settings";
import {
	createConfiguredVariableDefinitions,
	createDerivedVariableMetadataDefinitions,
	createNodeOutputVariables,
	type EditorVariable,
} from "@/data/project/variables";
import type {
	DeclaredVariable,
	ScriptNodeData,
	ScriptSetting,
	SecretDeclaration,
	SimulationVariableSnapshot,
} from "@/lib/types";

export function createVariablePanelEntries(
	source: ManifestVariableSource,
	nodes: Node<ScriptNodeData>[],
	snapshots: SimulationVariableSnapshot[],
	secretDeclarations: SecretDeclaration[] = [],
	declaredVariables: DeclaredVariable[] = [],
	scriptSettings: ScriptSetting[] = [],
): EditorVariable[] {
	return createEditorVariableRegistry(
		source,
		nodes,
		snapshots,
		secretDeclarations,
		declaredVariables,
		scriptSettings,
	).filter((variable) => !(variable.source === "setting" && variable.name.startsWith(`${SETTINGS_NAMESPACE}.`)));
}

export function createEditorVariableRegistry(
	source: ManifestVariableSource,
	nodes: Node<ScriptNodeData>[],
	snapshots: SimulationVariableSnapshot[] = [],
	secretDeclarations: SecretDeclaration[] = [],
	declaredVariables: DeclaredVariable[] = [],
	scriptSettings: ScriptSetting[] = [],
): EditorVariable[] {
	const variables = new Map<string, EditorVariable>();
	const builtInValues = createSimulationBuiltInVariableValues(source);
	const settingsValue = createSimulationScriptSettingValues(scriptSettings);

	for (const variable of [
		...getBuiltInVariableRuntimeEntries(source),
		...createConfiguredVariableDefinitions(nodes),
		...createNodeOutputVariables(nodes),
	]) {
		variables.set(variable.name, variable);
	}
	variables.set(MANIFEST_NAMESPACE, {
		description: "Read-only metadata for this script.",
		name: MANIFEST_NAMESPACE,
		preTrigger: true,
		read_only: true,
		scope: "manifest",
		source: "built_in",
		token: `{{${MANIFEST_NAMESPACE}}}`,
		type: "object",
		value: builtInValues[MANIFEST_NAMESPACE],
	});
	variables.set(SYSTEM_NAMESPACE, {
		description: "Read-only values supplied by the runner.",
		name: SYSTEM_NAMESPACE,
		preTrigger: true,
		read_only: true,
		scope: "system",
		source: "built_in",
		token: `{{${SYSTEM_NAMESPACE}}}`,
		type: "object",
		value: builtInValues[SYSTEM_NAMESPACE],
	});
	variables.set(SETTINGS_NAMESPACE, {
		description: "Read-only values configured for this script.",
		name: SETTINGS_NAMESPACE,
		preTrigger: true,
		read_only: true,
		scope: "setting",
		source: "setting",
		token: `{{${SETTINGS_NAMESPACE}}}`,
		type: "object",
		value: settingsValue,
	});
	for (const variable of declaredVariables) {
		variables.set(variable.name, {
			description: variable.description,
			name: variable.name,
			preTrigger: true,
			read_only: false,
			scope: variable.scope,
			source: "user",
			token: `{{${variable.name}}}`,
			type: variable.type,
			value: variable.value,
		});
	}
	for (const secret of secretDeclarations) {
		variables.set(secret.name, {
			description: secret.description,
			name: secret.name,
			read_only: true,
			scope: "secret",
			source: "secret",
			token: `{{${secret.name}}}`,
			type: secret.type,
		});
	}
	for (const setting of scriptSettings) {
		const name = `${SETTINGS_NAMESPACE}.${setting.name}`;
		variables.set(name, {
			description: setting.description,
			name,
			preTrigger: true,
			read_only: true,
			scope: "setting",
			source: "setting",
			token: `{{${name}}}`,
			type: setting.type,
			value: structuredClone(setting.simulationValue ?? setting.defaultValue ?? null),
		});
	}

	for (const snapshot of snapshots) {
		const existing = variables.get(snapshot.name);
		if (existing) {
			variables.set(snapshot.name, { ...existing, value: snapshot.value });
			continue;
		}

		variables.set(snapshot.name, {
			name: snapshot.name,
			read_only: snapshot.source !== "runtime",
			scope:
				snapshot.source === "node_output" ? "node_output" : snapshot.source === "secret" ? "secret" : snapshot.source,
			source: snapshot.source === "node_output" ? "node_output" : snapshot.source === "secret" ? "secret" : "user",
			token: `{{${snapshot.name}}}`,
			type: inferVariableType(snapshot.value),
			value: snapshot.value,
		});
	}

	const baseVariables = [...variables.values()];
	for (const variable of createDerivedVariableMetadataDefinitions(
		baseVariables.filter((variable) => variable.source !== "secret" && variable.source !== "setting"),
	)) {
		variables.set(variable.name, variable);
	}

	return [...variables.values()].sort((a, b) => {
		const sourceOrder = getVariableSourceOrder(a) - getVariableSourceOrder(b);
		return sourceOrder || a.name.localeCompare(b.name);
	});
}

function getVariableSourceOrder(variable: EditorVariable) {
	if (variable.source === "built_in") {
		return variable.scope === "manifest" ? 0 : 1;
	}

	if (variable.source === "user") {
		return 2;
	}
	if (variable.source === "secret") {
		return 3;
	}
	if (variable.source === "setting") {
		return 4;
	}

	return 5;
}

function inferVariableType(value: SimulationVariableSnapshot["value"]): EditorVariable["type"] {
	if (typeof value === "number") {
		return Number.isInteger(value) ? "integer" : "float";
	}

	if (typeof value === "boolean") {
		return "boolean";
	}

	if (Array.isArray(value)) {
		return "list";
	}

	if (value && typeof value === "object") {
		return "object";
	}

	return "string";
}
