"use client";

import CodeMirror from "@uiw/react-codemirror";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ColorConfigInput } from "@/components/inspector/color-config-input";
import { KeyCaptureInput } from "@/components/inspector/key-capture-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { NumericConfigContract } from "@/data/nodes/node-definition";
import {
	runtimeIntegerContract,
	runtimeNumberContract,
	validateNumericConfigValue,
} from "@/data/nodes/numeric-validation";
import {
	createTimeZoneOptions,
	datetimeInTimeZoneToIso,
	formatDatetimeForTimeZone,
	initialTimeZoneOptions,
	localTimeZoneValue,
	typedDatetimeIso,
} from "@/data/project/datetime";
import {
	createEmptyTypedValue,
	parseObjectValue,
	type TypedValueType,
	validateTypedValue,
} from "@/data/project/typed-values";
import { durationUnits, type ListItemType, listItemTypes } from "@/data/project/variables";
import { type ActiveReorderDragState, useReorderController } from "@/hooks/use-reorder-controller";
import type { JsonValue } from "@/lib/types";
import { NumericField } from "./numeric-field";
import { ReorderDragOverlay } from "./reorder-drag-overlay";

const durationAmountContract: NumericConfigContract = {
	...runtimeNumberContract,
	signed: false,
	minimum: "0",
};

type TypedValueEditorProps = {
	ariaLabel?: string;
	id?: string;
	itemType?: ListItemType;
	onChange: (value: JsonValue) => void;
	onItemTypeChange?: (type: ListItemType) => void;
	showListItemType?: boolean;
	type: TypedValueType;
	value: JsonValue;
};

export function TypedValueEditor({
	ariaLabel,
	id,
	itemType,
	onChange,
	onItemTypeChange,
	showListItemType = true,
	type,
	value,
}: TypedValueEditorProps) {
	if (type === "boolean") {
		return (
			<Select value={value === true ? "true" : "false"} onValueChange={(next) => onChange(next === "true")}>
				<SelectTrigger id={id} aria-label={ariaLabel} className="w-full">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="true">true</SelectItem>
					<SelectItem value="false">false</SelectItem>
				</SelectContent>
			</Select>
		);
	}

	if (type === "integer" || type === "float") {
		const contract = type === "integer" ? runtimeIntegerContract : runtimeNumberContract;
		return (
			<NumericField
				id={id}
				ariaLabel={ariaLabel}
				contract={contract}
				value={typeof value === "number" && Number.isFinite(value) ? value : ""}
				onChange={(nextDraft) => {
					if (!validateNumericConfigValue(nextDraft, contract)) {
						onChange(Number(nextDraft));
					}
				}}
			/>
		);
	}

	if (type === "object") {
		return <ObjectValueEditor id={id} ariaLabel={ariaLabel} value={value} onChange={onChange} />;
	}

	if (type === "list") {
		return (
			<ListValueEditor
				ariaLabel={ariaLabel}
				id={id}
				itemType={itemType}
				value={Array.isArray(value) ? value : []}
				onChange={onChange}
				onItemTypeChange={onItemTypeChange}
				showItemType={showListItemType}
			/>
		);
	}

	if (type === "datetime") {
		return <DatetimeValueEditor id={id} ariaLabel={ariaLabel} value={value} onChange={onChange} />;
	}

	if (type === "duration") {
		return <DurationValueEditor id={id} ariaLabel={ariaLabel} value={value} onChange={onChange} />;
	}

	if (type === "keyboard_key") {
		return (
			<KeyCaptureInput
				id={id}
				ariaLabel={ariaLabel}
				value={typeof value === "string" ? value : ""}
				onChange={onChange}
			/>
		);
	}

	if (type === "color") {
		return (
			<ColorConfigInput
				label={ariaLabel ?? "Color"}
				value={typeof value === "string" ? value : ""}
				variables={[]}
				onChange={onChange}
			/>
		);
	}

	return (
		<textarea
			id={id}
			aria-label={ariaLabel}
			className="min-h-24 w-full resize-y rounded-lg border border-input bg-transparent px-2.5 py-2 font-mono text-sm leading-5 text-baud-text outline-none focus-visible:border-baud-red/75 focus-visible:shadow-[0_0_0_2px_rgb(230_45_62/0.14)]"
			value={typeof value === "string" ? value : ""}
			onChange={(event) => onChange(event.target.value)}
		/>
	);
}

function ObjectValueEditor({ ariaLabel, id, value, onChange }: Omit<TypedValueEditorProps, "type" | "itemType">) {
	const formatted = useMemo(() => JSON.stringify(value && !Array.isArray(value) ? value : {}, null, 2), [value]);
	const [draft, setDraft] = useState(formatted);

	useEffect(() => {
		setDraft(formatted);
	}, [formatted]);

	return (
		<div className="overflow-hidden rounded-lg border border-input">
			<CodeMirror
				id={id}
				aria-label={ariaLabel}
				value={draft}
				height="160px"
				theme="dark"
				basicSetup={{ foldGutter: true, lineNumbers: true }}
				onChange={(next) => {
					setDraft(next);
					const parsed = parseObjectValue(next);
					if (parsed !== undefined) onChange(parsed);
				}}
			/>
		</div>
	);
}

function ListValueEditor({
	ariaLabel,
	id,
	itemType,
	value,
	onChange,
	onItemTypeChange,
	showItemType,
}: {
	ariaLabel?: string;
	id?: string;
	itemType?: ListItemType;
	value: JsonValue[];
	onChange: (value: JsonValue) => void;
	onItemTypeChange?: (type: ListItemType) => void;
	showItemType: boolean;
}) {
	const selectedType = itemType ?? "string";
	const rowIdPrefix = useId();
	const nextRowId = useRef(0);
	const rowIds = useRef<string[]>([]);
	while (rowIds.current.length < value.length) {
		rowIds.current.push(`${rowIdPrefix}-${nextRowId.current++}`);
	}
	if (rowIds.current.length > value.length) {
		rowIds.current.length = value.length;
	}
	const rows = value.map((item, index) => ({
		id: rowIds.current[index],
		value: item,
	}));
	const itemReorder = useReorderController({
		rows,
		onCommit: (nextRows) => {
			rowIds.current = nextRows.map((row) => row.id);
			onChange(nextRows.map((row) => row.value));
		},
	});
	const draggedRow = itemReorder.drag ? rows.find((row) => row.id === itemReorder.drag?.draggedId) : undefined;
	const changeItemType = (next: ListItemType) => {
		onItemTypeChange?.(next);
		onChange(value.map(() => createEmptyTypedValue(next)));
	};
	const removeListItem = (rowId: string) => {
		const index = rowIds.current.indexOf(rowId);
		if (index === -1) return;
		rowIds.current.splice(index, 1);
		onChange(value.filter((_, itemIndex) => itemIndex !== index));
	};
	const addListItem = () => {
		rowIds.current.push(`${rowIdPrefix}-${nextRowId.current++}`);
		onChange([...value, createEmptyTypedValue(selectedType)]);
	};

	return (
		<div className="grid gap-2">
			{showItemType && (
				<div className="grid gap-1 text-xs text-baud-muted">
					<span>Item type</span>
					<Select value={itemType ?? ""} onValueChange={(next) => changeItemType(next as ListItemType)}>
						<SelectTrigger
							id={id ? `${id}-item-type` : undefined}
							aria-label={ariaLabel ? `${ariaLabel} item type` : "Item type"}
							className="w-full"
						>
							<SelectValue placeholder="Select item type" />
						</SelectTrigger>
						<SelectContent>
							{listItemTypes.map((entry) => (
								<SelectItem key={entry} value={entry}>
									{entry}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			)}
			<ul ref={itemReorder.listRef} className="grid gap-2" aria-label={`${ariaLabel ?? "List"} items`}>
				{itemReorder.entries.map((entry) => {
					if (entry.type === "drop-space") {
						return <ListItemDropSpace key={entry.id} height={entry.height} />;
					}

					const row = entry.row;
					const index = rows.findIndex((item) => item.id === row.id);
					return (
						<li
							key={row.id}
							ref={itemReorder.registerRow(row.id)}
							data-reorder-card={row.id}
							className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-1.5 rounded border border-baud-border p-2"
						>
							<Button
								type="button"
								size="xsIcon"
								variant="ghost"
								className="cursor-grab active:cursor-grabbing"
								aria-label={`Reorder item ${index + 1}`}
								title={`Reorder item ${index + 1}`}
								style={{ touchAction: "none" }}
								onPointerDown={(event) => itemReorder.startDrag(row.id, event)}
							>
								<GripVertical size={15} />
							</Button>
							<TypedValueEditor
								ariaLabel={`${ariaLabel ?? "List"} item ${index + 1}`}
								type={selectedType}
								value={row.value}
								onChange={(next) => onChange(value.map((item, itemIndex) => (itemIndex === index ? next : item)))}
							/>
							<Button
								type="button"
								size="icon-xs"
								variant="ghost"
								aria-label={`Remove item ${index + 1}`}
								className="text-baud-danger"
								onClick={() => removeListItem(row.id)}
							>
								<Trash2 />
							</Button>
						</li>
					);
				})}
			</ul>
			{draggedRow && itemReorder.drag && (
				<FloatingListItem drag={itemReorder.drag} index={rows.findIndex((row) => row.id === draggedRow.id) + 1} />
			)}
			<Button
				type="button"
				size="xs"
				variant="toolbar"
				className="justify-self-start"
				disabled={!itemType}
				onClick={addListItem}
			>
				<Plus size={12} /> Add item
			</Button>
			{validateTypedValue("list", value, itemType) && (
				<p className="text-xs text-baud-danger">{validateTypedValue("list", value, itemType)}</p>
			)}
		</div>
	);
}

function ListItemDropSpace({ height }: { height: number }) {
	return <li aria-hidden="true" className="transition-[height] duration-150 ease-out" style={{ height }} />;
}

function FloatingListItem({ drag, index }: { drag: ActiveReorderDragState; index: number }) {
	return (
		<ReorderDragOverlay className="flex items-center gap-2 p-2" drag={drag} style={{ transform: "rotate(0.7deg)" }}>
			<GripVertical size={15} className="text-baud-muted" />
			<span className="font-mono text-sm text-baud-muted">List item {index}</span>
		</ReorderDragOverlay>
	);
}

function DatetimeValueEditor({ ariaLabel, id, value, onChange }: Omit<TypedValueEditorProps, "type" | "itemType">) {
	const current = readRecord(value);
	const iso = typedDatetimeIso(current as JsonValue) ?? new Date().toISOString();
	const [timeZone, setTimeZone] = useState(localTimeZoneValue);
	const [timeZoneOptions, setTimeZoneOptions] = useState(initialTimeZoneOptions);
	const displayedValue = formatDatetimeForTimeZone(iso, timeZone);
	const [draft, setDraft] = useState(displayedValue);
	const [validationMessage, setValidationMessage] = useState("");

	useEffect(() => {
		setTimeZoneOptions(createTimeZoneOptions());
	}, []);

	useEffect(() => {
		setDraft(displayedValue);
		setValidationMessage("");
	}, [displayedValue]);

	return (
		<div className="grid gap-2">
			<div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,0.8fr)]">
				<Input
					id={id}
					aria-label={ariaLabel}
					aria-invalid={validationMessage ? true : undefined}
					type="datetime-local"
					step="1"
					value={draft}
					onChange={(event) => {
						const nextDraft = event.target.value;
						setDraft(nextDraft);
						const nextIso = datetimeInTimeZoneToIso(nextDraft, timeZone);
						if (!nextIso) {
							setValidationMessage("Select a valid date and time for this timezone.");
							return;
						}
						setValidationMessage("");
						onChange({ type: "datetime", value: nextIso });
					}}
				/>
				<Select value={timeZone} onValueChange={setTimeZone}>
					<SelectTrigger aria-label="Datetime timezone" className="w-full">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{timeZoneOptions.map((option) => (
							<SelectItem key={option.value} value={option.value}>
								{option.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
			{validationMessage && <p className="text-xs leading-4 text-baud-danger">{validationMessage}</p>}
			<p className="text-xs leading-4 text-baud-muted">The selected date and time is stored as a UTC timestamp.</p>
		</div>
	);
}

function DurationValueEditor({ ariaLabel, id, value, onChange }: Omit<TypedValueEditorProps, "type" | "itemType">) {
	const current = readRecord(value);
	const amount = typeof current.value === "number" && Number.isFinite(current.value) ? current.value : 0;
	const unit =
		typeof current.unit === "string" && durationUnits.includes(current.unit as (typeof durationUnits)[number])
			? current.unit
			: "seconds";

	return (
		<div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_11rem]">
			<NumericField
				id={id}
				ariaLabel={ariaLabel ? `${ariaLabel} amount` : "Duration amount"}
				contract={durationAmountContract}
				value={amount}
				onChange={(nextDraft) => {
					if (!validateNumericConfigValue(nextDraft, durationAmountContract)) {
						onChange({ type: "duration", unit, value: Number(nextDraft) });
					}
				}}
			/>
			<Select value={unit} onValueChange={(next) => onChange({ type: "duration", unit: next, value: amount })}>
				<SelectTrigger aria-label={ariaLabel ? `${ariaLabel} unit` : "Duration unit"} className="w-full">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{durationUnits.map((entry) => (
						<SelectItem key={entry} value={entry}>
							{entry}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}

function readRecord(value: JsonValue): Record<string, JsonValue> {
	return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
