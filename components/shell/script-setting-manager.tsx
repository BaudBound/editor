import { Cog, Pencil, Plus, Trash2 } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { TypedValueEditor } from "@/components/common/typed-value-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { formatScriptSettingValue, validateScriptSetting } from "@/data/project/script-settings";
import { createEmptyTypedValue, validateTypedValue } from "@/data/project/typed-values";
import type { ListItemType } from "@/data/project/variables";
import type { JsonValue, ScriptSetting, ScriptSettingType } from "@/lib/types";
import { scriptSettingTypes } from "@/lib/types";
import type { VariableRename } from "@/utils/variable-reference-renaming";

type ScriptSettingManagerProps = {
	settings: ScriptSetting[];
	onChange: (settings: ScriptSetting[], rename?: VariableRename) => void;
};

function emptySetting(): ScriptSetting {
	return {
		description: "",
		name: "",
		required: false,
		type: "string",
	};
}

export function ScriptSettingManager({ settings, onChange }: ScriptSettingManagerProps) {
	const [dialogOpen, setDialogOpen] = useState(false);
	const [editingName, setEditingName] = useState<string | null>(null);
	const [draft, setDraft] = useState<ScriptSetting>(emptySetting);
	const [hasDefault, setHasDefault] = useState(false);
	const [hasSimulationValue, setHasSimulationValue] = useState(false);
	const nameId = useId();
	const typeId = useId();
	const descriptionId = useId();
	const defaultId = useId();
	const simulationId = useId();
	const declarationError = useMemo(
		() => validateScriptSetting(draft, settings, editingName ?? undefined),
		[draft, editingName, settings],
	);
	const defaultError =
		hasDefault && draft.defaultValue !== undefined
			? validateTypedValue(draft.type, draft.defaultValue, draft.itemType)
			: hasDefault
				? "Choose a value."
				: null;
	const simulationError =
		hasSimulationValue && draft.simulationValue !== undefined
			? validateTypedValue(draft.type, draft.simulationValue, draft.itemType)
			: hasSimulationValue
				? "Choose a value."
				: null;

	const openCreate = () => {
		setEditingName(null);
		setDraft(emptySetting());
		setHasDefault(false);
		setHasSimulationValue(false);
		setDialogOpen(true);
	};

	const openEdit = (setting: ScriptSetting) => {
		setEditingName(setting.name);
		setDraft(structuredClone(setting));
		setHasDefault(setting.defaultValue !== undefined);
		setHasSimulationValue(setting.simulationValue !== undefined);
		setDialogOpen(true);
	};

	const changeType = (type: ScriptSettingType) => {
		setDraft((current) => ({
			description: current.description,
			name: current.name,
			required: current.required,
			type,
			...(type === "list" ? { itemType: "string" as ListItemType } : {}),
		}));
		setHasDefault(false);
		setHasSimulationValue(false);
	};

	const save = () => {
		if (declarationError || defaultError || simulationError) {
			return;
		}
		if (
			(hasDefault && draft.defaultValue === undefined) ||
			(hasSimulationValue && draft.simulationValue === undefined)
		) {
			return;
		}
		const normalized: ScriptSetting = {
			description: draft.description.trim(),
			name: draft.name.trim(),
			required: draft.required,
			type: draft.type,
			...(draft.type === "list" ? { itemType: draft.itemType } : {}),
			...(hasDefault ? { defaultValue: draft.defaultValue } : {}),
			...(hasSimulationValue ? { simulationValue: draft.simulationValue } : {}),
		};
		const next = editingName
			? settings.map((setting) => (setting.name === editingName ? normalized : setting))
			: [...settings, normalized];
		onChange(
			next.sort((left, right) => left.name.localeCompare(right.name)),
			editingName && editingName !== normalized.name
				? { from: `settings.${editingName}`, to: `settings.${normalized.name}` }
				: undefined,
		);
		setDialogOpen(false);
	};

	return (
		<section className="min-w-0 bg-baud-panel px-4 py-3">
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<div className="flex items-center gap-2 text-sm font-semibold text-baud-text">
						<Cog size={14} className="text-baud-blue" />
						Script settings
					</div>
					<p className="mt-0.5 text-xs leading-4 text-baud-muted">
						Runner users can override these values without editing the script package.
					</p>
				</div>
				<Button type="button" size="xs" variant="toolbar" onClick={openCreate}>
					<Plus size={12} /> Add setting
				</Button>
			</div>

			{settings.length === 0 ? (
				<div className="mt-3 rounded border border-baud-border bg-baud-soft p-3 text-sm text-baud-muted">
					No Script Settings are defined.
				</div>
			) : (
				<div className="mt-3 grid gap-2">
					{settings.map((setting) => (
						<article key={setting.name} className="rounded border border-baud-border bg-baud-soft p-2.5">
							<div className="flex min-w-0 items-start gap-2">
								<div className="min-w-0 flex-1">
									<div className="flex flex-wrap items-center gap-1.5">
										<span className="break-all font-mono text-sm font-semibold text-baud-text">{setting.name}</span>
										<Badge variant="outline">{setting.type}</Badge>
										<Badge variant={setting.required ? "medium" : "outline"}>
											{setting.required ? "Required" : "Optional"}
										</Badge>
									</div>
									{setting.description && (
										<p className="mt-1 text-xs leading-4 text-baud-muted">{setting.description}</p>
									)}
								</div>
								<div className="flex shrink-0 gap-1">
									<Button
										type="button"
										aria-label={`Edit ${setting.name}`}
										size="icon-xs"
										variant="ghost"
										onClick={() => openEdit(setting)}
									>
										<Pencil />
									</Button>
									<Button
										type="button"
										aria-label={`Delete ${setting.name}`}
										size="icon-xs"
										variant="ghost"
										className="text-baud-muted hover:bg-baud-danger/15 hover:text-baud-danger"
										onClick={() => onChange(settings.filter((entry) => entry.name !== setting.name))}
									>
										<Trash2 />
									</Button>
								</div>
							</div>
							<div className="mt-2 grid gap-2 border-t border-baud-border pt-2 sm:grid-cols-2">
								<SettingValue
									itemType={setting.itemType}
									label="Package default"
									type={setting.type}
									value={setting.defaultValue}
								/>
								<SettingValue
									itemType={setting.itemType}
									label="Simulation override"
									type={setting.type}
									value={setting.simulationValue}
								/>
							</div>
						</article>
					))}
				</div>
			)}

			<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
				<DialogContent className="sm:max-w-xl">
					<DialogHeader>
						<DialogTitle>{editingName ? "Edit Script Setting" : "Add Script Setting"}</DialogTitle>
						<DialogDescription>Use this value in nodes with the reference {`{{settings.Name}}`}.</DialogDescription>
					</DialogHeader>
					<div className="grid gap-3 sm:grid-cols-2">
						<label htmlFor={nameId} className="grid gap-1 text-xs text-baud-muted">
							Name
							<Input
								id={nameId}
								value={draft.name}
								onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
							/>
						</label>
						<label htmlFor={typeId} className="grid gap-1 text-xs text-baud-muted">
							Type
							<Select value={draft.type} onValueChange={(value) => changeType(value as ScriptSettingType)}>
								<SelectTrigger id={typeId} className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{scriptSettingTypes.map((type) => (
										<SelectItem key={type} value={type}>
											{type}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</label>
					</div>
					<label htmlFor={descriptionId} className="grid gap-1 text-xs text-baud-muted">
						Description
						<Input
							id={descriptionId}
							value={draft.description}
							onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
						/>
					</label>
					<div className="flex items-center justify-between gap-3 rounded border border-baud-border p-2">
						<div>
							<div className="text-sm text-baud-text">Required</div>
							<p className="text-xs leading-4 text-baud-muted">
								A configured value or a package default must exist before the script can run.
							</p>
						</div>
						<Switch
							aria-label="Required Script Setting"
							checked={draft.required}
							onCheckedChange={(required) => setDraft((current) => ({ ...current, required }))}
						/>
					</div>
					<OptionalValueEditor
						enabled={hasDefault}
						error={defaultError}
						id={defaultId}
						itemType={draft.itemType}
						label="Package default"
						type={draft.type}
						value={draft.defaultValue}
						onEnabledChange={(enabled) => {
							setHasDefault(enabled);
							setDraft((current) => ({
								...current,
								defaultValue: enabled
									? (current.defaultValue ?? createEmptyTypedValue(current.type, current.itemType))
									: undefined,
							}));
						}}
						onItemTypeChange={(itemType) => setDraft((current) => ({ ...current, itemType }))}
						onValueChange={(defaultValue) => setDraft((current) => ({ ...current, defaultValue }))}
					/>
					<OptionalValueEditor
						enabled={hasSimulationValue}
						error={simulationError}
						id={simulationId}
						itemType={draft.itemType}
						label="Simulation override"
						type={draft.type}
						value={draft.simulationValue}
						onEnabledChange={(enabled) => {
							setHasSimulationValue(enabled);
							setDraft((current) => ({
								...current,
								simulationValue: enabled
									? (current.simulationValue ?? createEmptyTypedValue(current.type, current.itemType))
									: undefined,
							}));
						}}
						onItemTypeChange={(itemType) => setDraft((current) => ({ ...current, itemType }))}
						onValueChange={(simulationValue) => setDraft((current) => ({ ...current, simulationValue }))}
					/>
					{declarationError && <div className="text-xs text-baud-danger">{declarationError}</div>}
					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
							Cancel
						</Button>
						<Button
							type="button"
							variant="primary"
							disabled={Boolean(declarationError || defaultError || simulationError)}
							onClick={save}
						>
							Save
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</section>
	);
}

function OptionalValueEditor({
	enabled,
	error,
	id,
	itemType,
	label,
	type,
	value,
	onEnabledChange,
	onItemTypeChange,
	onValueChange,
}: {
	enabled: boolean;
	error: string | null;
	id: string;
	itemType?: ListItemType;
	label: string;
	type: ScriptSettingType;
	value: JsonValue | undefined;
	onEnabledChange: (enabled: boolean) => void;
	onItemTypeChange: (type: ListItemType) => void;
	onValueChange: (value: JsonValue) => void;
}) {
	return (
		<div className="grid gap-2 rounded border border-baud-border p-2">
			<div className="flex items-center justify-between gap-3">
				<label htmlFor={`${id}-enabled`} className="text-sm text-baud-text">
					{label}
				</label>
				<Switch id={`${id}-enabled`} aria-label={`Use ${label}`} checked={enabled} onCheckedChange={onEnabledChange} />
			</div>
			{enabled && value !== undefined && (
				<TypedValueEditor
					ariaLabel={label}
					id={id}
					itemType={itemType}
					type={type}
					value={value}
					onChange={onValueChange}
					onItemTypeChange={onItemTypeChange}
				/>
			)}
			{error && <div className="text-xs text-baud-danger">{error}</div>}
		</div>
	);
}

function SettingValue({
	itemType,
	label,
	type,
	value,
}: {
	itemType?: ListItemType;
	label: string;
	type: ScriptSettingType;
	value: import("@/lib/types").JsonValue | undefined;
}) {
	return (
		<div className="min-w-0">
			<div className="text-[10px] font-semibold tracking-[0.08em] text-baud-muted uppercase">{label}</div>
			<pre
				className="mt-1 min-h-7 whitespace-pre-wrap break-all rounded border border-baud-border bg-baud-panel/60 px-2 py-1.5 font-mono text-xs text-baud-text"
				data-selectable-text="true"
			>
				{value === undefined ? "Not set" : formatScriptSettingValue(type, value, itemType)}
			</pre>
		</div>
	);
}
