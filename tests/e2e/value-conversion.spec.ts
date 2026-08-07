import { expect, test } from "@playwright/test";
import { convertValue } from "../../data/nodes/definitions/actions/convert-value";

test("value conversion supports every target type", () => {
	expect(convertValue("42.5", "float")).toEqual({ ok: true, value: 42.5 });
	expect(convertValue("42", "integer")).toEqual({ ok: true, value: 42 });
	expect(convertValue("TRUE", "boolean")).toEqual({ ok: true, value: true });
	expect(convertValue("[1,2]", "list")).toEqual({ ok: true, value: [1, 2] });
	expect(convertValue('{"ok":true}', "object")).toEqual({ ok: true, value: { ok: true } });
	expect(convertValue({ ok: true }, "string")).toEqual({ ok: true, value: '{"ok":true}' });
});

test("value conversion rejects lossy and mismatched values", () => {
	expect(convertValue("1.5", "integer").ok).toBe(false);
	expect(convertValue("9007199254740992", "integer").ok).toBe(false);
	expect(convertValue("yes", "boolean").ok).toBe(false);
	expect(convertValue("{}", "list").ok).toBe(false);
	expect(convertValue("[]", "object").ok).toBe(false);
	expect(convertValue("0x10", "float").ok).toBe(false);
	expect(convertValue("0b10", "integer").ok).toBe(false);
});
