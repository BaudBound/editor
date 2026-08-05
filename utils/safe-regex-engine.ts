import { RE2JS } from "re2js";
import regexPolicy from "@/contracts/regex-policy.json";

export type SafeRegexMatchRequest = { input: string; operation: "match"; pattern: string };
export type SafeRegexReplaceRequest = {
	input: string;
	operation: "replace";
	pattern: string;
	replacement: string;
};
export type SafeRegexRequest = SafeRegexMatchRequest | SafeRegexReplaceRequest;

export type SafeRegexMatchResult = { matched: boolean };
export type SafeRegexReplaceResult = { value: string };
export type SafeRegexResult = SafeRegexMatchResult | SafeRegexReplaceResult;
export type SafeRegexResultFor<TRequest extends SafeRegexRequest> = TRequest extends SafeRegexMatchRequest
	? SafeRegexMatchResult
	: SafeRegexReplaceResult;

export function validateSafeRegexPattern(pattern: string) {
	const patternBytes = new TextEncoder().encode(pattern).byteLength;
	if (patternBytes > regexPolicy.max_pattern_utf8_bytes) {
		return `regex pattern exceeds ${regexPolicy.max_pattern_utf8_bytes} UTF-8 bytes`;
	}

	try {
		RE2JS.compile(pattern);
		return "";
	} catch (error) {
		return `invalid regex pattern: ${error instanceof Error ? error.message : "unknown syntax error"}`;
	}
}

export function executeSafeRegex(request: SafeRegexMatchRequest): SafeRegexMatchResult;
export function executeSafeRegex(request: SafeRegexReplaceRequest): SafeRegexReplaceResult;
export function executeSafeRegex(request: SafeRegexRequest): SafeRegexResult;
export function executeSafeRegex(request: SafeRegexRequest): SafeRegexResult {
	const patternError = validateSafeRegexPattern(request.pattern);
	if (patternError) throw new Error(patternError);
	const inputBytes = new TextEncoder().encode(request.input).byteLength;
	if (inputBytes > regexPolicy.max_simulation_input_utf8_bytes) {
		throw new Error(
			`regex input exceeds the simulation maximum of ${regexPolicy.max_simulation_input_utf8_bytes} UTF-8 bytes`,
		);
	}

	const expression = RE2JS.compile(request.pattern);
	return request.operation === "match"
		? { matched: expression.test(request.input) }
		: { value: expression.matcher(request.input).replaceAll(request.replacement) };
}
