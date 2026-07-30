import { expect, test } from "@playwright/test";
import { evaluateConditionValues } from "../../data/nodes/condition-comparison";

test("evaluates supported conditions without coercing invalid numeric values", () => {
	expect(evaluateConditionValues("12", ">", 3)).toEqual({ value: true });
	expect(evaluateConditionValues("not-a-number", ">", 3)).toEqual({
		error: "numeric comparison requires numeric values",
	});
});

test("validates inclusive ranges consistently with the runner", () => {
	expect(evaluateConditionValues(1, "is_between", 1, 10)).toEqual({ value: true });
	expect(evaluateConditionValues(10, "is_between", 1, 10)).toEqual({ value: true });
	expect(evaluateConditionValues(11, "is_between", 1, 10)).toEqual({ value: false });
	expect(evaluateConditionValues("value", "is_between", 1, 10)).toEqual({
		error: "between comparison requires numeric input, start, and end values",
	});
	expect(evaluateConditionValues(5, "is_between", 10, 1)).toEqual({
		error: "between comparison start must be less than or equal to end",
	});
});

test("reports invalid and unsupported condition operations", () => {
	expect(evaluateConditionValues("value", "regex_match", "[")).toMatchObject({
		error: expect.stringContaining("invalid regex pattern"),
	});
	expect(evaluateConditionValues("value", "unknown", "")).toEqual({
		error: "unsupported comparison operator unknown",
	});
});
