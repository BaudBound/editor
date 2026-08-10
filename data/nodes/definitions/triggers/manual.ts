import { Play } from "lucide-react";
import { defineNode } from "../../node-definition";
import { triggerOverlapFields } from "../shared-fields";

export const manualTriggerNode = defineNode({
	actionType: "trigger.manual",
	capabilities: ["trigger.manual"],
	configFields: [...triggerOverlapFields],
	defaultConfig: () => ({ overlap: "queue" }),
	description: "Start the script manually.",
	group: "triggers",
	icon: Play,
	kind: "trigger",
	label: "Manual",
	risk: "low",
	runnerType: "manual",
});
