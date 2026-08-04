export const userIdentifierPattern = /^[A-Za-z0-9_-]+$/;

export function validateUserIdentifier(value: string, label: string) {
	if (!value) {
		return `${label} is required.`;
	}

	return userIdentifierPattern.test(value)
		? ""
		: `${label} may contain only letters A-Z, letters a-z, numbers 0-9, hyphens, and underscores.`;
}
