import { expect, test } from "@playwright/test";
import regexConformance from "../../contracts/regex-conformance.json";
import { evaluateConditionValues } from "../../data/nodes/condition-comparison";

test("evaluates supported conditions without coercing invalid numeric values", async () => {
	expect(await evaluateConditionValues("12", ">", 3)).toEqual({ value: true });
	expect(await evaluateConditionValues("not-a-number", ">", 3)).toEqual({
		error: "numeric comparison requires numeric values",
	});
});

test("validates inclusive ranges consistently with the runner", async () => {
	expect(await evaluateConditionValues(1, "is_between", 1, 10)).toEqual({ value: true });
	expect(await evaluateConditionValues(10, "is_between", 1, 10)).toEqual({ value: true });
	expect(await evaluateConditionValues(11, "is_between", 1, 10)).toEqual({ value: false });
	expect(await evaluateConditionValues("value", "is_between", 1, 10)).toEqual({
		error: "between comparison requires numeric input, start, and end values",
	});
	expect(await evaluateConditionValues(5, "is_between", 10, 1)).toEqual({
		error: "between comparison start must be less than or equal to end",
	});
});

test("reports invalid and unsupported condition operations", async () => {
	expect(await evaluateConditionValues("value", "regex_match", "[")).toMatchObject({
		error: expect.stringContaining("invalid regex pattern"),
	});
	expect(await evaluateConditionValues("value", "unknown", "")).toEqual({
		error: "unsupported comparison operator unknown",
	});
});

test("matches the shared linear-time regex condition fixtures", async () => {
	for (const fixture of regexConformance.condition_cases) {
		expect(await evaluateConditionValues(fixture.input, "regex_match", fixture.pattern), fixture.name).toEqual({
			value: fixture.matched,
		});
	}
	for (const pattern of regexConformance.invalid_patterns) {
		expect(await evaluateConditionValues("baud", "regex_match", pattern)).toHaveProperty("error");
	}
});
