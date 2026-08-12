import type { Edge, Node } from "@xyflow/react";
import { GripVertical, Info, Plus, Trash2, X } from "lucide-react";
import { Fragment, type ReactNode, type PointerEvent as ReactPointerEvent, useEffect, useId, useState } from "react";
import { CopyTextButton } from "@/components/common/copy-text-button";
import { FieldError } from "@/components/common/field-error";
import { NumericField } from "@/components/common/numeric-field";
import { ReorderDragOverlay } from "@/components/common/reorder-drag-overlay";
import { TypedValueEditor } from "@/components/common/typed-value-editor";
import { VariableCodeInput, type VariableCompletion } from "@/components/common/variable-code-input";
import { ColorConfigInput } from "@/components/inspector/color-config-input";
import { FormDialogBuilder } from "@/components/inspector/form-dialog-builder";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupButton } from "@/components/ui/input-group";
import { OptionCombobox } from "@/components/ui/option-combobox";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { inspectorTabs } from "@/data/editor/inspector-tabs";
import {
	getEffectiveVariableContract,
	validateConfigField,
	validateNumericComparisonInput,
	validateVariableReferences,
	validateVariableReferenceTypes,
} from "@/data/nodes/config-field-validation";
import { validateTextTransformField } from "@/data/nodes/definitions/actions/format-text";
import {
	combinatorOptions,
	durationUnitOptions,
	ifElseComparisonOperatorOptions,
	isBetweenConditionOperator,
	isNumericConditionOperator,
	isUnaryConditionOperator,
	playSoundSourceOptions,
	type SelectOption,
	textTransformOperationOptions,
	variableOperationOptions,
	variableTypeOptions,
} from "@/data/nodes/definitions/options";
import {
	type ConditionRow,
	createConditionRow,
	createHeaderRow,
	createSwitchCaseRow,
	createTextTransformOperationRow,
	getSwitchCaseRowsFromValue,
	getTextTransformOperationRows,
	type HeaderRow,
	isConditionRow,
	isHeaderRow,
	type SwitchCaseRow,
	type TextTransformOperationRow,
} from "@/data/nodes/definitions/rows";
import {
	configVisibilityConditionMatches,
	type NodeConfigField,
	type NumericConfigContract,
	type VariableInputContract,
} from "@/data/nodes/node-definition";
import { numericContractApplies, runtimeNumberContract } from "@/data/nodes/numeric-validation";
import { createDefaultNodeConfig, getNodeConfigFields } from "@/data/nodes/registry";
import { validateSwitchCaseName, validateSwitchCaseValue } from "@/data/nodes/switch-validation";
import { createSerialDeviceOptions, serialLineEndingOptions } from "@/data/project/serial";
import { createEmptyTypedValue, normalizeListItemType, validateTypedValue } from "@/data/project/typed-values";
import {
	type EditorVariable,
	getVariableOperationFixedType,
	type ListItemType,
	listItemTypes,
	normalizeVariableOperation,
	type VariableType,
	validateObjectFieldPath,
	validateVariableOperationType,
	validateVariableOperationValue,
	variableOperationDefinitions,
	variableScopeDefinitions,
	variableTypeDefinitions,
} from "@/data/project/variables";
import {
	createWebSocketConnectionOptions,
	getWebSocketConnectionTriggerId,
	websocketPathConfigFromInput,
	websocketPathInputFromConfig,
} from "@/data/project/websocket";
import { type ActiveReorderDragState, useReorderController } from "@/hooks/use-reorder-controller";
import type {
	ActionType,
	DeclaredVariable,
	EditorAsset,
	InspectorTab,
	JsonValue,
	ScriptNodeData,
	SimulationOverride,
	SimulationOverrideOutcome,
	SimulationRunStatus,
	SimulationSettings,
	SimulationTriggerInputDraft,
	SimulationTriggerPayload,
} from "@/lib/types";
import { PanelCollapseButton } from "../shell/panel-collapse-button";
import { RiskBadge } from "../shell/risk-badge";
import { SimulatorPanel } from "../simulation/simulator-panel";
import { DatetimeTokenPanel } from "./datetime-token-panel";
import { DurationTokenPanel } from "./duration-token-panel";
import { EdgeOrderPanel } from "./edge-order-panel";
import { KeyCaptureInput } from "./key-capture-input";
import { RuntimeDataPanel } from "./runtime-data-panel";

type InspectorProps = {
	activeTab: InspectorTab;
	activeScheduleTriggerId: string | null;
	assets: EditorAsset[];
	edges: Edge[];
	nodes: Node<ScriptNodeData>[];
	selectedEdge: Edge | null;
	selectedNode: Node<ScriptNodeData> | null;
	simulationOverrides: SimulationOverride[];
	simulationSettings: SimulationSettings;
	simulationStatus: SimulationRunStatus;
	simulationTriggerInputDrafts: Record<string, SimulationTriggerInputDraft>;
	variables: EditorVariable[];
	declaredVariables: DeclaredVariable[];
	/** Opens Settings on the Variables tab so a variable can be declared without leaving the node. */
	onDeclareVariable: () => void;
	width: number;
	collapsed: boolean;
	onAddSimulationOverride: (nodeId: string) => void;
	onRemoveSimulationOverride: (nodeId: string) => void;
	onSimulationSettingsChange: (settings: SimulationSettings) => void;
	onStartScheduleSimulation: (triggerNodeId: string) => void;
	onStopSimulation: () => void;
	onStopScheduleSimulation: (triggerNodeId: string) => void;
	onTabChange: (tab: InspectorTab) => void;
	onTriggerSimulation: (triggerNodeId: string, payload: SimulationTriggerPayload) => void;
	onTriggerSimulationInputChange: (triggerNodeId: string, draft: SimulationTriggerInputDraft) => void;
	onUpdateNodeConfig: (nodeId: string, key: string, value: JsonValue) => void;
	onUpdateSimulationOverride: (nodeId: string, outcome: SimulationOverrideOutcome) => void;
	onDeleteNode: (nodeId: string) => void;
	onDeleteEdge: (edgeId: string) => void;
	onReorderEdges: (edgeIds: string[]) => void;
	onSelectEdge: (edgeId: string) => void;
	onToggleCollapsed: () => void;
};

export function Inspector({
	activeTab,
	activeScheduleTriggerId,
	assets,
	edges,
	nodes,
	selectedEdge,
	selectedNode,
	simulationOverrides,
	simulationSettings,
	simulationStatus,
	simulationTriggerInputDrafts,
	variables,
	declaredVariables,
	onDeclareVariable,
	width,
	collapsed,
	onAddSimulationOverride,
	onRemoveSimulationOverride,
	onSimulationSettingsChange,
	onStartScheduleSimulation,
	onStopSimulation,
	onStopScheduleSimulation,
	onTabChange,
	onTriggerSimulation,
	onTriggerSimulationInputChange,
	onUpdateNodeConfig,
	onUpdateSimulationOverride,
	onDeleteEdge,
	onDeleteNode,
	onReorderEdges,
	onSelectEdge,
	onToggleCollapsed,
}: InspectorProps) {
	if (collapsed) {
		return (
			<aside
				aria-label="Inspector"
				className="flex shrink-0 justify-center border-l border-baud-border bg-baud-panel pt-0.5"
				style={{ width }}
			>
				<PanelCollapseButton collapsed label="inspector" onToggle={onToggleCollapsed} side="right" />
			</aside>
		);
	}

	return (
		<aside
			aria-label="Inspector"
			className="flex shrink-0 flex-col border-l border-baud-border bg-baud-panel"
			style={{ width }}
		>
			<div className="flex h-10 border-b border-baud-border">
				<div className="grid min-w-0 flex-1 grid-cols-2">
					{inspectorTabs.map((tab) => (
						<Button
							type="button"
							key={tab.id}
							onClick={() => onTabChange(tab.id)}
							aria-label={tab.label}
							className={`h-full min-w-0 truncate px-1 text-xs font-bold uppercase tracking-[0.04em] ${
								activeTab === tab.id ? "border-b-baud-red text-white" : ""
							}`}
							size="none"
							variant="tab"
						>
							{width < 340 ? tab.shortLabel : tab.label}
						</Button>
					))}
				</div>
				<PanelCollapseButton collapsed={false} label="inspector" onToggle={onToggleCollapsed} side="right" />
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto">
				{activeTab === "properties" &&
					(selectedEdge ? (
						<EdgeOrderPanel
							edges={edges}
							nodes={nodes}
							selectedEdge={selectedEdge}
							onDeleteEdge={onDeleteEdge}
							onReorder={onReorderEdges}
							onSelectEdge={onSelectEdge}
						/>
					) : (
						<PropertiesPanel
							assets={assets}
							declaredVariables={declaredVariables}
							onDeclareVariable={onDeclareVariable}
							nodes={nodes}
							selectedNode={selectedNode}
							variables={variables}
							onUpdateNodeConfig={onUpdateNodeConfig}
							onDeleteNode={onDeleteNode}
						/>
					))}
				{activeTab === "simulator" && (
					<SimulatorPanel
						activeScheduleTriggerId={activeScheduleTriggerId}
						nodes={nodes}
						overrides={simulationOverrides}
						settings={simulationSettings}
						status={simulationStatus}
						triggerInputDrafts={simulationTriggerInputDrafts}
						variables={variables}
						onAddOverride={onAddSimulationOverride}
						onRemoveOverride={onRemoveSimulationOverride}
						onSettingsChange={onSimulationSettingsChange}
						onStartScheduleSimulation={onStartScheduleSimulation}
						onStopSimulation={onStopSimulation}
						onStopScheduleSimulation={onStopScheduleSimulation}
						onTriggerSimulation={onTriggerSimulation}
						onTriggerInputDraftChange={onTriggerSimulationInputChange}
						onUpdateOverride={onUpdateSimulationOverride}
					/>
				)}
			</div>
		</aside>
	);
}

function PropertiesPanel({
	assets,
	declaredVariables,
	nodes,
	selectedNode,
	variables,
	onDeclareVariable,
	onUpdateNodeConfig,
	onDeleteNode,
}: {
	assets: EditorAsset[];
	declaredVariables: DeclaredVariable[];
	nodes: Node<ScriptNodeData>[];
	selectedNode: Node<ScriptNodeData> | null;
	variables: EditorVariable[];
	onDeclareVariable: () => void;
	onUpdateNodeConfig: (nodeId: string, key: string, value: JsonValue) => void;
	onDeleteNode: (nodeId: string) => void;
}) {
	if (!selectedNode) {
		return (
			<div className="p-4">
				<div className="flex items-start gap-3 rounded border border-baud-border bg-baud-soft p-3">
					<Info className="mt-0.5 text-baud-muted" size={16} />
					<div>
						<div className="text-sm font-semibold text-white">Select a node</div>
						<p className="mt-1 text-xs leading-5 text-baud-muted">Node configuration and ports appear here.</p>
					</div>
				</div>
			</div>
		);
	}

	const defaultConfig = createDefaultNodeConfig(selectedNode.data.actionType);
	const fields = getNodeConfigFields(selectedNode.data.actionType).filter((field) =>
		configVisibilityConditionMatches(field.visibleWhen, { ...defaultConfig, ...selectedNode.data.config }),
	);
	const variableCompletions = createVariableCompletions(variables);
	const configVariableCompletions =
		selectedNode.data.kind === "trigger"
			? variableCompletions.filter((variable) => variable.preTrigger)
			: variableCompletions;
	const visibleFields =
		selectedNode.data.actionType === "runtime.set_variable" || selectedNode.data.actionType === "action.text.format"
			? []
			: usesKeyReference(selectedNode.data.actionType)
				? fields.filter((field) => field.key !== "key")
				: selectedNode.data.actionType === "trigger.websocket"
					? fields.filter((field) => field.key !== "path")
					: selectedNode.data.actionType === "action.websocket.write"
						? fields.filter((field) => field.key !== "connectionId")
						: fields;

	return (
		<div className="space-y-5 p-4">
			<section>
				<div className="mb-3 flex items-center gap-2">
					<span className="size-2 rounded-sm bg-baud-purple" />
					<div className="min-w-0 flex-1">
						<h2 className="text-sm font-bold text-white">{selectedNode.data.label}</h2>
						<div className="mt-1 flex min-w-0 items-center gap-2 font-mono text-sm text-baud-muted">
							<span className="min-w-0 truncate">
								{selectedNode.data.kind} - id:{selectedNode.id}
							</span>
							<CopyTextButton text={selectedNode.id} label="Copy node id" />
						</div>
					</div>
					<Button
						type="button"
						onClick={() => onDeleteNode(selectedNode.id)}
						aria-label="Delete node"
						title="Delete node"
						size="icon"
						variant="destructive"
					>
						<Trash2 size={15} />
					</Button>
				</div>
				<RiskBadge risk={selectedNode.data.risk} />
			</section>

			<section>
				<div className="mb-3 rounded border border-baud-border bg-baud-soft/60 p-3">
					<TextInput
						label="Custom name"
						value={valueToInputString(selectedNode.data.config.customName)}
						onChange={(value) => onUpdateNodeConfig(selectedNode.id, "customName", value)}
					/>
				</div>
				<h3 className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-baud-muted">Configuration</h3>
				<NodeSpecificHelp actionType={selectedNode.data.actionType} />
				{visibleFields.length === 0 && !hasCustomConfigPanel(selectedNode.data.actionType) ? (
					<div className="rounded border border-baud-border bg-baud-soft px-3 py-2 font-mono text-sm text-baud-muted">
						No fields required
					</div>
				) : (
					<div className="space-y-3 rounded border border-baud-border bg-baud-soft/60 p-3">
						{selectedNode.data.actionType === "runtime.set_variable" && (
							<VariableOperationConfigPanel
								config={selectedNode.data.config}
								declaredVariables={declaredVariables}
								variableCompletions={configVariableCompletions}
								onDeclareVariable={onDeclareVariable}
								onChange={(key, value) => onUpdateNodeConfig(selectedNode.id, key, value)}
							/>
						)}
						{selectedNode.data.actionType === "action.text.format" && (
							<TextTransformConfigPanel
								config={selectedNode.data.config}
								variableCompletions={variableCompletions}
								onChange={(key, value) => onUpdateNodeConfig(selectedNode.id, key, value)}
							/>
						)}
						{usesKeyReference(selectedNode.data.actionType) && (
							<KeyCaptureConfigPanel
								config={selectedNode.data.config}
								variableCompletions={configVariableCompletions}
								onChange={(key, value) => onUpdateNodeConfig(selectedNode.id, key, value)}
							/>
						)}
						{usesConditionRows(selectedNode.data.actionType) && (
							<IfElseConfigPanel
								config={selectedNode.data.config}
								declaredVariables={declaredVariables}
								variableCompletions={variableCompletions}
								onChange={(key, value) => onUpdateNodeConfig(selectedNode.id, key, value)}
							/>
						)}
						{selectedNode.data.actionType === "control.switch" && (
							<SwitchConfigPanel
								config={selectedNode.data.config}
								variableCompletions={variableCompletions}
								onChange={(key, value) => onUpdateNodeConfig(selectedNode.id, key, value)}
							/>
						)}
						{(selectedNode.data.actionType === "action.http" ||
							selectedNode.data.actionType === "action.webhook_response") && (
							<HttpHeadersPanel
								config={selectedNode.data.config}
								variableCompletions={variableCompletions}
								onChange={(key, value) => onUpdateNodeConfig(selectedNode.id, key, value)}
							/>
						)}
						{selectedNode.data.actionType === "action.sound.play" && (
							<PlaySoundConfigPanel
								assets={assets}
								config={selectedNode.data.config}
								variableCompletions={variableCompletions}
								onChange={(key, value) => onUpdateNodeConfig(selectedNode.id, key, value)}
							/>
						)}
						{selectedNode.data.actionType === "action.serial.write" && (
							<SerialWriteConfigPanel
								config={selectedNode.data.config}
								deviceOptions={createSerialDeviceOptions(nodes)}
								variableCompletions={variableCompletions}
								onChange={(key, value) => onUpdateNodeConfig(selectedNode.id, key, value)}
							/>
						)}
						{selectedNode.data.actionType === "trigger.websocket" && (
							<WebSocketPathConfigPanel
								config={selectedNode.data.config}
								onChange={(value) => onUpdateNodeConfig(selectedNode.id, "path", value)}
							/>
						)}
						{selectedNode.data.actionType === "action.websocket.write" && (
							<WebSocketConnectionConfigPanel
								config={selectedNode.data.config}
								nodes={nodes}
								onChange={(value) => onUpdateNodeConfig(selectedNode.id, "connectionId", value)}
							/>
						)}
						{visibleFields.map((field) => (
							<ConfigField
								key={field.key}
								assets={assets}
								config={selectedNode.data.config}
								field={field}
								numericContract={
									field.numeric && numericContractApplies(field, selectedNode.data.config) ? field.numeric : undefined
								}
								value={
									selectedNode.data.config[field.key] ??
									(selectedNode.data.actionType === "action.http" && field.key === "bodyFormat"
										? defaultConfig[field.key]
										: undefined)
								}
								variableCompletions={configVariableCompletions}
								onChange={(value) => onUpdateNodeConfig(selectedNode.id, field.key, value)}
							/>
						))}
					</div>
				)}
			</section>

			{formatsADatetime(selectedNode) && <DatetimeTokenPanel />}
			{formatsADuration(selectedNode) && <DurationTokenPanel />}

			<RuntimeDataPanel selectedNode={selectedNode} />

			<div className="rounded border border-baud-border bg-baud-soft p-3 text-xs leading-5 text-baud-muted">
				{selectedNode.data.kind === "trigger" && "Entry point. Defines when the script starts."}
				{selectedNode.data.kind === "control" && "Branches or loops execution flow."}
				{selectedNode.data.kind === "action" && "Performs an operation with optional side effects."}
			</div>
		</div>
	);
}

function ConfigField({
	assets,
	config,
	field,
	numericContract,
	value,
	variableCompletions,
	onChange,
}: {
	assets: EditorAsset[];
	config: Record<string, JsonValue>;
	field: NodeConfigField;
	numericContract?: NumericConfigContract;
	value: JsonValue | undefined;
	variableCompletions: VariableCompletion[];
	onChange: (value: JsonValue) => void;
}) {
	const inputId = useId();
	const errorId = `${inputId}-error`;
	const inputValue = valueToInputString(value);
	const validationConfig = value === undefined ? config : { ...config, [field.key]: value };
	const error = validateConfigField(field, validationConfig, variableCompletions);
	const variableTypes = getEffectiveVariableContract(field, validationConfig);

	return (
		<div>
			<span className="mb-1 block font-mono text-sm text-baud-muted">{field.label}</span>
			{numericContract ? (
				<NumericField
					allowVariables={field.usesVariables}
					ariaLabel={field.label}
					contract={numericContract}
					id={inputId}
					onChange={onChange}
					required={field.required !== false}
					validationError={error}
					value={inputValue}
					variables={variableCompletions}
				/>
			) : field.colorPicker ? (
				<ColorConfigInput
					error={error}
					errorId={errorId}
					label={field.label}
					value={inputValue}
					variables={variableCompletions}
					onChange={onChange}
				/>
			) : field.type === "select" ? (
				<ComboboxField
					ariaDescribedBy={error ? errorId : undefined}
					ariaLabel={field.label}
					hasError={!!error}
					value={inputValue}
					options={field.options ?? []}
					onChange={onChange}
				/>
			) : field.type === "switch" ? (
				<div
					aria-describedby={error ? errorId : undefined}
					aria-invalid={!!error || undefined}
					className={`flex min-h-9 items-center justify-between gap-3 rounded-lg border bg-baud-panel/70 px-3 py-2 transition-colors hover:border-baud-line ${
						error ? "border-baud-danger" : "border-baud-border"
					}`}
				>
					<span className="text-sm text-baud-text">{value === true || value === "true" ? "Enabled" : "Disabled"}</span>
					<Switch
						aria-label={field.label}
						checked={value === true || value === "true"}
						onCheckedChange={(checked) => onChange(checked)}
					/>
				</div>
			) : field.type === "string-list" ? (
				<StringListField
					error={error}
					errorId={errorId}
					label={field.label}
					value={value}
					variableCompletions={variableCompletions}
					variableTypes={variableTypes}
					onChange={onChange}
				/>
			) : field.type === "form-field-list" ? (
				<FormDialogBuilder
					assets={assets}
					error={error}
					errorId={errorId}
					value={value}
					variables={variableCompletions}
					onChange={onChange}
				/>
			) : field.type === "textarea" && field.usesVariables ? (
				<VariableCodeInput
					id={inputId}
					ariaLabel={field.label}
					ariaDescribedBy={error ? errorId : undefined}
					hasError={!!error}
					value={inputValue}
					multiline
					variableTypes={variableTypes}
					variables={variableCompletions}
					onChange={onChange}
				/>
			) : field.type === "textarea" ? (
				<Textarea
					id={inputId}
					aria-label={field.label}
					aria-describedby={error ? errorId : undefined}
					aria-invalid={!!error || undefined}
					value={inputValue}
					onChange={(event) => onChange(event.target.value)}
				/>
			) : field.usesVariables ? (
				<VariableCodeInput
					id={inputId}
					ariaLabel={field.label}
					ariaDescribedBy={error ? errorId : undefined}
					hasError={!!error}
					value={inputValue}
					variableTypes={variableTypes}
					variables={variableCompletions}
					onChange={onChange}
				/>
			) : (
				<Input
					id={inputId}
					aria-label={field.label}
					aria-describedby={error ? errorId : undefined}
					aria-invalid={!!error || undefined}
					value={inputValue}
					type="text"
					onChange={(event) => onChange(event.target.value)}
				/>
			)}
			{!numericContract && field.type !== "string-list" && field.type !== "form-field-list" && (
				<FieldError id={errorId} message={error} />
			)}
			{field.help && <p className="mt-1 text-xs leading-4 text-baud-muted">{field.help}</p>}
		</div>
	);
}

function StringListField({
	error,
	errorId,
	label,
	value,
	variableCompletions,
	variableTypes,
	onChange,
}: {
	error: string;
	errorId: string;
	label: string;
	value: JsonValue | undefined;
	variableCompletions: VariableCompletion[];
	variableTypes: VariableInputContract;
	onChange: (value: JsonValue) => void;
}) {
	const items = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
	const itemErrors = items.map(
		(item) =>
			validateVariableReferences(item, variableCompletions) ||
			validateVariableReferenceTypes(item, variableCompletions, variableTypes),
	);
	const updateItem = (index: number, nextValue: string) => {
		onChange(items.map((item, itemIndex) => (itemIndex === index ? nextValue : item)));
	};

	return (
		<div className="space-y-2">
			{items.map((item, index) => (
				<div className="flex items-start gap-2" key={`${index}-${items.length}`}>
					<div className="min-w-0 flex-1">
						<VariableCodeInput
							ariaDescribedBy={itemErrors[index] ? `${errorId}-${index}` : undefined}
							ariaLabel={`${label} ${index + 1}`}
							hasError={!!itemErrors[index]}
							value={item}
							variableTypes={variableTypes}
							variables={variableCompletions}
							onChange={(nextValue) => updateItem(index, nextValue)}
						/>
						<FieldError id={`${errorId}-${index}`} message={itemErrors[index]} />
					</div>
					<Button
						type="button"
						aria-label={`Remove ${label.toLowerCase()} ${index + 1}`}
						title={`Remove ${label.toLowerCase()} ${index + 1}`}
						size="icon"
						variant="destructive"
						onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}
					>
						<Trash2 size={15} />
					</Button>
				</div>
			))}
			<Button type="button" size="sm" variant="secondary" onClick={() => onChange([...items, ""])}>
				<Plus size={14} />
				Add argument
			</Button>
			<FieldError id={errorId} message={itemErrors.some(Boolean) ? "" : error} />
		</div>
	);
}

/**
 * Warns that Is null or missing cannot be true for a declared variable.
 *
 * A declaration is what makes a variable exist, so one always has a value.
 * The operator still means something for a node output that has not run and
 * for a null inside an object, which is why this is a note rather than a
 * rejected combination.
 */
function declaredVariableConditionNote(
	condition: { left: string; operator: string },
	declaredVariables: DeclaredVariable[],
) {
	if (condition.operator !== "is_null_or_missing") return "";
	const referenced = /^\s*\{\{\s*([A-Za-z0-9_-]+)\s*\}\}\s*$/.exec(condition.left)?.[1];
	if (!referenced) return "";
	const declared = declaredVariables.find((variable) => variable.name === referenced);
	if (!declared) return "";
	return `"${referenced}" is declared, so it always has a value and this is never true. Compare it against its value instead.`;
}

function IfElseConfigPanel({
	config,
	declaredVariables,
	variableCompletions,
	onChange,
}: {
	config: Record<string, JsonValue>;
	declaredVariables: DeclaredVariable[];
	variableCompletions: VariableCompletion[];
	onChange: (key: string, value: JsonValue) => void;
}) {
	const conditions = getConditionRows(config.conditions, valueToInputString(config.combinator));
	const operatorOptions = ifElseComparisonOperatorOptions;
	const conditionReorder = useReorderController({
		rows: conditions,
		onCommit: (rows) => onChange("conditions", normalizeConditionRows(rows)),
	});
	const draggedCondition = conditionReorder.drag
		? conditions.find((condition) => condition.id === conditionReorder.drag?.draggedId)
		: null;
	let visibleConditionIndex = 0;

	return (
		<div className="space-y-3">
			<ul ref={conditionReorder.listRef} className="space-y-3" aria-label="Condition rows">
				{conditionReorder.entries.map((entry) => {
					if (entry.type === "drop-space") {
						return <ReorderDropSpace key={entry.id} height={entry.height} />;
					}

					const condition = entry.row;
					visibleConditionIndex += 1;
					const conditionIndex = visibleConditionIndex;

					return (
						<Fragment key={condition.id}>
							{conditionIndex > 1 && (
								<li>
									<ConditionCombinatorRow conditions={conditions} condition={condition} onChange={onChange} />
								</li>
							)}
							<li ref={conditionReorder.registerRow(condition.id)} data-reorder-card={condition.id}>
								<fieldset className="space-y-2 rounded border border-baud-border bg-baud-panel p-2 transition-[border-color,box-shadow] duration-150">
									<legend className="sr-only">Condition {conditionIndex}</legend>
									<div className="flex items-center justify-between">
										<div className="flex items-center gap-2">
											<DragHandle
												label={`Reorder condition ${conditionIndex}`}
												onPointerDown={(event) => conditionReorder.startDrag(condition.id, event)}
											/>
											<span className="font-mono text-sm text-baud-muted">Condition {conditionIndex}</span>
										</div>
										<RemoveRowButton
											label="Remove condition"
											onClick={() =>
												onChange(
													"conditions",
													normalizeConditionRows(conditions.filter((row) => row.id !== condition.id)),
												)
											}
										/>
									</div>
									<ConditionValueInput
										label="Value"
										value={condition.left}
										numeric={isNumericConditionOperator(condition.operator)}
										variableCompletions={variableCompletions}
										onChange={(value) => updateCondition(conditions, condition.id, { left: value }, onChange)}
									/>
									<ComboboxField
										label="Expression"
										value={condition.operator}
										options={operatorOptions}
										onChange={(value) =>
											updateCondition(
												conditions,
												condition.id,
												isUnaryConditionOperator(value)
													? { operator: value, right: "", rightEnd: "" }
													: isBetweenConditionOperator(value)
														? { operator: value }
														: { operator: value, rightEnd: "" },
												onChange,
											)
										}
									/>
									{declaredVariableConditionNote(condition, declaredVariables) && (
										<p className="text-xs leading-4 text-baud-amber">
											{declaredVariableConditionNote(condition, declaredVariables)}
										</p>
									)}
									<ConditionInvertCheckbox
										checked={condition.invert === true}
										onChange={(checked) => updateCondition(conditions, condition.id, { invert: checked }, onChange)}
									/>
									{isBetweenConditionOperator(condition.operator) ? (
										<>
											<ConditionValueInput
												label="Start value"
												value={condition.right}
												numeric
												variableCompletions={variableCompletions}
												onChange={(value) => updateCondition(conditions, condition.id, { right: value }, onChange)}
											/>
											<ConditionValueInput
												label="End value"
												value={condition.rightEnd ?? ""}
												numeric
												variableCompletions={variableCompletions}
												onChange={(value) => updateCondition(conditions, condition.id, { rightEnd: value }, onChange)}
											/>
										</>
									) : !isUnaryConditionOperator(condition.operator) ? (
										<ConditionValueInput
											label="Target"
											value={condition.right}
											numeric={isNumericConditionOperator(condition.operator)}
											variableCompletions={variableCompletions}
											onChange={(value) => updateCondition(conditions, condition.id, { right: value }, onChange)}
										/>
									) : null}
								</fieldset>
							</li>
						</Fragment>
					);
				})}
			</ul>
			{draggedCondition && conditionReorder.drag && (
				<FloatingConditionCard condition={draggedCondition} drag={conditionReorder.drag} />
			)}

			<AddButton
				label="Add condition"
				onClick={() => onChange("conditions", normalizeConditionRows([...conditions, createConditionRow()]))}
			/>
		</div>
	);
}

function ConditionValueInput({
	label,
	numeric,
	value,
	variableCompletions,
	onChange,
}: {
	label: string;
	numeric: boolean;
	value: string;
	variableCompletions: VariableCompletion[];
	onChange: (value: string) => void;
}) {
	if (!numeric) {
		const error =
			(!value.trim() ? `${label} is required.` : "") || validateVariableReferences(value, variableCompletions);
		return (
			<TextInput
				error={error}
				label={label}
				value={value}
				usesVariables
				variableCompletions={variableCompletions}
				variableTypes="any"
				onChange={onChange}
			/>
		);
	}

	// A comparison reads both sides as numbers, so either numeric type works.
	const numericVariableError = validateNumericComparisonInput(value, variableCompletions);
	return (
		<div>
			<span className="mb-1 block font-mono text-sm text-baud-muted">{label}</span>
			<NumericField
				allowVariables
				ariaLabel={label}
				contract={runtimeNumberContract}
				validationError={numericVariableError}
				value={value}
				variables={variableCompletions}
				onChange={onChange}
			/>
		</div>
	);
}

function SwitchConfigPanel({
	config,
	variableCompletions,
	onChange,
}: {
	config: Record<string, JsonValue>;
	variableCompletions: VariableCompletion[];
	onChange: (key: string, value: JsonValue) => void;
}) {
	const cases = getSwitchCaseRowsFromValue(config.cases);
	const caseReorder = useReorderController({
		rows: cases,
		onCommit: (rows) => onChange("cases", rows),
	});
	const draggedCase = caseReorder.drag
		? cases.find((switchCase) => switchCase.id === caseReorder.drag?.draggedId)
		: null;
	const switchValue = valueToInputString(config.value);
	const switchValueError =
		(!switchValue.trim() ? "Switch value is required." : "") ||
		validateVariableReferences(switchValue, variableCompletions);
	let visibleCaseIndex = 0;

	return (
		<div className="space-y-3">
			<TextInput
				error={switchValueError}
				label="Switch value"
				value={switchValue}
				usesVariables
				variableCompletions={variableCompletions}
				variableTypes="any"
				onChange={(value) => onChange("value", value)}
			/>
			<ul ref={caseReorder.listRef} className="space-y-3" aria-label="Switch cases">
				{caseReorder.entries.map((entry) => {
					if (entry.type === "drop-space") {
						return <ReorderDropSpace key={entry.id} height={entry.height} />;
					}

					const switchCase = entry.row;
					visibleCaseIndex += 1;
					const caseIndex = visibleCaseIndex;
					const nameError = validateSwitchCaseName(cases, switchCase.id);
					const valueError =
						validateSwitchCaseValue(cases, switchCase.id) ||
						validateVariableReferences(switchCase.value, variableCompletions);

					return (
						<li
							key={switchCase.id}
							ref={caseReorder.registerRow(switchCase.id)}
							data-reorder-card={switchCase.id}
							className="space-y-2 rounded border border-baud-border bg-baud-panel p-2 transition-[border-color,box-shadow] duration-150"
						>
							<div className="flex items-center justify-between">
								<div className="flex items-center gap-2">
									<DragHandle
										label={`Reorder switch case ${caseIndex}`}
										onPointerDown={(event) => caseReorder.startDrag(switchCase.id, event)}
									/>
									<span className="font-mono text-sm text-baud-muted">Case node {caseIndex}</span>
								</div>
								<RemoveRowButton
									label="Remove switch case"
									onClick={() =>
										onChange(
											"cases",
											cases.filter((row) => row.id !== switchCase.id),
										)
									}
								/>
							</div>
							<TextInput
								error={nameError}
								label="Name"
								value={switchCase.name}
								onChange={(value) => updateSwitchCase(cases, switchCase.id, { name: value }, onChange)}
							/>
							<TextInput
								error={valueError}
								label="Value"
								value={switchCase.value}
								usesVariables
								variableCompletions={variableCompletions}
								variableTypes="any"
								onChange={(value) => updateSwitchCase(cases, switchCase.id, { value }, onChange)}
							/>
						</li>
					);
				})}
			</ul>
			{draggedCase && caseReorder.drag && <FloatingSwitchCaseCard switchCase={draggedCase} drag={caseReorder.drag} />}
			<AddButton label="Add switch case" onClick={() => onChange("cases", [...cases, createSwitchCaseRow()])} />
		</div>
	);
}

function TextTransformConfigPanel({
	config,
	variableCompletions,
	onChange,
}: {
	config: Record<string, JsonValue>;
	variableCompletions: VariableCompletion[];
	onChange: (key: string, value: JsonValue) => void;
}) {
	const operations = getTextTransformOperationRows(config.operations);
	const operationReorder = useReorderController({
		rows: operations,
		onCommit: (rows) => onChange("operations", rows),
	});
	const draggedOperation = operationReorder.drag
		? operations.find((operation) => operation.id === operationReorder.drag?.draggedId)
		: null;
	let visibleOperationIndex = 0;

	return (
		<div className="space-y-3">
			<TextInput
				error={
					(!valueToInputString(config.input).trim() ? "Input is required." : "") ||
					validateVariableReferences(valueToInputString(config.input), variableCompletions)
				}
				label="Input"
				value={valueToInputString(config.input)}
				usesVariables
				variableCompletions={variableCompletions}
				variableTypes="any"
				onChange={(value) => onChange("input", value)}
			/>
			<p className="text-xs leading-4 text-baud-muted">
				Operations run from top to bottom. Each operation receives the result from the operation above it.
			</p>
			<ul ref={operationReorder.listRef} className="space-y-3" aria-label="Text transform operations">
				{operationReorder.entries.map((entry) => {
					if (entry.type === "drop-space") {
						return <ReorderDropSpace key={entry.id} height={entry.height} />;
					}
					const row = entry.row;
					visibleOperationIndex += 1;
					const operationIndex = visibleOperationIndex;
					const operation = normalizeTextTransformOperation(row.operation);
					return (
						<li
							key={row.id}
							ref={operationReorder.registerRow(row.id)}
							data-reorder-card={row.id}
							className="space-y-2 rounded border border-baud-border bg-baud-panel p-2"
						>
							<div className="flex items-center justify-between">
								<div className="flex items-center gap-2">
									<DragHandle
										label={`Reorder operation ${operationIndex}`}
										onPointerDown={(event) => operationReorder.startDrag(row.id, event)}
									/>
									<span className="font-mono text-sm text-baud-muted">Operation {operationIndex}</span>
								</div>
								<RemoveRowButton
									label="Remove operation"
									onClick={() =>
										onChange(
											"operations",
											operations.filter((operationRow) => operationRow.id !== row.id),
										)
									}
								/>
							</div>
							<ComboboxField
								label="Operation"
								value={operation}
								options={textTransformOperationOptions}
								onChange={(value) => updateTextTransformOperation(operations, row.id, { operation: value }, onChange)}
							/>
							<p className="text-xs leading-4 text-baud-muted">{getTextTransformHelp(operation)}</p>
							{operation === "template" && (
								<TextTransformRowInput
									label="Template"
									field="template"
									row={row}
									rows={operations}
									variableCompletions={variableCompletions}
									onChange={onChange}
								/>
							)}
							{(operation === "replace" || operation === "regex_replace") && (
								<>
									<TextTransformRowInput
										label={operation === "replace" ? "Search" : "Regex pattern"}
										field="search"
										row={row}
										rows={operations}
										variableCompletions={variableCompletions}
										onChange={onChange}
									/>
									<TextTransformRowInput
										label="Replacement"
										field="replacement"
										row={row}
										rows={operations}
										variableCompletions={variableCompletions}
										onChange={onChange}
									/>
								</>
							)}
							{operation === "format_datetime" && (
								<TextTransformRowInput
									label="Pattern"
									field="pattern"
									row={row}
									rows={operations}
									variableCompletions={variableCompletions}
									onChange={onChange}
								/>
							)}
							{operation === "format_duration" && (
								<>
									<ComboboxField
										label="Input unit"
										value={row.durationUnit}
										options={durationUnitOptions}
										onChange={(durationUnit) =>
											updateTextTransformOperation(operations, row.id, { durationUnit }, onChange)
										}
									/>
									<TextTransformRowInput
										label="Pattern"
										field="pattern"
										row={row}
										rows={operations}
										variableCompletions={variableCompletions}
										onChange={onChange}
									/>
								</>
							)}
							{(operation === "split" || operation === "join") && (
								<TextTransformRowInput
									label="Delimiter"
									field="delimiter"
									row={row}
									rows={operations}
									variableCompletions={variableCompletions}
									onChange={onChange}
								/>
							)}
							{operation === "substring" && (
								<div className="grid grid-cols-2 gap-2">
									<TextTransformRowInput
										label="Start"
										field="start"
										row={row}
										rows={operations}
										variableCompletions={variableCompletions}
										onChange={onChange}
									/>
									<TextTransformRowInput
										label="Length"
										field="length"
										row={row}
										rows={operations}
										variableCompletions={variableCompletions}
										onChange={onChange}
									/>
								</div>
							)}
							{(operation === "pad_start" || operation === "pad_end") && (
								<div className="grid grid-cols-2 gap-2">
									<TextTransformRowInput
										label="Target length"
										field="targetLength"
										row={row}
										rows={operations}
										variableCompletions={variableCompletions}
										onChange={onChange}
									/>
									<TextTransformRowInput
										label="Pad text"
										field="pad"
										row={row}
										rows={operations}
										variableCompletions={variableCompletions}
										onChange={onChange}
									/>
								</div>
							)}
						</li>
					);
				})}
			</ul>
			{draggedOperation && operationReorder.drag && (
				<FloatingReorderCard drag={operationReorder.drag}>
					<div className="flex items-center gap-2">
						<GripVertical size={15} className="text-baud-muted" />
						<span className="font-mono text-sm text-baud-muted">
							{getTextTransformOptionLabel(draggedOperation.operation)}
						</span>
					</div>
				</FloatingReorderCard>
			)}
			<AddButton
				label="Add operation"
				onClick={() => onChange("operations", [...operations, createTextTransformOperationRow()])}
			/>
		</div>
	);
}

function TextTransformRowInput({
	field,
	label,
	onChange,
	row,
	rows,
	variableCompletions,
}: {
	field: keyof Omit<TextTransformOperationRow, "id" | "operation">;
	label: string;
	onChange: (key: string, value: JsonValue) => void;
	row: TextTransformOperationRow;
	rows: TextTransformOperationRow[];
	variableCompletions: VariableCompletion[];
}) {
	const variableTypes = field === "start" || field === "length" || field === "targetLength" ? "integer" : "string";
	const error =
		validateTextTransformField(row, field) ||
		validateVariableReferences(row[field], variableCompletions) ||
		validateVariableReferenceTypes(row[field], variableCompletions, variableTypes);
	return (
		<TextInput
			error={error}
			label={label}
			value={row[field]}
			usesVariables
			variableCompletions={variableCompletions}
			variableTypes={variableTypes}
			onChange={(value) => updateTextTransformOperation(rows, row.id, { [field]: value }, onChange)}
		/>
	);
}

function ConditionCombinatorRow({
	conditions,
	condition,
	onChange,
}: {
	conditions: ConditionRow[];
	condition: ConditionRow;
	onChange: (key: string, value: JsonValue) => void;
}) {
	return (
		<div className="flex items-center gap-2">
			<div className="h-px flex-1 bg-baud-border" />
			<ComboboxField
				value={normalizeCombinator(condition.combinator)}
				options={combinatorOptions}
				onChange={(value) => updateCondition(conditions, condition.id, { combinator: value }, onChange)}
				triggerClassName="w-auto font-mono"
				ariaLabel="Condition combinator"
			/>
			<div className="h-px flex-1 bg-baud-border" />
		</div>
	);
}

function ConditionInvertCheckbox({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
	return (
		<div className="flex min-h-9 items-center justify-between gap-3 rounded-lg border border-baud-border bg-baud-panel/70 px-3 py-2 transition-colors hover:border-baud-line">
			<div>
				<span className="block text-sm text-baud-text">Invert condition</span>
				<span className="font-mono text-xs text-baud-muted">{checked ? "Enabled" : "Disabled"}</span>
			</div>
			<Switch checked={checked} onCheckedChange={onChange} />
		</div>
	);
}

function VariableOperationConfigPanel({
	config,
	declaredVariables,
	variableCompletions,
	onChange,
	onDeclareVariable,
}: {
	config: Record<string, JsonValue>;
	declaredVariables: DeclaredVariable[];
	variableCompletions: VariableCompletion[];
	onChange: (key: string, value: JsonValue) => void;
	onDeclareVariable: () => void;
}) {
	const operation = normalizeVariableOperation(valueToInputString(config.operation));
	const fixedType = getVariableOperationFixedType(operation);
	const savedName = valueToInputString(config.name);
	// A declared declared variable already fixes its scope and type, and a
	// package whose Variable Operation disagrees with the declaration is
	// rejected. Read both from the declaration rather than asking a second
	// time for something the project already states.
	const declared = declaredVariables.find((variable) => variable.name === savedName);
	// What this operation can be applied to. An operation with a fixed type
	// accepts only that type; increment accepts either numeric type, since it
	// preserves whichever the variable was declared with.
	const writableVariableOptions = declaredVariables
		.filter((variable) => {
			if (operation === "increment") return variable.type === "integer" || variable.type === "float";
			// A hotkey has no empty value — there is no key combination that
			// means "no key" — so clearing one has no answer. Reset does.
			if (operation === "clear") return variable.type !== "hotkey";
			return fixedType ? variable.type === fixedType : true;
		})
		.map((variable) => ({
			description: variable.description || undefined,
			label: variable.name,
			value: variable.name,
		}));
	// The mirror of the rule above: with a hotkey selected, Clear is not on
	// offer at all rather than offered and then refused by the runner.
	const availableOperationOptions = variableOperationOptions.filter(
		(option) => option.value !== "clear" || declared?.type !== "hotkey",
	);
	const scope = declared ? declared.scope : normalizeScope(valueToInputString(config.scope));
	const selectedType = fixedType ?? declared?.type ?? normalizeVariableType(valueToInputString(config.valueType));
	const itemType = declared?.itemType ?? normalizeListItemType(config.itemType) ?? "string";
	const fieldValueType = normalizeVariableType(valueToInputString(config.fieldValueType));
	const fieldItemType = normalizeListItemType(config.fieldItemType) ?? "string";
	const savedValue = valueToInputString(config.value);
	const savedFieldPath = valueToInputString(config.fieldPath);
	const [draftValue, setDraftValue] = useState(savedValue);
	const [draftFieldPath, setDraftFieldPath] = useState(savedFieldPath);

	useEffect(() => {
		setDraftValue(savedValue);
		setDraftFieldPath(savedFieldPath);
	}, [savedName, savedValue, savedFieldPath]);

	// The name is picked from the declarations, so the only way it fails is a
	// variable that was declared once and has since been renamed or removed.
	const nameValidationMessage =
		savedName && !declared ? `"${savedName}" is not declared. Pick a declared variable or declare it in Settings.` : "";
	const typeCompatibilityMessage = validateVariableOperationType(operation, selectedType);
	const validationMessage = validateVariableOperationValue(
		operation,
		selectedType,
		draftValue,
		draftFieldPath,
		itemType,
		fieldValueType,
		fieldItemType,
	);
	const inputVariableTypes = getVariableOperationInputType(operation, selectedType, fieldValueType);
	const variableReferenceMessage =
		validateVariableReferences(draftValue, variableCompletions) ||
		validateVariableReferenceTypes(draftValue, variableCompletions, inputVariableTypes);
	const valueValidationMessage = validationMessage || variableReferenceMessage;
	const definition = variableTypeDefinitions[selectedType];
	const operationDefinition = variableOperationDefinitions[operation];

	// Changing the operation can narrow which variables are writable. If the
	// one already named is no longer among them, clear it rather than leave a
	// selection the picker cannot show.
	const handleOperationChange = (value: string) => {
		const nextOperation = normalizeVariableOperation(value);
		const nextFixedType = getVariableOperationFixedType(nextOperation);
		const nextType = nextFixedType ?? selectedType;
		onChange("operation", nextOperation);
		const stillWritable = declared
			? nextOperation === "increment"
				? declared.type === "integer" || declared.type === "float"
				: !nextFixedType || declared.type === nextFixedType
			: false;
		if (!stillWritable && savedName) onChange("name", "");
		if (nextOperation === "set_object_field") {
			onChange("fieldValueType", fieldValueType);
		}
		const inputType = getVariableOperationInputType(nextOperation, nextType, fieldValueType);
		const nextValue = variableOperationNeedsValue(nextOperation) ? createEmptyVariableOperationInput(inputType) : "";
		onChange("value", nextValue);
		setDraftValue(nextValue);
	};

	const handleValueChange = (value: string) => {
		setDraftValue(value);
		if (
			!validateVariableOperationValue(
				operation,
				selectedType,
				value,
				draftFieldPath,
				itemType,
				fieldValueType,
				fieldItemType,
			)
		) {
			onChange("value", value);
		}
	};

	const handleFieldPathChange = (value: string) => {
		setDraftFieldPath(value);
		if (!validateObjectFieldPath(value)) {
			onChange("fieldPath", value.trim());
		}
	};

	// Picking a different variable can change the type being written, so the
	// value is reset to an empty input of the new type rather than left as
	// something the previous variable's type made sense of.
	const handleNameChange = (value: string) => {
		const nextDeclared = declaredVariables.find((variable) => variable.name === value);
		onChange("name", value);
		const nextType = fixedType ?? nextDeclared?.type ?? selectedType;
		const inputType = getVariableOperationInputType(operation, nextType, fieldValueType);
		const nextValue = variableOperationNeedsValue(operation) ? createEmptyVariableOperationInput(inputType) : "";
		onChange("value", nextValue);
		setDraftValue(nextValue);
	};

	return (
		<div className="space-y-3">
			<ComboboxField
				label="Operation"
				value={operation}
				options={availableOperationOptions}
				onChange={handleOperationChange}
			/>
			<p className="text-xs leading-4 text-baud-muted">{operationDefinition.description}</p>
			{/* A picker over declared variables rather than free text. A name
			    that is not declared cannot be written, so typing one was only
			    ever a way to build a package the runner refuses. The list is
			    narrowed to what this operation can accept: Append list offers
			    only lists, Toggle boolean only booleans. */}
			<ComboboxField
				label="Variable name"
				value={savedName}
				options={writableVariableOptions}
				emptyMessage={
					declaredVariables.length === 0
						? "No variables are declared yet."
						: `No declared variable accepts ${operationDefinition.label}.`
				}
				placeholder="Select a variable"
				hasError={!!nameValidationMessage}
				trailing={
					<InputGroupButton
						type="button"
						variant="ghost"
						size="icon-sm"
						className="h-full rounded-none border-0 border-l border-baud-border text-baud-muted hover:bg-baud-line hover:text-baud-text"
						aria-label="Declare a variable in Settings"
						title="Declare a variable in Settings"
						onClick={onDeclareVariable}
					>
						<Plus />
					</InputGroupButton>
				}
				onChange={handleNameChange}
			/>
			{nameValidationMessage && <p className="mt-1 text-xs leading-4 text-baud-danger">{nameValidationMessage}</p>}
			{/* Scope and type are read, not chosen. They belong to the declaration,
			    which is the only place they live, so the node states what it is
			    writing rather than offering a second answer that could differ. */}
			{declared ? (
				<p className="text-xs leading-4 text-baud-muted">
					Writes <span className="font-mono">{declared.name}</span>, declared {scope} and typed{" "}
					<span className="font-mono">{declared.type}</span>. {variableScopeDefinitions[normalizeScope(scope)]}
				</p>
			) : (
				<p className="text-xs leading-4 text-baud-danger">
					No variable named <span className="font-mono">{savedName || "…"}</span> is declared. Declare it under
					Settings, then Variables.
				</p>
			)}
			{typeCompatibilityMessage && <p className="text-xs leading-4 text-baud-danger">{typeCompatibilityMessage}</p>}
			{(operation === "set_object_field" || operation === "remove_object_field") && (
				<div className="space-y-3">
					<TextInput
						label="Object field path"
						value={draftFieldPath}
						onChange={handleFieldPathChange}
						hasError={!!validateObjectFieldPath(draftFieldPath)}
					/>
					<p className="mt-1 text-xs leading-4 text-baud-muted">
						Use dot paths and indexes, for example profile.name or users[0].score.
					</p>
					{validateObjectFieldPath(draftFieldPath) && (
						<p className="mt-1 text-xs leading-4 text-baud-danger">{validateObjectFieldPath(draftFieldPath)}</p>
					)}
					{operation === "set_object_field" && (
						<ComboboxField
							label="Field value type"
							value={fieldValueType}
							options={variableTypeOptions}
							onChange={(value) => {
								const nextType = normalizeVariableType(value);
								onChange("fieldValueType", nextType);
								if (nextType === "list") {
									onChange("fieldItemType", "string");
								}
								const nextValue = createEmptyVariableOperationInput(nextType);
								onChange("value", nextValue);
								setDraftValue(nextValue);
							}}
						/>
					)}
				</div>
			)}
			{operation === "set" && selectedType === "list" && (
				<ComboboxField
					label="List item type"
					value={itemType}
					options={listItemTypes.map((type) => ({ label: type, value: type }))}
					onChange={(value) => {
						const nextType = normalizeListItemType(value) ?? "string";
						onChange("itemType", nextType);
						const nextValue = createEmptyVariableOperationInput("list");
						onChange("value", nextValue);
						setDraftValue(nextValue);
					}}
				/>
			)}
			{operation === "set_object_field" && fieldValueType === "list" && (
				<ComboboxField
					label="Field list item type"
					value={fieldItemType}
					options={listItemTypes.map((type) => ({ label: type, value: type }))}
					onChange={(value) => {
						const nextType = normalizeListItemType(value) ?? "string";
						onChange("fieldItemType", nextType);
						const nextValue = serializeTypedConfigValue([], "list");
						onChange("value", nextValue);
						setDraftValue(nextValue);
					}}
				/>
			)}
			{operation === "remove_list_items" && (
				<ComboboxField
					label="Remove"
					value={valueToInputString(config.removeMode) || "all"}
					options={[
						{ label: "First match", value: "first" },
						{ label: "All matches", value: "all" },
					]}
					onChange={(value) => onChange("removeMode", value)}
				/>
			)}
			<div>
				{!variableOperationNeedsValue(operation) ? (
					<div className="rounded border border-baud-border bg-baud-soft p-3 text-sm leading-5 text-baud-muted">
						{operationDefinition.description} No manual value is required.
					</div>
				) : (
					<VariableOperationValueInput
						key={`${operation}:${getVariableOperationInputType(operation, selectedType, fieldValueType)}`}
						ariaLabel={operationDefinition.valueLabel}
						id={`${savedName || "variable"}-value`}
						itemType={
							operation === "set_object_field"
								? fieldValueType === "list"
									? fieldItemType
									: undefined
								: operation === "set" && selectedType === "list"
									? itemType
									: undefined
						}
						type={getVariableOperationInputType(operation, selectedType, fieldValueType)}
						value={draftValue}
						hasError={!!valueValidationMessage}
						variableTypes={inputVariableTypes}
						variables={variableCompletions}
						onChange={handleValueChange}
					/>
				)}
				{operation === "set" && <p className="mt-1 text-xs leading-4 text-baud-muted">{definition.description}</p>}
				{valueValidationMessage && <p className="mt-1 text-xs leading-4 text-baud-danger">{valueValidationMessage}</p>}
			</div>
		</div>
	);
}

function VariableOperationValueInput({
	ariaLabel,
	id,
	hasError,
	itemType,
	type,
	value,
	variableTypes,
	variables,
	onChange,
}: {
	ariaLabel: string;
	id: string;
	hasError: boolean;
	itemType?: ListItemType;
	type: VariableType;
	value: string;
	variableTypes: VariableInputContract;
	variables: VariableCompletion[];
	onChange: (value: string) => void;
}) {
	const fullTemplate = isFullTemplateReference(value);
	const [source, setSource] = useState<"literal" | "raw">(fullTemplate ? "raw" : "literal");

	if (type === "string" || type === "integer" || type === "float" || type === "object") {
		return (
			<div>
				<span className="mb-1 block font-mono text-sm text-baud-muted">{ariaLabel}</span>
				<VariableCodeInput
					ariaLabel={ariaLabel}
					value={value}
					multiline
					hasError={hasError}
					variableTypes={variableTypes}
					variables={variables}
					onChange={onChange}
				/>
			</div>
		);
	}

	const typedValue = parseTypedConfigValue(value, type, itemType);

	return (
		<div className="grid gap-2">
			<ComboboxField
				label="Value source"
				value={source}
				options={[
					{ label: "Literal value", value: "literal" },
					{ label: "Raw value", value: "raw" },
				]}
				onChange={(next) => {
					const nextSource = next === "raw" ? "raw" : "literal";
					setSource(nextSource);
					onChange(nextSource === "raw" ? "" : createEmptyVariableOperationInput(type, itemType));
				}}
			/>
			{source === "raw" ? (
				<div>
					<span className="mb-1 block font-mono text-sm text-baud-muted">{ariaLabel}</span>
					<VariableCodeInput
						ariaLabel={ariaLabel}
						value={value}
						multiline
						hasError={hasError}
						variableTypes={variableTypes}
						variables={variables}
						onChange={onChange}
					/>
				</div>
			) : (
				<div>
					<span className="mb-1 block font-mono text-sm text-baud-muted">{ariaLabel}</span>
					<TypedValueEditor
						ariaLabel={ariaLabel}
						id={id}
						itemType={itemType}
						showListItemType={false}
						type={type}
						value={typedValue}
						onChange={(next) => onChange(serializeTypedConfigValue(next, type))}
					/>
				</div>
			)}
		</div>
	);
}

function getVariableOperationInputType(
	operation: ReturnType<typeof normalizeVariableOperation>,
	targetType: VariableType,
	fieldValueType: VariableType,
) {
	if (operation === "append_list") {
		return "string";
	}
	if (operation === "remove_list_items") {
		return "string";
	}
	if (operation === "set_object_field") {
		return fieldValueType;
	}
	if (operation === "merge_object") {
		return "object";
	}
	if (operation === "increment") {
		// Increment accepts either an integer or a float amount; float is the
		// permissive choice since it does not reject a fractional amount.
		return "float";
	}
	return targetType;
}

function variableOperationNeedsValue(operation: ReturnType<typeof normalizeVariableOperation>) {
	return !["clear", "reset", "toggle_boolean", "remove_object_field"].includes(operation);
}

function parseTypedConfigValue(value: string, type: VariableType, itemType?: ListItemType): JsonValue {
	if (type === "string" || type === "color" || type === "hotkey") {
		return value;
	}
	if (type === "integer" || type === "float") {
		if (!value.trim()) {
			return "";
		}
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : "";
	}
	if (type === "boolean") {
		return value.trim().toLowerCase() === "true";
	}
	try {
		const parsed = JSON.parse(value) as JsonValue;
		return validateTypedValue(type, parsed, itemType) ? createEmptyTypedValue(type, itemType) : parsed;
	} catch {
		return createEmptyTypedValue(type, itemType);
	}
}

function serializeTypedConfigValue(value: JsonValue, type: VariableType) {
	return type === "string" || type === "color" || type === "hotkey" ? String(value) : JSON.stringify(value);
}

function createEmptyVariableOperationInput(type: VariableType, itemType?: ListItemType) {
	if (type === "string" || type === "color" || type === "hotkey" || type === "integer" || type === "float") {
		return "";
	}
	return serializeTypedConfigValue(createEmptyTypedValue(type, itemType), type);
}

function isFullTemplateReference(value: string) {
	return /^\{\{\s*[^{}]+\s*\}\}$/.test(value.trim());
}

function HttpHeadersPanel({
	config,
	variableCompletions,
	onChange,
}: {
	config: Record<string, JsonValue>;
	variableCompletions: VariableCompletion[];
	onChange: (key: string, value: JsonValue) => void;
}) {
	const headers = getHeaderRows(config.headers);

	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between">
				<span className="font-mono text-xs uppercase tracking-[0.14em] text-baud-muted">Headers</span>
				<AddButton compact label="Add header" onClick={() => onChange("headers", [...headers, createHeaderRow()])} />
			</div>
			{headers.map((header) => {
				const valueError =
					validateVariableReferences(header.value, variableCompletions) ||
					validateVariableReferenceTypes(header.value, variableCompletions, "string");
				const errorId = `header-${header.id}-value-error`;
				return (
					<div key={header.id} className="grid grid-cols-[1fr_1fr_24px] items-start gap-2">
						<Input
							value={header.name}
							onChange={(event) => updateHeader(headers, header.id, { name: event.target.value }, onChange)}
							placeholder="Header"
							className="min-w-0 bg-baud-panel px-2"
						/>
						<div className="min-w-0">
							<VariableCodeInput
								ariaDescribedBy={valueError ? errorId : undefined}
								ariaLabel="Header value"
								hasError={!!valueError}
								value={header.value}
								variableTypes="string"
								variables={variableCompletions}
								onChange={(value) => updateHeader(headers, header.id, { value }, onChange)}
								placeholder="Value"
							/>
							<FieldError id={errorId} message={valueError} />
						</div>
						<Button
							type="button"
							onClick={() =>
								onChange(
									"headers",
									headers.filter((row) => row.id !== header.id),
								)
							}
							aria-label="Remove header"
							size="icon"
							variant="destructive"
						>
							<X size={13} />
						</Button>
					</div>
				);
			})}
		</div>
	);
}

function PlaySoundConfigPanel({
	assets,
	config,
	variableCompletions,
	onChange,
}: {
	assets: EditorAsset[];
	config: Record<string, JsonValue>;
	variableCompletions: VariableCompletion[];
	onChange: (key: string, value: JsonValue) => void;
}) {
	const source = normalizePlaySoundSource(valueToInputString(config.source));
	const audioAssets = assets.filter((asset) => asset.kind === "audio");
	const assetOptions = audioAssets.map((asset) => ({
		label: `${asset.name} (${asset.packagePath})`,
		value: asset.packagePath,
	}));
	const assetPath = valueToInputString(config.assetPath);

	return (
		<div className="space-y-3">
			<ComboboxField
				label="Source"
				value={source}
				options={playSoundSourceOptions}
				onChange={(value) => onChange("source", value)}
			/>
			{source === "asset" ? (
				<div>
					<ComboboxField
						error={!assetPath ? "Audio asset is required." : ""}
						label="Audio asset"
						value={assetPath}
						options={assetOptions}
						onChange={(value) => onChange("assetPath", value)}
						ariaLabel="Audio asset"
					/>
					{audioAssets.length === 0 && (
						<p className="mt-1 text-xs leading-4 text-baud-danger">
							Add an audio file in the Asset Editor before using asset library playback.
						</p>
					)}
				</div>
			) : (
				<TextInput
					error={
						(!valueToInputString(config.filePath).trim() ? "File path is required." : "") ||
						validateVariableReferences(valueToInputString(config.filePath), variableCompletions) ||
						validateVariableReferenceTypes(valueToInputString(config.filePath), variableCompletions, "string")
					}
					label="File path"
					value={valueToInputString(config.filePath)}
					usesVariables
					variableCompletions={variableCompletions}
					variableTypes="string"
					onChange={(value) => onChange("filePath", value)}
				/>
			)}
		</div>
	);
}

function SerialWriteConfigPanel({
	config,
	deviceOptions,
	variableCompletions,
	onChange,
}: {
	config: Record<string, JsonValue>;
	deviceOptions: SelectOption[];
	variableCompletions: VariableCompletion[];
	onChange: (key: string, value: JsonValue) => void;
}) {
	const selectedDeviceId = valueToInputString(config.deviceId);
	const options =
		selectedDeviceId && !deviceOptions.some((option) => option.value === selectedDeviceId)
			? [{ label: `${selectedDeviceId} (not configured)`, value: selectedDeviceId }, ...deviceOptions]
			: deviceOptions;

	return (
		<div className="space-y-3">
			<ComboboxField
				error={!selectedDeviceId ? "Device is required." : ""}
				label="Device"
				value={selectedDeviceId}
				options={options}
				onChange={(value) => onChange("deviceId", value)}
				ariaLabel="Serial write device"
			/>
			{deviceOptions.length === 0 && (
				<p className="text-xs leading-4 text-baud-danger">
					Add a Serial Input Trigger first so the write action knows which logical serial device to target.
				</p>
			)}
			<ComboboxField
				label="Line ending"
				value={normalizeLineEnding(valueToInputString(config.lineEnding))}
				options={serialLineEndingOptions}
				onChange={(value) => onChange("lineEnding", value)}
			/>
			<TextInput
				error={
					(!valueToInputString(config.data).trim() ? "Data is required." : "") ||
					validateVariableReferences(valueToInputString(config.data), variableCompletions) ||
					validateVariableReferenceTypes(valueToInputString(config.data), variableCompletions, "string")
				}
				label="Data"
				value={valueToInputString(config.data)}
				usesVariables
				variableCompletions={variableCompletions}
				variableTypes="string"
				onChange={(value) => onChange("data", value)}
			/>
		</div>
	);
}

function WebSocketPathConfigPanel({
	config,
	onChange,
}: {
	config: Record<string, JsonValue>;
	onChange: (value: JsonValue) => void;
}) {
	const inputId = useId();
	const errorId = `${inputId}-error`;
	const configuredPath = valueToInputString(config.path);
	const inputValue = websocketPathInputFromConfig(config.path);
	const error = !configuredPath.trim()
		? "Path is required."
		: !configuredPath.startsWith("/")
			? 'WebSocket path must start with "/".'
			: "";

	return (
		<div>
			<label htmlFor={inputId} className="mb-1 block font-mono text-sm text-baud-muted">
				Path
			</label>
			<div className="relative">
				<span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 font-mono text-sm text-baud-muted">
					/
				</span>
				<Input
					id={inputId}
					aria-describedby={error ? errorId : undefined}
					aria-invalid={!!error || undefined}
					className="pl-6 font-mono"
					value={inputValue}
					onChange={(event) => onChange(websocketPathConfigFromInput(event.target.value))}
				/>
			</div>
			<FieldError id={errorId} message={error} />
		</div>
	);
}

function WebSocketConnectionConfigPanel({
	config,
	nodes,
	onChange,
}: {
	config: Record<string, JsonValue>;
	nodes: Node<ScriptNodeData>[];
	onChange: (value: JsonValue) => void;
}) {
	const value = valueToInputString(config.connectionId);
	const options = createWebSocketConnectionOptions(nodes);
	const triggerNodeId = getWebSocketConnectionTriggerId(config.connectionId);
	const selectionAvailable =
		!!triggerNodeId && nodes.some((node) => node.id === triggerNodeId && node.data.actionType === "trigger.websocket");
	const error = !value.trim()
		? "Connection is required."
		: !selectionAvailable
			? "Select an available WebSocket Trigger connection."
			: "";

	return (
		<ComboboxField
			emptyMessage="No WebSocket triggers available."
			error={error}
			label="Connection"
			options={options}
			placeholder="Select WebSocket trigger..."
			value={value}
			onChange={onChange}
		/>
	);
}

function KeyCaptureConfigPanel({
	config,
	variableCompletions,
	onChange,
}: {
	config: Record<string, JsonValue>;
	variableCompletions: VariableCompletion[];
	onChange: (key: string, value: JsonValue) => void;
}) {
	return (
		<KeyCaptureInput
			allowVariables
			label="Key"
			showReference
			value={getConfiguredKey(config)}
			variables={variableCompletions}
			onChange={(value) => onChange("key", value)}
		/>
	);
}

function NodeSpecificHelp({ actionType }: { actionType: ActionType }) {
	if (actionType === "trigger.webhook") {
		return (
			<p className="mb-3 rounded border border-baud-border bg-baud-soft px-3 py-2 text-xs leading-4 text-baud-muted">
				Call this trigger on the runner webhook server: http://&lt;runner-ip&gt;:&lt;runner-port&gt;/events/hookname.
				The runner decides the port.
			</p>
		);
	}

	if (actionType === "trigger.websocket") {
		return (
			<p className="mb-3 rounded border border-baud-border bg-baud-soft px-3 py-2 text-xs leading-4 text-baud-muted">
				Connect to this trigger through the runner WebSocket server. The runner decides host and port; this node defines
				the WebSocket path.
			</p>
		);
	}

	if (actionType === "trigger.startup") {
		return (
			<p className="mb-3 rounded border border-baud-border bg-baud-soft px-3 py-2 text-xs leading-4 text-baud-muted">
				Runs when the runner receives the operating system startup/session-start event.
			</p>
		);
	}

	if (actionType === "trigger.process_started") {
		return (
			<p className="mb-3 rounded border border-baud-border bg-baud-soft px-3 py-2 text-xs leading-4 text-baud-muted">
				The runner watches local process events and starts this branch when the configured process match is detected.
			</p>
		);
	}

	if (actionType === "trigger.hotkey") {
		return (
			<p className="mb-3 rounded border border-baud-border bg-baud-soft px-3 py-2 text-xs leading-4 text-baud-muted">
				Press any supported keys together to create a global chord. Windows Desktop supports letters, digits, function,
				navigation, punctuation, numpad, media, browser, and application-launch keys.
			</p>
		);
	}

	if (actionType === "action.keyboard") {
		return (
			<p className="mb-3 rounded border border-baud-border bg-baud-soft px-3 py-2 text-xs leading-4 text-baud-muted">
				Press, hold, or release any supported Windows key chord. Held keys are released automatically when the run ends.
				Use Type Text when you need to enter words or arbitrary text.
			</p>
		);
	}

	if (actionType === "control.repeat") {
		return (
			<p className="mb-3 rounded border border-baud-border bg-baud-soft px-3 py-2 text-xs leading-4 text-baud-muted">
				The repeat output runs the body once per iteration. Let the body branch end naturally and do not connect it back
				to the Repeat input. The done output runs after all iterations complete.
			</p>
		);
	}

	if (actionType === "control.while") {
		return (
			<p className="mb-3 rounded border border-baud-border bg-baud-soft px-3 py-2 text-xs leading-4 text-baud-muted">
				The while node checks its conditions before every iteration. The loop output runs while the conditions pass. Let
				the body branch end naturally; do not connect it back to the while input. The done output runs when the
				conditions fail.
			</p>
		);
	}

	return null;
}

function TextInput({
	error,
	label,
	value,
	onChange,
	hasError,
	usesVariables,
	variableCompletions,
	variableTypes,
}: {
	error?: string;
	label: string;
	value: string;
	onChange: (value: string) => void;
	hasError?: boolean;
} & (
	| {
			usesVariables: true;
			variableCompletions: VariableCompletion[];
			variableTypes: VariableInputContract;
	  }
	| {
			usesVariables?: false;
			variableCompletions?: never;
			variableTypes?: never;
	  }
)) {
	const inputId = useId();
	const errorId = `${inputId}-error`;
	const invalid = !!error || !!hasError;

	return (
		<div>
			<label htmlFor={inputId} className="mb-1 block font-mono text-sm text-baud-muted">
				{label}
			</label>
			{usesVariables ? (
				<VariableCodeInput
					id={inputId}
					ariaLabel={label}
					ariaDescribedBy={error ? errorId : undefined}
					value={value}
					hasError={invalid}
					variableTypes={variableTypes}
					variables={variableCompletions}
					onChange={onChange}
				/>
			) : (
				<Input
					id={inputId}
					aria-describedby={error ? errorId : undefined}
					aria-invalid={invalid || undefined}
					value={value}
					onChange={(event) => onChange(event.target.value)}
					className={
						invalid
							? "border-baud-danger focus-visible:border-baud-danger"
							: "border-baud-border focus-visible:border-baud-red/75"
					}
				/>
			)}
			<FieldError id={errorId} message={error} />
		</div>
	);
}

function ComboboxField({
	ariaDescribedBy,
	ariaLabel,
	disabled,
	emptyMessage,
	error,
	hasError,
	label,
	placeholder,
	value,
	options,
	onChange,
	trailing,
	triggerClassName,
}: {
	ariaDescribedBy?: string;
	ariaLabel?: string;
	disabled?: boolean;
	emptyMessage?: string;
	error?: string;
	hasError?: boolean;
	label?: string;
	placeholder?: string;
	value: string;
	options: SelectOption[];
	onChange: (value: string) => void;
	/** Control rendered beside the combobox, sharing its row. */
	trailing?: ReactNode;
	triggerClassName?: string;
}) {
	const generatedErrorId = useId();
	const errorId = `${generatedErrorId}-error`;
	const combobox = (
		<OptionCombobox
			ariaDescribedBy={ariaDescribedBy ?? (error ? errorId : undefined)}
			ariaLabel={ariaLabel ?? label}
			className={
				trailing
					? "h-full rounded-none border-0 bg-transparent shadow-none hover:border-0 focus-visible:border-0 focus-visible:shadow-none"
					: (triggerClassName ?? "w-full")
			}
			disabled={disabled}
			emptyMessage={emptyMessage}
			hasError={hasError || !!error}
			options={options}
			placeholder={placeholder}
			value={value}
			onChange={onChange}
		/>
	);

	const row = trailing ? (
		<InputGroup className="[&>div]:min-w-0 [&>div]:flex-1">
			{combobox}
			{trailing}
		</InputGroup>
	) : (
		combobox
	);

	if (!label) {
		return row;
	}

	return (
		<div>
			<span className="mb-1 block font-mono text-sm text-baud-muted">{label}</span>
			{row}
			<FieldError id={errorId} message={error} />
		</div>
	);
}

function AddButton({ compact, label, onClick }: { compact?: boolean; label: string; onClick: () => void }) {
	return (
		<Button type="button" onClick={onClick} size={compact ? "sm" : "default"}>
			<Plus size={13} />
			{label}
		</Button>
	);
}

function DragHandle({
	label,
	onPointerDown,
}: {
	label: string;
	onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
	return (
		<Button
			type="button"
			onPointerDown={onPointerDown}
			className="cursor-grab active:cursor-grabbing"
			aria-label={label}
			title={label}
			size="xsIcon"
			variant="ghost"
			style={{ touchAction: "none" }}
		>
			<GripVertical size={15} />
		</Button>
	);
}

function ReorderDropSpace({ height }: { height: number }) {
	return <li aria-hidden="true" className="transition-[height] duration-150 ease-out" style={{ height }} />;
}

function FloatingConditionCard({ condition, drag }: { condition: ConditionRow; drag: ActiveReorderDragState }) {
	return (
		<FloatingReorderCard drag={drag}>
			<div className="flex items-center justify-between gap-3">
				<div className="flex items-center gap-2">
					<GripVertical size={15} className="text-baud-muted" />
					<span className="font-mono text-sm text-baud-muted">Condition</span>
				</div>
				{condition.invert === true && <span className="font-mono text-xs uppercase text-baud-red">Inverted</span>}
			</div>
			<GhostField label="Value" value={condition.left} />
			<GhostField label="Expression" value={condition.operator} />
			{isBetweenConditionOperator(condition.operator) ? (
				<>
					<GhostField label="Start value" value={condition.right} />
					<GhostField label="End value" value={condition.rightEnd ?? ""} />
				</>
			) : (
				!isUnaryConditionOperator(condition.operator) && <GhostField label="Target" value={condition.right} />
			)}
		</FloatingReorderCard>
	);
}

function FloatingSwitchCaseCard({ switchCase, drag }: { switchCase: SwitchCaseRow; drag: ActiveReorderDragState }) {
	return (
		<FloatingReorderCard drag={drag}>
			<div className="flex items-center gap-2">
				<GripVertical size={15} className="text-baud-muted" />
				<span className="font-mono text-sm text-baud-muted">Case node</span>
			</div>
			<GhostField label="Name" value={switchCase.name} />
			<GhostField label="Value" value={switchCase.value} />
		</FloatingReorderCard>
	);
}

function FloatingReorderCard({ drag, children }: { drag: ActiveReorderDragState; children: ReactNode }) {
	return (
		<ReorderDragOverlay className="space-y-2 p-2" drag={drag} style={{ transform: "rotate(0.7deg)" }}>
			{children}
		</ReorderDragOverlay>
	);
}

function GhostField({ label, value }: { label: string; value: string }) {
	return (
		<div>
			<div className="mb-1 font-mono text-sm text-baud-muted">{label}</div>
			<div className="min-h-8 truncate rounded border border-baud-border bg-baud-soft px-3 py-1.5 font-mono text-sm text-baud-text">
				{value || "-"}
			</div>
		</div>
	);
}

function RemoveRowButton({ label, onClick }: { label: string; onClick: () => void }) {
	return (
		<Button type="button" onClick={onClick} aria-label={label} title={label} size="xsIcon" variant="destructive">
			<X size={13} />
		</Button>
	);
}

function hasCustomConfigPanel(actionType: ActionType) {
	return (
		actionType === "runtime.set_variable" ||
		actionType === "action.text.format" ||
		usesKeyReference(actionType) ||
		usesConditionRows(actionType) ||
		actionType === "control.switch" ||
		actionType === "action.http" ||
		actionType === "action.webhook_response" ||
		actionType === "action.sound.play" ||
		actionType === "action.serial.write" ||
		actionType === "trigger.websocket" ||
		actionType === "action.websocket.write"
	);
}

function normalizePlaySoundSource(value: string) {
	return value === "file_path" ? "file_path" : "asset";
}

function normalizeTextTransformOperation(value: string) {
	return textTransformOperationOptions.some((option) => option.value === value) ? value : "template";
}

function getTextTransformHelp(operation: string) {
	if (operation === "template") {
		return "Build text from normal content and {{variables}}.";
	}

	if (operation === "format_datetime") {
		return "Render a datetime as text with a pattern such as yyyy-MM-dd HH:mm.";
	}

	if (operation === "format_duration") {
		return "Render an elapsed number with a pattern such as HH:mm:ss or D HH:mm:ss.";
	}

	if (operation === "replace") {
		return "Replace every exact text match in the input.";
	}

	if (operation === "regex_replace") {
		return "Replace matches using a JavaScript-style regular expression pattern.";
	}

	if (operation === "sentence_case") {
		return "Uppercase the first character and lowercase the rest of the input.";
	}

	if (operation === "capitalize_words") {
		return "Uppercase the first letter at the start and after whitespace, then lowercase the other letters.";
	}

	if (operation === "split") {
		return "Split input text into list output items.";
	}

	if (operation === "join") {
		return "Join a JSON array or list reference into one text value.";
	}

	if (operation === "substring") {
		return "Read part of the input text. Leave length empty to continue to the end.";
	}

	if (operation === "pad_start" || operation === "pad_end") {
		return "Pad the input text until it reaches the target length.";
	}

	if (operation === "json_escape" || operation === "json_unescape") {
		return "Convert text to or from a JSON-safe string literal.";
	}

	if (operation === "base64_encode" || operation === "base64_decode") {
		return "Encode or decode UTF-8 text with Base64.";
	}

	if (operation === "url_encode" || operation === "url_decode") {
		return "Encode or decode text for URL query/path usage.";
	}

	return "Transform the input text and expose the result as runtime data.";
}

function getTextTransformOptionLabel(operation: string) {
	return textTransformOperationOptions.find((option) => option.value === operation)?.label ?? "Text operation";
}

function normalizeLineEnding(value: string) {
	return value === "lf" || value === "crlf" ? value : "none";
}

function usesKeyReference(actionType: ActionType) {
	return actionType === "trigger.hotkey" || actionType === "action.keyboard";
}

function usesConditionRows(actionType: ActionType) {
	return actionType === "control.if" || actionType === "control.while";
}

function getConfiguredKey(config: Record<string, JsonValue>) {
	const key = valueToInputString(config.key);
	if (key) {
		return formatKeyWithModifiers(key, valueToInputString(config.modifiers));
	}

	return "";
}

function formatKeyWithModifiers(key: string, modifiers: string) {
	if (!modifiers || modifiers === "none") {
		return key;
	}
	return `${modifiers
		.split("+")
		.filter(Boolean)
		.map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
		.join("+")}+${key}`;
}

function valueToInputString(value: JsonValue | undefined) {
	if (typeof value === "string") {
		return value;
	}

	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}

	return "";
}

function createVariableCompletions(variables: EditorVariable[]): VariableCompletion[] {
	const completionsByName = new Map<string, VariableCompletion>();

	for (const variable of variables) {
		completionsByName.set(variable.name, {
			description: variable.description,
			name: variable.name,
			preTrigger: variable.preTrigger,
			readOnly: variable.read_only,
			token: variable.token,
			type: variable.type,
			value: variable.value,
		});
	}

	return [...completionsByName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function getConditionRows(value: JsonValue | undefined, legacyCombinator = "and"): ConditionRow[] {
	if (!Array.isArray(value)) {
		return [createConditionRow()];
	}

	const rows = value
		.filter(isConditionRow)
		.map((condition, index) =>
			createSerializableConditionRow(condition, index === 0 ? undefined : (condition.combinator ?? legacyCombinator)),
		);

	return rows.length > 0 ? rows : [createConditionRow()];
}

function getHeaderRows(value: JsonValue | undefined): HeaderRow[] {
	return Array.isArray(value) ? value.filter(isHeaderRow) : [];
}

function updateCondition(
	conditions: ConditionRow[],
	id: string,
	patch: Partial<ConditionRow>,
	onChange: (key: string, value: JsonValue) => void,
) {
	onChange(
		"conditions",
		normalizeConditionRows(
			conditions.map((condition) => (condition.id === id ? { ...condition, ...patch } : condition)),
		),
	);
}

function normalizeConditionRows(conditions: ConditionRow[]) {
	return conditions.map((condition, index) =>
		createSerializableConditionRow(condition, index === 0 ? undefined : condition.combinator),
	);
}

function createSerializableConditionRow(condition: ConditionRow, combinator: string | undefined): ConditionRow {
	const row: ConditionRow = {
		id: condition.id,
		left: condition.left,
		operator: condition.operator,
		right: condition.right,
	};
	if (isBetweenConditionOperator(condition.operator)) {
		row.rightEnd = condition.rightEnd ?? "";
	}

	if (condition.invert === true) {
		row.invert = true;
	}

	return combinator === undefined ? row : { ...row, combinator: normalizeCombinator(combinator) };
}

function normalizeCombinator(value: string | undefined) {
	return value === "or" ? "or" : "and";
}

function normalizeVariableType(value: string): VariableType {
	return value in variableTypeDefinitions ? (value as VariableType) : "string";
}

function normalizeScope(value: string) {
	if (value === "local") {
		return "runtime";
	}

	if (value === "runner") {
		return "global";
	}

	return value === "persistent" || value === "global" ? value : "runtime";
}

function updateSwitchCase(
	cases: SwitchCaseRow[],
	id: string,
	patch: Partial<SwitchCaseRow>,
	onChange: (key: string, value: JsonValue) => void,
) {
	onChange(
		"cases",
		cases.map((switchCase) => (switchCase.id === id ? { ...switchCase, ...patch } : switchCase)),
	);
}

function updateTextTransformOperation(
	rows: TextTransformOperationRow[],
	id: string,
	updates: Partial<TextTransformOperationRow>,
	onChange: (key: string, value: JsonValue) => void,
) {
	onChange(
		"operations",
		rows.map((row) => (row.id === id ? { ...row, ...updates } : row)),
	);
}

function updateHeader(
	headers: HeaderRow[],
	id: string,
	patch: Partial<HeaderRow>,
	onChange: (key: string, value: JsonValue) => void,
) {
	onChange(
		"headers",
		headers.map((header) => (header.id === id ? { ...header, ...patch } : header)),
	);
}

/** Whether the node has an operation the format token reference applies to. */
function formatsADatetime(selectedNode: Node<ScriptNodeData>) {
	if (selectedNode.data.actionType !== "action.text.format") return false;
	return getTextTransformOperationRows(selectedNode.data.config.operations).some(
		(row) => row.operation === "format_datetime",
	);
}

function formatsADuration(selectedNode: Node<ScriptNodeData>) {
	if (selectedNode.data.actionType !== "action.text.format") return false;
	return getTextTransformOperationRows(selectedNode.data.config.operations).some(
		(row) => row.operation === "format_duration",
	);
}
