"use client";

import {
	type FocusEventHandler,
	type KeyboardEvent,
	type KeyboardEventHandler,
	type ReactNode,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import {
	filterCompatibleVariables,
	formatVariableInputContract,
	isVariableTypeCompatible,
	splitCast,
} from "@/data/nodes/config-field-validation";
import type { VariableInputContract } from "@/data/nodes/node-definition";
import {
	variableTypes as allVariableTypes,
	getVariableReferenceStatus,
	type VariableReferenceCandidate,
} from "@/data/project/variables";
import type { JsonValue } from "@/lib/types";
import { cn } from "@/lib/utils";

export type VariableCompletion = {
	description?: string;
	name: string;
	preTrigger?: boolean;
	readOnly: boolean;
	token: string;
	type: VariableReferenceCandidate["type"];
	value?: JsonValue;
};

export type VariableCodeInputProps = {
	ariaLabel?: string;
	ariaDescribedBy?: string;
	className?: string;
	contentClassName?: string;
	containerClassName?: string;
	disabled?: boolean;
	hasError?: boolean;
	id?: string;
	inputMode?: "decimal" | "none" | "numeric" | "search" | "tel" | "text" | "url";
	multiline?: boolean;
	onBlur?: FocusEventHandler<HTMLTextAreaElement>;
	onChange: (value: string) => void;
	onFocus?: FocusEventHandler<HTMLTextAreaElement>;
	onKeyDown?: KeyboardEventHandler<HTMLTextAreaElement>;
	onKeyUp?: KeyboardEventHandler<HTMLTextAreaElement>;
	placeholder?: string;
	readOnly?: boolean;
	value: string;
	variableTypes: VariableInputContract;
	variables: VariableCompletion[];
};

type CompletionState = {
	end: number;
	query: string;
	start: number;
};

const MULTILINE_FIELD_CLASS = "min-h-24 resize-y overflow-auto px-2.5 py-2 leading-5";

/**
 * A single line scrolls sideways.
 *
 * This was `overflow-hidden`, which is not what broke the caret — a focused
 * textarea still scrolls itself to keep the caret in view even when hidden,
 * measured at scrollLeft 366 either way. It did stop a trackpad or a wheel
 * from reaching the rest of a long value, which is worth having. The bar
 * stays hidden because there is no room for one in a 2rem field.
 */
const SINGLE_LINE_FIELD_CLASS =
	"h-8 resize-none overflow-x-auto overflow-y-hidden whitespace-nowrap px-2.5 py-0 leading-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

export function VariableCodeInput({
	ariaLabel,
	ariaDescribedBy,
	className,
	contentClassName,
	containerClassName,
	disabled,
	hasError,
	id,
	inputMode,
	multiline = false,
	onBlur,
	onChange,
	onFocus,
	onKeyDown,
	onKeyUp,
	placeholder,
	readOnly,
	value,
	variableTypes,
	variables,
}: VariableCodeInputProps) {
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const highlightRef = useRef<HTMLPreElement>(null);
	const lineNumberRef = useRef<HTMLDivElement>(null);
	const suggestionListId = `${useId()}-suggestions`;
	const [caretPosition, setCaretPosition] = useState(0);
	const [isFocused, setIsFocused] = useState(false);
	const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
	const [suggestionsDismissed, setSuggestionsDismissed] = useState(false);
	const lineCount = Math.max(1, value.split("\n").length);
	const lineNumberWidth = `calc(${String(lineCount).length}ch + 1.5rem)`;
	const textLayerStyle = multiline ? { paddingLeft: `calc(${lineNumberWidth} + 0.625rem)` } : undefined;
	const completion = getCompletionState(value, caretPosition);
	const compatibleVariables = filterCompatibleVariables(variables, variableTypes);
	const suggestions = completion ? getSuggestions(compatibleVariables, completion.query) : [];
	const showSuggestions = isFocused && !suggestionsDismissed && !!completion && suggestions.length > 0;
	const lineNumbers = Array.from({ length: lineCount }, (_, index) => index + 1);
	const activeSuggestion = suggestions[activeSuggestionIndex] ?? suggestions[0];

	useEffect(() => {
		setActiveSuggestionIndex(0);
		setSuggestionsDismissed(false);
	}, [completion?.query, completion?.start]);

	const syncCaret = () => {
		const textarea = textareaRef.current;
		if (textarea) {
			setCaretPosition(textarea.selectionStart);
			setSuggestionsDismissed(false);
		}
	};

	/**
	 * Keeps the highlight layer aligned with the field the caret is in.
	 *
	 * The textarea's own text is transparent and the `pre` behind it is what a
	 * reader sees, so the two have to scroll together. This used to return early
	 * unless `multiline`, which is what made a single-line field look broken: the
	 * textarea scrolled to follow the caret, the layer stayed at zero, and the
	 * value appeared to stop dead at the right edge while the caret carried on
	 * into nothing. A single line scrolls sideways rather than down, but it does
	 * scroll.
	 */
	const syncScroll = () => {
		const textarea = textareaRef.current;
		if (!textarea) {
			return;
		}

		const { scrollTop, scrollLeft } = textarea;

		if (highlightRef.current) {
			highlightRef.current.scrollTop = scrollTop;
			highlightRef.current.scrollLeft = scrollLeft;
		}

		if (lineNumberRef.current) {
			lineNumberRef.current.scrollTop = scrollTop;
		}
	};

	// After every render, because a scroll caused by anything other than the
	// user scrolling — inserting a suggestion, or typing at the end of a full
	// line — never fires onScroll before React has repainted the layer.
	useLayoutEffect(syncScroll);

	const applySuggestion = (completionVariable: VariableCompletion) => {
		if (!completion) {
			return;
		}

		const nextValue = `${value.slice(0, completion.start)}${completionVariable.token}${value.slice(completion.end)}`;
		const nextCaret = completion.start + completionVariable.token.length;
		onChange(nextValue);
		requestAnimationFrame(() => {
			const textarea = textareaRef.current;
			if (!textarea) {
				return;
			}

			textarea.focus();
			textarea.setSelectionRange(nextCaret, nextCaret);
			setCaretPosition(nextCaret);
		});
	};

	const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (showSuggestions && event.key === "ArrowDown") {
			event.preventDefault();
			setActiveSuggestionIndex((current) => (current + 1) % suggestions.length);
			return;
		}
		if (showSuggestions && event.key === "ArrowUp") {
			event.preventDefault();
			setActiveSuggestionIndex((current) => (current - 1 + suggestions.length) % suggestions.length);
			return;
		}
		if ((event.key === "Tab" || event.key === "Enter") && showSuggestions && activeSuggestion) {
			event.preventDefault();
			applySuggestion(activeSuggestion);
			return;
		}
		if (showSuggestions && event.key === "Escape") {
			event.preventDefault();
			setSuggestionsDismissed(true);
			return;
		}

		onKeyDown?.(event);
		if (event.defaultPrevented) {
			return;
		}

		if (event.key === "Tab") {
			event.preventDefault();

			const textarea = event.currentTarget;
			const start = textarea.selectionStart;
			const end = textarea.selectionEnd;
			const nextValue = `${value.slice(0, start)}\t${value.slice(end)}`;
			onChange(nextValue);
			requestAnimationFrame(() => {
				textarea.setSelectionRange(start + 1, start + 1);
				setCaretPosition(start + 1);
			});
			return;
		}

		if (event.key === "Enter" && !multiline) {
			event.preventDefault();
		}
	};

	return (
		<Popover open={showSuggestions}>
			<PopoverAnchor asChild>
				<div className={cn("relative", containerClassName)}>
					<div
						className={cn(
							"relative overflow-hidden rounded-lg border bg-baud-panel/70 transition-[border-color,box-shadow]",
							!multiline && "grid-cols-1",
							hasError
								? "border-baud-danger shadow-[0_0_0_2px_rgb(224_92_92/0.14)]"
								: "border-baud-border focus-within:border-baud-red/75 focus-within:shadow-[0_0_0_2px_rgb(230_45_62/0.14)]",
							className,
						)}
					>
						{multiline && (
							<div
								ref={lineNumberRef}
								className="pointer-events-none absolute inset-y-0 left-0 z-20 select-none overflow-hidden border-r border-baud-border bg-baud-bg/45 px-2 py-2 text-right font-mono text-sm leading-5 text-baud-muted"
								style={{ width: lineNumberWidth }}
							>
								{lineNumbers.map((lineNumber) => (
									<div key={lineNumber}>{lineNumber}</div>
								))}
							</div>
						)}
						<div className="relative min-w-0">
							<pre
								ref={highlightRef}
								aria-hidden="true"
								data-variable-highlight-layer
								style={textLayerStyle}
								className={cn(
									"pointer-events-none absolute inset-0 z-0 overflow-hidden font-mono text-sm",
									multiline
										? "min-h-24 whitespace-pre-wrap wrap-break-word px-2.5 py-2 leading-5"
										: "h-8 whitespace-pre px-2.5 py-0 leading-8",
									contentClassName,
								)}
							>
								{value ? (
									renderHighlightedValue(value, variables, variableTypes)
								) : (
									<span className="text-baud-muted">{placeholder}</span>
								)}
								{"\n"}
							</pre>
							<textarea
								id={id}
								ref={textareaRef}
								aria-label={ariaLabel}
								aria-describedby={ariaDescribedBy}
								aria-invalid={hasError || undefined}
								aria-autocomplete="list"
								aria-controls={showSuggestions ? suggestionListId : undefined}
								aria-activedescendant={
									showSuggestions && activeSuggestion ? `${suggestionListId}-${activeSuggestionIndex}` : undefined
								}
								inputMode={inputMode}
								disabled={disabled}
								readOnly={readOnly}
								value={value}
								rows={multiline ? lineCount : 1}
								spellCheck={false}
								wrap={multiline ? "soft" : "off"}
								placeholder={placeholder}
								style={{ ...textLayerStyle, WebkitTextFillColor: "transparent" }}
								onBlur={(event) => {
									setIsFocused(false);
									onBlur?.(event);
								}}
								onClick={syncCaret}
								onFocus={(event) => {
									setIsFocused(true);
									syncCaret();
									onFocus?.(event);
								}}
								onKeyDown={handleKeyDown}
								onKeyUp={(event) => {
									syncCaret();
									onKeyUp?.(event);
								}}
								onSelect={syncCaret}
								onScroll={syncScroll}
								onChange={(event) => {
									const nextValue = multiline ? event.target.value : event.target.value.replace(/\r?\n/g, " ");
									onChange(nextValue);
									setCaretPosition(Math.min(event.target.selectionStart, nextValue.length));
									setSuggestionsDismissed(false);
								}}
								className={cn(
									"relative z-10 block w-full border-0 bg-transparent font-mono text-sm text-transparent caret-baud-text outline-none selection:bg-baud-red/30",
									multiline ? MULTILINE_FIELD_CLASS : SINGLE_LINE_FIELD_CLASS,
									contentClassName,
								)}
							/>
						</div>
					</div>
				</div>
			</PopoverAnchor>
			<PopoverContent
				align="start"
				side="bottom"
				sideOffset={4}
				onOpenAutoFocus={(event) => event.preventDefault()}
				onCloseAutoFocus={(event) => event.preventDefault()}
				className="block max-h-56 w-[var(--radix-popover-trigger-width)] overflow-y-auto rounded-lg border border-baud-border bg-baud-panel p-1 shadow-[0_16px_38px_rgba(0,0,0,0.42)]"
			>
				<div id={suggestionListId} role="listbox" aria-label={`${ariaLabel ?? "Variable"} suggestions`}>
					{suggestions.map((suggestion, index) => (
						<button
							id={`${suggestionListId}-${index}`}
							key={suggestion.name}
							type="button"
							role="option"
							aria-selected={index === activeSuggestionIndex}
							data-variable-suggestion={suggestion.name}
							className={cn(
								"flex w-full min-w-0 items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left outline-none",
								index === activeSuggestionIndex ? "bg-baud-soft text-baud-text" : "hover:bg-baud-soft",
							)}
							onMouseEnter={() => setActiveSuggestionIndex(index)}
							onPointerDown={(event) => event.preventDefault()}
							onClick={() => applySuggestion(suggestion)}
						>
							<span className="min-w-0">
								<span className="block truncate font-mono text-sm text-baud-text">{suggestion.token}</span>
								{suggestion.description && (
									<span className="block truncate text-xs text-baud-muted">{suggestion.description}</span>
								)}
							</span>
							<span className="shrink-0 font-mono text-xs text-baud-muted">{suggestion.type}</span>
						</button>
					))}
				</div>
			</PopoverContent>
		</Popover>
	);
}

function getCompletionState(value: string, caretPosition: number): CompletionState | null {
	const beforeCaret = value.slice(0, caretPosition);
	const openIndex = beforeCaret.lastIndexOf("{{");
	const closeIndex = beforeCaret.lastIndexOf("}}");

	if (openIndex === -1 || closeIndex > openIndex) {
		return null;
	}

	const query = beforeCaret.slice(openIndex + 2);
	if (query.includes("{") || query.includes("}") || query.includes("\n")) {
		return null;
	}

	const nextCloseIndex = value.indexOf("}}", caretPosition);
	const nextOpenIndex = value.indexOf("{{", openIndex + 2);
	const shouldReplaceClosingBraces =
		nextCloseIndex !== -1 &&
		(nextOpenIndex === -1 || nextCloseIndex < nextOpenIndex) &&
		!value.slice(caretPosition, nextCloseIndex).includes("\n");

	return {
		start: openIndex,
		end: shouldReplaceClosingBraces ? nextCloseIndex + 2 : caretPosition,
		query: query.trim(),
	};
}

function getSuggestions(variables: VariableCompletion[], query: string) {
	const normalizedQuery = query.toLowerCase();
	return variables
		.filter((variable) => !normalizedQuery || variable.name.toLowerCase().includes(normalizedQuery))
		.sort((left, right) => {
			const leftStartsWithQuery = left.name.toLowerCase().startsWith(normalizedQuery);
			const rightStartsWithQuery = right.name.toLowerCase().startsWith(normalizedQuery);
			return Number(rightStartsWithQuery) - Number(leftStartsWithQuery) || left.name.localeCompare(right.name);
		})
		.slice(0, 12);
}

function renderHighlightedValue(value: string, variables: VariableCompletion[], variableTypes: VariableInputContract) {
	const elements: ReactNode[] = [];
	const variablePattern = /\{\{[^{}]*\}\}/g;
	let lastIndex = 0;

	for (const match of value.matchAll(variablePattern)) {
		const start = match.index ?? 0;
		const token = match[0] ?? "";

		if (start > lastIndex) {
			elements.push(<span key={`text-${lastIndex}`}>{value.slice(lastIndex, start)}</span>);
		}

		const name = token.slice(2, -2);
		const trimmedName = name.trim();
		const hasSpacing = name !== trimmedName;
		// A cast target is not part of the name, and after a cast the field
		// contract applies to the target rather than to the variable's own
		// type. Highlighting the whole expression as one name marked every
		// cast red as an unknown variable.
		const { reference: normalizedName, target } = splitCast(trimmedName);
		const knownTarget = target !== null && (allVariableTypes as readonly string[]).includes(target);
		const status = target !== null && !knownTarget ? "invalid" : getVariableReferenceStatus(normalizedName, variables);
		const variable = variables.find((candidate) => candidate.name === normalizedName);
		const effectiveType = knownTarget ? (target as VariableCompletion["type"]) : variable?.type;
		const displayStatus =
			status === "known" && hasSpacing
				? "possible"
				: status === "known" && effectiveType && !isVariableTypeCompatible(effectiveType, variableTypes)
					? "type-mismatch"
					: status;

		elements.push(
			<span
				key={`variable-${start}`}
				title={getVariableReferenceTitle(displayStatus, hasSpacing, effectiveType, variableTypes)}
				data-variable-token={normalizedName}
				data-variable-status={displayStatus}
				className={cn(
					"rounded-sm",
					displayStatus === "known" && "bg-emerald-400/20 text-emerald-300",
					displayStatus === "possible" && "bg-amber-400/20 text-amber-300",
					displayStatus === "type-mismatch" && "bg-cyan-400/20 text-cyan-300",
					displayStatus === "invalid" && "bg-baud-danger/20 text-baud-danger",
				)}
			>
				{token}
			</span>,
		);

		lastIndex = start + token.length;
	}

	if (lastIndex < value.length) {
		elements.push(<span key={`text-${lastIndex}`}>{value.slice(lastIndex)}</span>);
	}

	return elements;
}

function getVariableReferenceTitle(
	status: "invalid" | "known" | "possible" | "type-mismatch",
	hasSpacing: boolean,
	actualType: VariableCompletion["type"] | undefined,
	expectedType: VariableInputContract,
) {
	if (status === "known") {
		return "This variable reference is known.";
	}

	if (hasSpacing) {
		return "Remove the spaces inside this variable reference.";
	}

	if (status === "type-mismatch") {
		return `This variable has type ${actualType}; this field accepts ${formatVariableInputContract(expectedType)} variables.`;
	}

	if (status === "possible") {
		return "This nested path may exist at runtime, but the editor cannot confirm it yet.";
	}

	return "This variable reference is not available.";
}
