"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { VariableCodeInput, type VariableCompletion } from "@/components/common/variable-code-input";
import { Button } from "@/components/ui/button";
import { ColorPicker, ColorPickerHue, ColorPickerSelection } from "@/components/ui/color-picker";
import {
	Popover,
	PopoverContent,
	PopoverDescription,
	PopoverHeader,
	PopoverTitle,
	PopoverTrigger,
} from "@/components/ui/popover";
import { colorValueToHex } from "@/data/nodes/color-match";

const FALLBACK_COLOR = "#000000";
const dynamicColorBackground =
	"repeating-conic-gradient(rgb(114 125 149 / 45%) 0 25%, rgb(23 27 39) 0 50%) 50% / 8px 8px";

export function ColorConfigInput({
	error,
	errorId,
	label,
	value,
	variables,
	onChange,
}: {
	error?: string;
	errorId?: string;
	label: string;
	value: string;
	variables: VariableCompletion[];
	onChange: (value: string) => void;
}) {
	const selectedVariable = variables.find((variable) => variable.token === value.trim());
	const currentColor = colorValueToHex(selectedVariable?.value ?? value);
	const [open, setOpen] = useState(false);
	const [pickerStartColor, setPickerStartColor] = useState(currentColor ?? FALLBACK_COLOR);
	const hasInteracted = useRef(false);
	const onChangeRef = useRef(onChange);

	useEffect(() => {
		onChangeRef.current = onChange;
	}, [onChange]);

	const handlePickerChange = useCallback((rgba: [number, number, number, number]) => {
		if (!hasInteracted.current) return;
		onChangeRef.current(rgbArrayToHex(rgba));
	}, []);

	function handleOpenChange(nextOpen: boolean) {
		if (nextOpen) {
			hasInteracted.current = false;
			setPickerStartColor(currentColor ?? FALLBACK_COLOR);
		}
		setOpen(nextOpen);
	}

	return (
		<div>
			<div
				className={`flex h-8 min-w-0 overflow-visible rounded-lg border bg-baud-panel/70 transition-[border-color,box-shadow] focus-within:border-baud-red/75 focus-within:shadow-[0_0_0_2px_rgb(230_45_62/0.14)] ${
					error ? "border-baud-danger shadow-[0_0_0_2px_rgb(224_92_92/0.14)]" : "border-baud-border"
				}`}
			>
				<Popover open={open} onOpenChange={handleOpenChange}>
					<PopoverTrigger asChild>
						<Button
							type="button"
							aria-label={`Open ${label.toLowerCase()} color picker`}
							aria-expanded={open}
							className="h-full w-9 shrink-0 rounded-l-lg rounded-r-none border-0 border-r border-baud-border p-0 hover:brightness-110 focus-visible:border-0 focus-visible:ring-0"
							title={`Choose ${label.toLowerCase()}`}
							variant="ghost"
							style={{ background: currentColor ?? dynamicColorBackground }}
						/>
					</PopoverTrigger>

					<PopoverContent align="start" className="w-72 gap-3 p-3" side="left" sideOffset={8}>
						<PopoverHeader>
							<PopoverTitle>{label}</PopoverTitle>
							<PopoverDescription>Choose a color or continue typing a value manually.</PopoverDescription>
						</PopoverHeader>
						<div
							onPointerDownCapture={() => {
								hasInteracted.current = true;
							}}
							onKeyDownCapture={() => {
								hasInteracted.current = true;
							}}
						>
							<ColorPicker
								key={pickerStartColor}
								className="h-auto w-full gap-3"
								defaultValue={pickerStartColor}
								onChange={handlePickerChange}
							>
								<ColorPickerSelection aria-label={`${label} saturation and lightness`} className="h-40" />
								<ColorPickerHue aria-label={`${label} hue`} />
							</ColorPicker>
						</div>
					</PopoverContent>
				</Popover>

				<VariableCodeInput
					ariaLabel={label}
					ariaDescribedBy={error ? errorId : undefined}
					className="rounded-none border-0 bg-transparent shadow-none focus-within:border-0 focus-within:shadow-none [&_textarea]:h-[30px]"
					containerClassName="min-w-0 flex-1"
					hasError={!!error}
					value={value}
					variableTypes="color"
					variables={variables}
					onChange={onChange}
				/>
			</div>
		</div>
	);
}

function rgbArrayToHex(rgba: [number, number, number, number]) {
	return `#${rgba
		.slice(0, 3)
		.map((channel) => Math.round(channel).toString(16).padStart(2, "0"))
		.join("")
		.toUpperCase()}`;
}
