"use client";

import { ListChecks, Pencil } from "lucide-react";
import { useState } from "react";
import { FieldError } from "@/components/common/field-error";
import type { VariableCompletion } from "@/components/common/variable-code-input";
import { FormDialogBuilderDialog } from "@/components/modals/form-dialog-builder-dialog";
import { Button } from "@/components/ui/button";
import { type FormDialogFieldRow, getFormDialogFields, isPresentationFieldType } from "@/data/nodes/form-dialog-fields";
import type { EditorAsset, JsonValue } from "@/lib/types";
import { getFormDialogIssues } from "./form-dialog-validation";

export function FormDialogBuilder({
	assets,
	error,
	errorId,
	onChange,
	value,
	variables,
}: {
	assets: EditorAsset[];
	error: string;
	errorId: string;
	onChange: (value: JsonValue) => void;
	value: JsonValue | undefined;
	variables: VariableCompletion[];
}) {
	const [open, setOpen] = useState(false);
	const fields = getFormDialogFields(value);
	const issueCount = getFormDialogIssues(fields, variables, assets).length;

	const apply = (nextFields: FormDialogFieldRow[]) => {
		onChange(nextFields);
		setOpen(false);
	};

	return (
		<>
			<div
				aria-describedby={error ? errorId : undefined}
				aria-invalid={!!error || undefined}
				className={`flex min-h-14 items-center gap-3 rounded-lg border bg-baud-panel/70 px-3 py-2 ${
					error ? "border-baud-danger" : "border-baud-border"
				}`}
			>
				<ListChecks className="size-4 shrink-0 text-baud-muted" />
				<div className="min-w-0 flex-1">
					<p className="text-sm text-baud-text">{formatComponentCount(fields.length)}</p>
					<p className={issueCount > 0 ? "text-xs text-baud-danger" : "text-xs text-baud-muted"}>
						{issueCount > 0 ? formatIssueCount(issueCount) : summarizeFieldTypes(fields)}
					</p>
				</div>
				<Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
					<Pencil /> Edit form
				</Button>
			</div>
			<FieldError id={errorId} message={error} />
			<FormDialogBuilderDialog
				assets={assets}
				fields={fields}
				onApply={apply}
				onClose={() => setOpen(false)}
				open={open}
				variables={variables}
			/>
		</>
	);
}

function formatComponentCount(count: number) {
	return `${count} ${count === 1 ? "component" : "components"}`;
}

function formatIssueCount(count: number) {
	return `${count} validation ${count === 1 ? "issue" : "issues"}`;
}

function summarizeFieldTypes(fields: FormDialogFieldRow[]) {
	if (fields.length === 0) return "At least one component is required";
	const inputCount = fields.filter((field) => !isPresentationFieldType(field.type)).length;
	const displayCount = fields.length - inputCount;
	if (displayCount === 0) return `${inputCount} ${inputCount === 1 ? "input" : "inputs"}`;
	if (inputCount === 0) return `${displayCount} display ${displayCount === 1 ? "element" : "elements"}`;
	return `${inputCount} ${inputCount === 1 ? "input" : "inputs"}, ${displayCount} display ${
		displayCount === 1 ? "element" : "elements"
	}`;
}
