import networkActionContract from "@/contracts/network-action-conformance.json";
import type { JsonValue } from "@/lib/types";

export type HttpActionErrorCode = keyof typeof networkActionContract.error.codes;

const httpErrorRetryability: Readonly<Record<string, boolean>> = networkActionContract.error.codes;

export function createHttpActionError(
	message: string,
	code: string,
	details: Record<string, JsonValue>,
): Record<string, JsonValue> {
	const normalizedCode = normalizeHttpActionErrorCode(code);
	return {
		message,
		code: normalizedCode,
		type: networkActionContract.error.error_type,
		retryable: httpErrorRetryability[normalizedCode],
		details,
	};
}

export function normalizeHttpActionErrorCode(code: string): HttpActionErrorCode {
	if (Object.hasOwn(httpErrorRetryability, code)) {
		return code as HttpActionErrorCode;
	}
	return "HTTP_REQUEST_FAILED";
}
