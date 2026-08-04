"use client";

import {
	AlignLeft,
	CalendarClock,
	CalendarDays,
	CheckSquare,
	CircleDot,
	Clock3,
	Copy,
	FileUp,
	FolderOpen,
	GripVertical,
	Hash,
	Heading,
	ImageIcon,
	Info,
	KeyRound,
	ListChecks,
	ListFilter,
	Minus,
	Palette,
	SlidersHorizontal,
	Trash2,
	Type,
} from "lucide-react";
import { type PointerEvent as ReactPointerEvent, useEffect, useId, useRef, useState } from "react";
import { ReorderDragOverlay } from "@/components/common/reorder-drag-overlay";
import type { VariableCompletion } from "@/components/common/variable-code-input";
import { FormDialogFieldSettings } from "@/components/inspector/form-dialog-field-settings";
import { getFormDialogFieldIssues, getFormDialogIssues } from "@/components/inspector/form-dialog-validation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { OptionCombobox } from "@/components/ui/option-combobox";
import {
	createFormDialogFieldWithUniqueKey,
	duplicateFormDialogField,
	FORM_DIALOG_MAX_FIELDS,
	type FormDialogFieldRow,
	type FormDialogFieldType,
	formDialogFieldTypeLabel,
	formDialogFieldTypeOptions,
	isFormDialogFieldType,
} from "@/data/nodes/form-dialog-fields";
import { type ActiveReorderDragState, useReorderController } from "@/hooks/use-reorder-controller";
import type { EditorAsset } from "@/lib/types";
import { cn } from "@/lib/utils";

type MobilePanel = "components" | "settings";

export function FormDialogBuilderDialog({
	assets,
	fields,
	onApply,
	onClose,
	open,
	variables,
}: {
	assets: EditorAsset[];
	fields: FormDialogFieldRow[];
	onApply: (fields: FormDialogFieldRow[]) => void;
	onClose: () => void;
	open: boolean;
	variables: VariableCompletion[];
}) {
	const titleId = useId();
	const wasOpenRef = useRef(false);
	const [draft, setDraft] = useState<FormDialogFieldRow[]>(fields);
	const [selectedFieldId, setSelectedFieldId] = useState(fields[0]?.id ?? "");
	const [mobilePanel, setMobilePanel] = useState<MobilePanel>("components");

	useEffect(() => {
		if (open && !wasOpenRef.current) {
			setDraft(fields);
			setSelectedFieldId(fields[0]?.id ?? "");
			setMobilePanel("components");
		}
		wasOpenRef.current = open;
	}, [fields, open]);

	const issues = getFormDialogIssues(draft, variables, assets);
	const selectedIndex = draft.findIndex((field) => field.id === selectedFieldId);
	const selectedField = selectedIndex >= 0 ? draft[selectedIndex] : undefined;
	const selectedIssues = selectedField ? getFormDialogFieldIssues(issues, selectedField.id) : [];
	const firstNavigableIssue = issues.find((issue) => issue.fieldId);

	const selectField = (fieldId: string) => {
		setSelectedFieldId(fieldId);
		setMobilePanel("settings");
	};
	const updateField = (fieldId: string, patch: Partial<FormDialogFieldRow>) =>
		setDraft((current) => current.map((field) => (field.id === fieldId ? { ...field, ...patch } : field)));
	const addField = (type: FormDialogFieldType) => {
		const field = createFormDialogFieldWithUniqueKey(type, draft);
		setDraft((current) => [...current, field]);
		selectField(field.id);
	};
	const duplicateField = (fieldId: string) => {
		const sourceIndex = draft.findIndex((field) => field.id === fieldId);
		if (sourceIndex < 0) return;
		const duplicate = duplicateFormDialogField(draft[sourceIndex], draft);
		setDraft((current) => {
			const next = [...current];
			next.splice(sourceIndex + 1, 0, duplicate);
			return next;
		});
		selectField(duplicate.id);
	};
	const removeField = (fieldId: string) => {
		const sourceIndex = draft.findIndex((field) => field.id === fieldId);
		if (sourceIndex < 0) return;
		const next = draft.filter((field) => field.id !== fieldId);
		setDraft(next);
		if (selectedFieldId === fieldId) {
			setSelectedFieldId(next[Math.min(sourceIndex, next.length - 1)]?.id ?? "");
			if (next.length === 0) setMobilePanel("components");
		}
	};

	return (
		<Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
			<DialogContent
				aria-labelledby={titleId}
				className="flex h-[min(860px,calc(100dvh-1rem))] min-h-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(1120px,calc(100vw-2rem))]"
				onOpenAutoFocus={(event) => event.preventDefault()}
				showCloseButton={false}
			>
				<DialogHeader className="shrink-0 border-b border-baud-border px-4 py-3">
					<DialogTitle id={titleId}>Edit form dialog</DialogTitle>
					<DialogDescription>Arrange the dialog components and configure the selected component.</DialogDescription>
				</DialogHeader>

				{issues.length > 0 && (
					<button
						type="button"
						className="flex min-h-10 shrink-0 items-center justify-between gap-3 border-b border-baud-danger/35 bg-baud-danger/10 px-4 text-left text-sm text-baud-danger outline-none hover:bg-baud-danger/15 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-baud-danger"
						disabled={!firstNavigableIssue}
						onClick={() => firstNavigableIssue?.fieldId && selectField(firstNavigableIssue.fieldId)}
					>
						<span className="min-w-0">
							<span className="block">{formatIssueCount(issues.length)} must be resolved before applying.</span>
							<span className="block truncate text-xs">{issues[0].message}</span>
						</span>
						{firstNavigableIssue && <span className="shrink-0 font-medium">Review first issue</span>}
					</button>
				)}

				<div
					aria-label="Form dialog editor sections"
					className="grid h-10 shrink-0 grid-cols-2 border-b border-baud-border lg:hidden"
					role="tablist"
				>
					<MobileTab
						active={mobilePanel === "components"}
						label="Components"
						onClick={() => setMobilePanel("components")}
					/>
					<MobileTab
						active={mobilePanel === "settings"}
						disabled={!selectedField}
						label="Settings"
						onClick={() => setMobilePanel("settings")}
					/>
				</div>

				<div className="grid min-h-0 flex-1 lg:grid-cols-[21rem_minmax(0,1fr)]">
					<div className={cn("min-h-0 border-r border-baud-border", mobilePanel !== "components" && "hidden lg:block")}>
						<FormOutline
							fields={draft}
							issues={issues}
							selectedFieldId={selectedFieldId}
							onAdd={addField}
							onChange={setDraft}
							onDuplicate={duplicateField}
							onRemove={removeField}
							onSelect={selectField}
						/>
					</div>

					<section
						aria-label="Selected component settings"
						className={cn("min-h-0 overflow-y-auto", mobilePanel !== "settings" && "hidden lg:block")}
					>
						{selectedField ? (
							<div className="mx-auto w-full max-w-2xl px-4 py-4 sm:px-6">
								<div className="mb-4 flex min-w-0 items-start justify-between gap-3 border-b border-baud-border pb-3">
									<div className="min-w-0">
										<p className="font-mono text-xs text-baud-muted">Component {selectedIndex + 1}</p>
										<h3 className="truncate text-base font-medium text-baud-text" data-form-component-type>
											{formDialogFieldTypeLabel(selectedField.type)}
										</h3>
									</div>
									{selectedIssues.length > 0 && <Badge variant="high">{formatIssueCount(selectedIssues.length)}</Badge>}
								</div>
								{selectedIssues.length > 0 && (
									<ul
										aria-label="Selected component validation issues"
										className="mb-4 border-l-2 border-baud-danger pl-3"
									>
										{selectedIssues.map((issue) => (
											<li className="text-xs leading-5 text-baud-danger" key={issue.message}>
												{issue.message}
											</li>
										))}
									</ul>
								)}
								<FormDialogFieldSettings
									assets={assets}
									field={selectedField}
									fields={draft}
									index={selectedIndex + 1}
									variables={variables}
									onChange={(patch) => updateField(selectedField.id, patch)}
								/>
							</div>
						) : (
							<div className="grid h-full min-h-56 place-items-center px-6 text-center text-sm text-baud-muted">
								Select a component to configure it.
							</div>
						)}
					</section>
				</div>

				<div className="flex shrink-0 justify-end gap-2 border-t border-baud-border bg-baud-soft/50 px-4 py-3">
					<Button type="button" variant="outline" onClick={onClose}>
						Cancel
					</Button>
					<Button disabled={issues.length > 0} type="button" variant="primary" onClick={() => onApply(draft)}>
						Apply
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}

function FormOutline({
	fields,
	issues,
	onAdd,
	onChange,
	onDuplicate,
	onRemove,
	onSelect,
	selectedFieldId,
}: {
	fields: FormDialogFieldRow[];
	issues: ReturnType<typeof getFormDialogIssues>;
	onAdd: (type: FormDialogFieldType) => void;
	onChange: (fields: FormDialogFieldRow[]) => void;
	onDuplicate: (fieldId: string) => void;
	onRemove: (fieldId: string) => void;
	onSelect: (fieldId: string) => void;
	selectedFieldId: string;
}) {
	const reorder = useReorderController({ rows: fields, onCommit: onChange });
	const draggedField = reorder.drag ? fields.find((field) => field.id === reorder.drag?.draggedId) : null;
	let visibleIndex = 0;

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="relative z-10 shrink-0 border-b border-baud-border p-3">
				{fields.length < FORM_DIALOG_MAX_FIELDS ? (
					<OptionCombobox
						ariaLabel="Add form component"
						options={formDialogFieldTypeOptions}
						placeholder="Add component"
						value=""
						onChange={(type) => isFormDialogFieldType(type) && onAdd(type)}
					/>
				) : (
					<p className="text-xs text-baud-muted">Maximum of {FORM_DIALOG_MAX_FIELDS} components reached.</p>
				)}
			</div>
			<div className="flex h-10 shrink-0 items-center justify-between border-b border-baud-border px-3">
				<span className="font-mono text-xs text-baud-muted">Components</span>
				<span className="text-xs text-baud-muted">
					{fields.length}/{FORM_DIALOG_MAX_FIELDS}
				</span>
			</div>
			{fields.length > 0 ? (
				<ul aria-label="Form dialog components" className="min-h-0 flex-1 overflow-y-auto" ref={reorder.listRef}>
					{reorder.entries.map((entry) => {
						if (entry.type === "drop-space") {
							return <li aria-hidden="true" key={entry.id} style={{ height: entry.height }} />;
						}
						visibleIndex += 1;
						const field = entry.row;
						const actualIndex = fields.findIndex((candidate) => candidate.id === field.id);
						const fieldIssues = getFormDialogFieldIssues(issues, field.id);
						const Icon = fieldTypeIcon(field.type);
						return (
							<li
								className={cn(
									"group flex min-h-16 items-center gap-1 border-b border-baud-border px-1.5 transition-colors",
									selectedFieldId === field.id ? "bg-baud-soft" : "hover:bg-baud-soft/60",
								)}
								key={field.id}
								ref={reorder.registerRow(field.id)}
							>
								<OutlineDragHandle
									label={`Reorder component ${visibleIndex}`}
									onKeyboardMove={(direction) => onChange(moveRow(fields, actualIndex, direction))}
									onPointerDown={(event) => reorder.startDrag(field.id, event)}
								/>
								<button
									type="button"
									aria-label={`Edit component ${visibleIndex}: ${field.label.trim() || formDialogFieldTypeLabel(field.type)}`}
									aria-pressed={selectedFieldId === field.id}
									className="flex min-w-0 flex-1 items-center gap-2 self-stretch rounded px-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-baud-red/60"
									onClick={() => onSelect(field.id)}
								>
									<Icon className="size-4 shrink-0 text-baud-muted" />
									<span className="min-w-0 flex-1">
										<span className="block truncate text-sm text-baud-text">
											{field.label.trim() || formDialogFieldTypeLabel(field.type)}
										</span>
										<span className="block truncate text-xs text-baud-muted" data-form-component-type>
											{formDialogFieldTypeLabel(field.type)}
										</span>
									</span>
									{fieldIssues.length > 0 && <Badge variant="high">{fieldIssues.length}</Badge>}
								</button>
								<Button
									aria-label={`Duplicate component ${visibleIndex}`}
									className="opacity-70 group-hover:opacity-100"
									onClick={() => onDuplicate(field.id)}
									size="xsIcon"
									title="Duplicate component"
									type="button"
									variant="ghost"
								>
									<Copy />
								</Button>
								<Button
									aria-label={`Remove component ${visibleIndex}`}
									className="opacity-70 group-hover:opacity-100"
									onClick={() => onRemove(field.id)}
									size="xsIcon"
									title="Remove component"
									type="button"
									variant="destructive"
								>
									<Trash2 />
								</Button>
							</li>
						);
					})}
				</ul>
			) : (
				<div className="grid min-h-0 flex-1 place-items-center px-5 text-center text-sm text-baud-muted">
					Add at least one component to create the form.
				</div>
			)}
			{draggedField && reorder.drag && <FloatingField drag={reorder.drag} field={draggedField} />}
		</div>
	);
}

function MobileTab({
	active,
	disabled,
	label,
	onClick,
}: {
	active: boolean;
	disabled?: boolean;
	label: string;
	onClick: () => void;
}) {
	return (
		<Button
			type="button"
			role="tab"
			aria-selected={active}
			className={cn("h-10 rounded-none border-b-2", active ? "border-baud-red text-baud-text" : "border-transparent")}
			disabled={disabled}
			onClick={onClick}
			size="none"
			variant="tab"
		>
			{label}
		</Button>
	);
}

function OutlineDragHandle({
	label,
	onKeyboardMove,
	onPointerDown,
}: {
	label: string;
	onKeyboardMove: (direction: -1 | 1) => void;
	onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
	return (
		<Button
			aria-label={label}
			className="cursor-grab active:cursor-grabbing"
			onKeyDown={(event) => {
				if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
				event.preventDefault();
				onKeyboardMove(event.key === "ArrowUp" ? -1 : 1);
			}}
			onPointerDown={onPointerDown}
			size="xsIcon"
			style={{ touchAction: "none" }}
			title={`${label}. Alt+Up or Alt+Down also moves it.`}
			type="button"
			variant="ghost"
		>
			<GripVertical />
		</Button>
	);
}

function FloatingField({ drag, field }: { drag: ActiveReorderDragState; field: FormDialogFieldRow }) {
	const Icon = fieldTypeIcon(field.type);
	return (
		<ReorderDragOverlay className="flex items-center gap-2 p-3 text-sm text-baud-text" drag={drag}>
			<GripVertical /> <Icon className="size-4" />
			<span className="truncate">{field.label.trim() || formDialogFieldTypeLabel(field.type)}</span>
		</ReorderDragOverlay>
	);
}

function fieldTypeIcon(type: FormDialogFieldType) {
	if (type === "password") return KeyRound;
	if (type === "multiline") return AlignLeft;
	if (type === "number") return Hash;
	if (type === "checkbox") return CheckSquare;
	if (type === "single_choice") return CircleDot;
	if (type === "multi_choice") return ListChecks;
	if (type === "information") return Info;
	if (type === "dropdown") return ListFilter;
	if (type === "date") return CalendarDays;
	if (type === "time") return Clock3;
	if (type === "datetime") return CalendarClock;
	if (type === "color") return Palette;
	if (type === "file") return FileUp;
	if (type === "folder") return FolderOpen;
	if (type === "slider") return SlidersHorizontal;
	if (type === "section_heading") return Heading;
	if (type === "divider") return Minus;
	if (type === "image") return ImageIcon;
	return Type;
}

function moveRow<Row>(rows: Row[], index: number, direction: -1 | 1) {
	const targetIndex = index + direction;
	if (index < 0 || targetIndex < 0 || targetIndex >= rows.length) return rows;
	const nextRows = [...rows];
	const [row] = nextRows.splice(index, 1);
	nextRows.splice(targetIndex, 0, row);
	return nextRows;
}

function formatIssueCount(count: number) {
	return `${count} ${count === 1 ? "issue" : "issues"}`;
}
