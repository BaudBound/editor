import type { Edge, Node } from "@xyflow/react";
import type { VariableReferenceCandidate } from "@/data/project/variables";
import type { JsonValue, ScriptNodeData } from "@/lib/types";
import { conditionNumber } from "../condition-comparison";
import { validateVariableInput } from "../config-field-validation";
import {
	booleanConditionOperatorOptions,
	comparisonOperatorOptions,
	ifElseAdditionalConditionOperatorOptions,
	isBetweenConditionOperator,
	isNumericConditionOperator,
	isUnaryConditionOperator,
} from "./options";
import { isConditionRow } from "./rows";

export function validateLoopBodyDoesNotReturn(
	controlNodeId: string,
	edges: { source: string; sourceHandle?: string | null; target: string }[],
	label: string,
) {
	const loopEdges = edges.filter((edge) => edge.source === controlNodeId && edge.sourceHandle === "loop");

	for (const edge of loopEdges) {
		if (canReachNode(edge.target, controlNodeId, edges)) {
			return [`${controlNodeId} ${label} output must not connect back to ${controlNodeId} input.`];
		}
	}

	return [];
}

export function validateLoopControlPlacement(
	controlNodeId: string,
	nodes: Node<ScriptNodeData>[],
	edges: Edge[],
	label: string,
) {
	for (const node of nodes) {
		const bodyHandle = getLoopBodyHandle(node.data.actionType);
		if (!bodyHandle) {
			continue;
		}

		const bodyStarts = edges.filter((edge) => edge.source === node.id && edge.sourceHandle === bodyHandle);
		if (bodyStarts.some((edge) => canReachNode(edge.target, controlNodeId, edges))) {
			return [];
		}
	}

	return [`${controlNodeId} ${label} must be connected inside a Repeat, While, or For Each body.`];
}

function getLoopBodyHandle(actionType: string) {
	if (actionType === "control.repeat") {
		return "repeat";
	}

	return actionType === "control.while" || actionType === "control.for_each" ? "loop" : null;
}

function canReachNode(startNodeId: string, targetNodeId: string, edges: { source: string; target: string }[]) {
	const visited = new Set<string>();
	const queue = [startNodeId];

	while (queue.length > 0) {
		const nodeId = queue.shift();
		if (!nodeId || visited.has(nodeId)) {
			continue;
		}

		if (nodeId === targetNodeId) {
			return true;
		}

		visited.add(nodeId);
		for (const edge of edges) {
			if (edge.source === nodeId && edge.target) {
				queue.push(edge.target);
			}
		}
	}

	return false;
}

const comparisonOperators = new Set(comparisonOperatorOptions.map((option) => option.value));
const ifElseOnlyConditionOperators = new Set(
	[...booleanConditionOperatorOptions, ...ifElseAdditionalConditionOperatorOptions].map((option) => option.value),
);
const conditionCombinators = new Set(["and", "or"]);

export function validateConditionRowsConfig(
	config: Record<string, JsonValue>,
	label: string,
	allowIfElseOnlyChecks = false,
) {
	const conditions = config.conditions;
	if (!Array.isArray(conditions) || conditions.length === 0) {
		return [`${label} must have at least one condition.`];
	}

	return conditions.flatMap((condition, index) => {
		const rowLabel = `${label} condition ${index + 1}`;
		if (!isConditionRow(condition)) {
			return [`${rowLabel} is malformed.`];
		}

		const errors: string[] = [];
		if (!condition.left.trim()) {
			errors.push(`${rowLabel} value is required.`);
		}
		if (
			!comparisonOperators.has(condition.operator) &&
			!(allowIfElseOnlyChecks && ifElseOnlyConditionOperators.has(condition.operator))
		) {
			errors.push(`${rowLabel} uses unknown expression "${condition.operator}".`);
		}
		if (index > 0 && !conditionCombinators.has(condition.combinator ?? "")) {
			errors.push(`${rowLabel} combinator must be AND or OR.`);
		}
		if (isNumericConditionOperator(condition.operator)) {
			if (condition.left.trim()) {
				errors.push(...validateNumericCondition(condition.left, "value", rowLabel));
			}
			if (isBetweenConditionOperator(condition.operator)) {
				errors.push(...validateBetweenCondition(condition.right, condition.rightEnd ?? "", rowLabel));
			} else {
				errors.push(...validateNumericCondition(condition.right, "target", rowLabel));
			}
		}

		return errors;
	});
}

export function validateConditionVariableInputs(
	config: Record<string, JsonValue>,
	variables: readonly VariableReferenceCandidate[],
) {
	if (!Array.isArray(config.conditions)) return [];
	return config.conditions.flatMap((value, index) => {
		if (!isConditionRow(value)) return [];
		const contract = isNumericConditionOperator(value.operator) ? "float" : "any";
		const inputs: Array<[string, string]> = [["value", value.left]];
		if (!isUnaryConditionOperator(value.operator)) {
			inputs.push([isBetweenConditionOperator(value.operator) ? "start value" : "target", value.right]);
		}
		if (isBetweenConditionOperator(value.operator)) inputs.push(["end value", value.rightEnd ?? ""]);
		return inputs.flatMap(([label, input]) => {
			const error = validateVariableInput(input, variables, contract);
			return error ? [`condition ${index + 1} ${label}: ${error}`] : [];
		});
	});
}

function validateNumericCondition(value: string, fieldLabel: string, rowLabel: string) {
	if (!value.trim()) {
		return [`${rowLabel} ${fieldLabel} is required.`];
	}
	if (containsVariableReference(value)) {
		return [];
	}
	return conditionNumber(value) === undefined
		? [`${rowLabel} ${fieldLabel} must be a finite number or variable expression.`]
		: [];
}

function validateBetweenCondition(start: string, end: string, rowLabel: string) {
	const errors: string[] = [];
	if (!start.trim()) {
		errors.push(`${rowLabel} start value is required for Is between.`);
	}
	if (!end.trim()) {
		errors.push(`${rowLabel} end value is required for Is between.`);
	}
	if (errors.length > 0 || containsVariableReference(start) || containsVariableReference(end)) {
		return errors;
	}

	const startNumber = conditionNumber(start);
	const endNumber = conditionNumber(end);
	if (startNumber === undefined) {
		errors.push(`${rowLabel} start value must be a finite number or variable expression.`);
	}
	if (endNumber === undefined) {
		errors.push(`${rowLabel} end value must be a finite number or variable expression.`);
	}
	if (startNumber !== undefined && endNumber !== undefined && startNumber > endNumber) {
		errors.push(`${rowLabel} start value must be less than or equal to the end value.`);
	}

	return errors;
}

function containsVariableReference(value: string) {
	return /^\{\{\s*[^{}]+\s*}}$/.test(value.trim());
}

export const actionAudio = ["action.sound"];
export const actionFile = ["action.file"];
export const actionKeyboard = ["action.keyboard"];
export const actionMouse = ["action.mouse"];
export const actionProcess = ["action.process"];
export const actionWindow = ["action.window"];
