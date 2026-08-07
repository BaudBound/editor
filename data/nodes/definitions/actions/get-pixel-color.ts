import { Pipette } from "lucide-react";
import { defineNode } from "../../node-definition";
import { fallible } from "../runtime-outputs";

export const getPixelColorNode = defineNode({
	actionType: "action.pixel.get",
	capabilities: ["action.pixel"],
	configFields: [
		{
			key: "x",
			label: "Screen X",
			type: "number",
			usesVariables: true,
			variableTypes: "integer",
			numeric: {
				kind: "integer",
				signed: true,
				minimum: "-2147483648",
				maximum: "2147483647",
				minimumInclusive: true,
				maximumInclusive: true,
			},
		},
		{
			key: "y",
			label: "Screen Y",
			type: "number",
			usesVariables: true,
			variableTypes: "integer",
			numeric: {
				kind: "integer",
				signed: true,
				minimum: "-2147483648",
				maximum: "2147483647",
				minimumInclusive: true,
				maximumInclusive: true,
			},
		},
	],
	defaultConfig: () => ({ x: "", y: "" }),
	description: "Read a Windows virtual-desktop pixel at a signed X/Y coordinate.",
	desktopOnly: true,
	fallible: true,
	group: "actions",
	icon: Pipette,
	kind: "action",
	label: "Get Pixel Color",
	permission: { name: "screen.pixel.read", risk: "medium" },
	risk: "medium",
	supportedTargetRuntimes: ["Windows Desktop"],
	runtimeOutputs: fallible([
		{ name: "x", type: "integer", description: "Signed virtual-desktop X coordinate.", example: "n-mr3zyt6f-19.x" },
		{ name: "y", type: "integer", description: "Signed virtual-desktop Y coordinate.", example: "n-mr3zyt6f-19.y" },
		{ name: "hex", type: "color", description: "Pixel color as a hex string.", example: "n-mr3zyt6f-19.hex" },
		{
			name: "rgb",
			type: "color",
			description: "Pixel color as red, green, and blue channels.",
			example: "n-mr3zyt6f-19.rgb.r",
			fields: [
				{ name: "r", type: "integer", description: "Red channel, 0-255." },
				{ name: "g", type: "integer", description: "Green channel, 0-255." },
				{ name: "b", type: "integer", description: "Blue channel, 0-255." },
			],
		},
		{
			name: "rgba",
			type: "object",
			description: "Pixel color as red, green, blue, and alpha channels.",
			example: "n-mr3zyt6f-19.rgba.a",
			fields: [
				{ name: "r", type: "integer", description: "Red channel, 0-255." },
				{ name: "g", type: "integer", description: "Green channel, 0-255." },
				{ name: "b", type: "integer", description: "Blue channel, 0-255." },
				{ name: "a", type: "integer", description: "Alpha channel, 0-255." },
			],
		},
		{ name: "red", type: "integer", description: "Red channel, 0-255.", example: "n-mr3zyt6f-19.red" },
		{ name: "green", type: "integer", description: "Green channel, 0-255.", example: "n-mr3zyt6f-19.green" },
		{ name: "blue", type: "integer", description: "Blue channel, 0-255.", example: "n-mr3zyt6f-19.blue" },
		{ name: "alpha", type: "integer", description: "Alpha channel, 0-255.", example: "n-mr3zyt6f-19.alpha" },
		{ name: "integer", type: "integer", description: "Packed RGB integer value.", example: "n-mr3zyt6f-19.integer" },
	]),
	runnerType: "get_pixel_color",
	simulation: {
		createOutput: ({ api, context, node }) => ({
			failed: false,
			outputData: api.createPixelColorOutput(
				Number(api.resolveTemplate(api.getConfigString(node, "x"), context)),
				Number(api.resolveTemplate(api.getConfigString(node, "y"), context)),
			),
		}),
		describe: ({ api, context, node }) => {
			const output = context.nodeOutputs[node.id];
			const x = api.formatValue(api.resolveTemplate(api.getConfigString(node, "x"), context));
			const y = api.formatValue(api.resolveTemplate(api.getConfigString(node, "y"), context));

			return [
				{
					level: "info",
					message: `[Simulation] Get Pixel Color (${node.id}) succeeded. Captured simulated screen pixel at x=${x}, y=${y} as ${String(output?.hex ?? "unknown")}.`,
				},
			];
		},
	},
});
