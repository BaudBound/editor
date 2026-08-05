import { Hash } from "lucide-react";
import { defineNode } from "../../node-definition";
import { validateSwitchConfig, validateSwitchVariableInputs } from "../../switch-validation";
import { createSwitchCaseRow } from "../rows";

export const switchNode = defineNode({
	actionType: "control.switch",
	capabilities: ["runtime.switch"],
	controlType: "switch",
	defaultConfig: () => ({ value: "", cases: [createSwitchCaseRow()] }),
	description: "Match one value against cases.",
	group: "control",
	icon: Hash,
	kind: "control",
	label: "Switch",
	portPolicy: { kind: "switch-cases", configKey: "cases", outputPrefix: "case-", defaultOutput: "default" },
	risk: "low",
	validateConfig: validateSwitchConfig,
	validateVariables: validateSwitchVariableInputs,
});
