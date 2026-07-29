import { expect, test } from "@playwright/test";
import { decodeSimulationText } from "../../components/simulation/trigger-payload";

test("serial simulation converts visible escape notation to real control characters", () => {
	expect(decodeSimulationText(String.raw`\fN: 348g \r\n`)).toBe("\fN: 348g \r\n");
	expect(decodeSimulationText(String.raw`literal \\n`)).toBe(String.raw`literal \n`);
});
