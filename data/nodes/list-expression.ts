export function validateListExpression(value: unknown, label: string) {
	if (typeof value !== "string" || !value.trim()) {
		return `${label} is required.`;
	}

	const trimmed = value.trim();
	if (/^\{\{\s*[^{}]+\s*}}$/.test(trimmed)) {
		return "";
	}
	if (trimmed.includes("{{") || trimmed.includes("}}")) {
		return `${label} must be a JSON list or one variable reference.`;
	}

	try {
		return Array.isArray(JSON.parse(trimmed)) ? "" : `${label} must be a JSON list or one variable reference.`;
	} catch {
		return `${label} must be valid JSON list syntax or one variable reference.`;
	}
}
