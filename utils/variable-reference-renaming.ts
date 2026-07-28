import type { JsonValue } from "@/lib/types";

export type VariableRename = {
	from: string;
	to: string;
};

export function renameVariableReferences(value: JsonValue, rename: VariableRename): JsonValue {
	if (typeof value === "string") {
		return renameVariableReferencesInText(value, rename);
	}

	if (Array.isArray(value)) {
		let changed = false;
		const next = value.map((entry) => {
			const renamed = renameVariableReferences(entry, rename);
			changed ||= renamed !== entry;
			return renamed;
		});
		return changed ? next : value;
	}

	if (value && typeof value === "object") {
		let changed = false;
		const next = Object.fromEntries(
			Object.entries(value).map(([key, entry]) => {
				const renamed = renameVariableReferences(entry, rename);
				changed ||= renamed !== entry;
				return [key, renamed];
			}),
		);
		return changed ? next : value;
	}

	return value;
}

export function renameVariableReferencesInText(value: string, rename: VariableRename) {
	return value.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (match, rawReference: string) => {
		const reference = rawReference.trim();
		if (
			reference !== rename.from &&
			!reference.startsWith(`${rename.from}.`) &&
			!reference.startsWith(`${rename.from}[`)
		) {
			return match;
		}

		return match.replace(reference, `${rename.to}${reference.slice(rename.from.length)}`);
	});
}
