// spec 015 — Token Pattern Builder: backend-wired resolver, validator, preview.
// spec 018 — pattern + autoApplyPattern keys persisted via settings transport.
// spec 041 (T051, FR-026b) — per-frame-type destination patterns.
import {
	type KeyboardEvent as ReactKeyboardEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import {
	getSettings,
	type PatternPart,
	type PatternPreviewResponse,
	patternPreview,
	patternValidate,
	updateSettings,
} from "@/api/commands";
import { Btn } from "@/ui";
import { m } from "@/lib/i18n";
import { SettingsSection, SettingsRow } from "./SettingsKit";

interface NamingStructureProps {
	save: (scope: string, values: Record<string, unknown>) => void;
}

// ── Token / separator vocabulary ──────────────────────────────────────────────

const AVAILABLE_TOKENS = [
	"target",
	"filter",
	"date",
	"frame_type",
	"camera",
	"exposure",
	"gain",
	"binning",
	"set_temp",
] as const;

const SEPARATORS = ["/", "-", "_", " "] as const;

// ── Per-type path-pattern chip representation ─────────────────────────────────
//
// Per-type destination patterns are stored as path strings (e.g.
// `masters/flats/{filter}/`). We parse them into an ordered list of chips that
// can be three kinds:
//   - 'token'   — a `{name}` placeholder, e.g. `{filter}`
//   - 'literal' — a bare directory segment, e.g. `flats`, `masters`
//   - 'sep'     — a `/` path separator
//
// This is intentionally separate from the `PatternPart` model used by the
// Project Folder Pattern, which only has 'token' and 'separator' (and its
// separators include `-`, `_`, ` ` in addition to `/`). Per-type patterns are
// always path strings, so the only meaningful separator is `/`.

export type PathChipKind = "token" | "literal" | "sep";

export interface PathChip {
	id: string;
	kind: PathChipKind;
	/** For 'token': the token name (without braces). For 'literal': the segment text. For 'sep': always '/'. */
	value: string;
}

let _pathChipCounter = 1000;
function nextPathId(): string {
	return `pc${(_pathChipCounter++).toString()}`;
}

/**
 * Parse a per-type destination pattern string into an ordered list of PathChips.
 *
 * The string is split on `/` boundaries. Each part between slashes is either a
 * `{token}` placeholder or a bare literal segment. The `/` separators become
 * 'sep' chips. An empty string produces an empty array.
 *
 * Examples:
 *   'masters/flats/{filter}/'  →  [literal:'masters', sep, literal:'flats', sep, token:'filter', sep]
 *   '{target}/{filter}/{date}/light/'  →  [token:'target', sep, token:'filter', sep, token:'date', sep, literal:'light', sep]
 */
export function parsePathPattern(pattern: string): PathChip[] {
	if (pattern.trim() === "") return [];
	const chips: PathChip[] = [];
	// Walk through the string manually so we preserve every `/` as a sep chip.
	let rest = pattern;
	while (rest.length > 0) {
		const slashIdx = rest.indexOf("/");
		if (slashIdx === -1) {
			// No more slashes — remaining text is a segment (no trailing sep)
			const seg = rest;
			if (seg.startsWith("{") && seg.endsWith("}")) {
				chips.push({
					id: nextPathId(),
					kind: "token",
					value: seg.slice(1, -1),
				});
			} else if (seg !== "") {
				chips.push({ id: nextPathId(), kind: "literal", value: seg });
			}
			break;
		}
		// There is a slash at slashIdx
		const seg = rest.slice(0, slashIdx);
		if (seg.startsWith("{") && seg.endsWith("}")) {
			chips.push({ id: nextPathId(), kind: "token", value: seg.slice(1, -1) });
		} else if (seg !== "") {
			chips.push({ id: nextPathId(), kind: "literal", value: seg });
		}
		chips.push({ id: nextPathId(), kind: "sep", value: "/" });
		rest = rest.slice(slashIdx + 1);
	}
	return chips;
}

/**
 * Serialize an ordered list of PathChips back to a per-type destination pattern string.
 *
 * token → `{name}`, literal → bare text, sep → `/`. The chips are concatenated directly.
 */
export function serializePathPattern(chips: PathChip[]): string {
	return chips
		.map((c) => (c.kind === "token" ? `{${c.value}}` : c.value))
		.join("");
}

// ── Per-frame-type destination patterns (spec 041 T051, FR-026b) ──────────────
//
// The backend stores these under ONE naming-scope key, `patternsByType`: a
// JSON object mapping a frame-type class name to a pattern string. The seven
// class names below are the exact strings the backend recognises. An absent key
// (or empty input) means "use the built-in default" — only overridden classes
// are persisted.

const FRAME_TYPE_CLASSES = [
	"light",
	"flat",
	"dark",
	"bias",
	"master_flat",
	"master_dark",
	"master_bias",
] as const;
type FrameTypeClass = (typeof FRAME_TYPE_CLASSES)[number];

const FRAME_TYPE_LABELS: Record<FrameTypeClass, string> = {
	light: "Light",
	flat: "Flat",
	dark: "Dark",
	bias: "Bias",
	master_flat: "Master Flat",
	master_dark: "Master Dark",
	master_bias: "Master Bias",
};

// Built-in defaults shown as the placeholder / reset target per type.
const FRAME_TYPE_DEFAULT_PATTERNS: Record<FrameTypeClass, string> = {
	light: "{target}/{filter}/{date}/light/",
	flat: "flats/{filter}/{date}/",
	dark: "darks/{exposure}/",
	bias: "bias/",
	master_flat: "masters/flats/{filter}/",
	master_dark: "masters/darks/{exposure}/",
	master_bias: "masters/bias/",
};

// Valid `{token}` names (mirrors the backend token vocabulary). Literal path
// segments are allowed; only `{...}` tokens are validated.
const VALID_PATTERN_TOKENS = new Set(AVAILABLE_TOKENS);

/**
 * Client-side mirror of the backend token rule. Returns an error message when
 * the pattern references an unknown `{token}`, else `null`. An empty string is
 * NOT an error here — it means "use the built-in default". The backend
 * `value.invalid` result remains the source of truth on save.
 */
function validatePatternString(value: string): string | null {
	if (value.trim() === "") return null; // empty = use default
	const unknown: string[] = [];
	const re = /\{([^}]*)\}/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(value)) !== null) {
		const token = m[1];
		if (!VALID_PATTERN_TOKENS.has(token as (typeof AVAILABLE_TOKENS)[number])) {
			unknown.push(token);
		}
	}
	if (unknown.length > 0) {
		return `Unknown token${unknown.length > 1 ? "s" : ""}: ${unknown.map((t) => `{${t}}`).join(", ")}`;
	}
	return null;
}

// ── Sample metadata for live preview (R-Preview) ─────────────────────────────

const SAMPLE_METADATA = {
	target: "NGC7000",
	filter: "Ha",
	date: "2026-04-12",
	frame_type: "light" as const,
	camera: "ASI2600MM",
	exposure: "300s",
	gain: "100",
	binning: "1x1",
	set_temp: "-10C",
};

// ── Per-type live preview (client-side token substitution) ────────────────────
//
// STUB: The canonical resolver lives in the Rust `patterns` crate
// (`crates/patterns/src/per_type.rs`), but the only Tauri command exposed today
// (`pattern.preview`) accepts the token/separator `PatternPart[]` model, which
// cannot represent the literal path segments (e.g. `flats`, `masters`) that
// per-type destination patterns rely on. Until a path-string preview command is
// exposed, we resolve the preview client-side by substituting `{token}`
// placeholders with representative sample values. Literal segments and `/`
// separators are passed through verbatim. Replace this with the canonical
// resolver once a path-string `pattern.preview` (or equivalent) command exists.

const PER_TYPE_SAMPLE_TOKENS: Record<
	(typeof AVAILABLE_TOKENS)[number],
	string
> = {
	target: "IC1396",
	filter: "Ha",
	date: "2024-10-20",
	frame_type: "light",
	camera: "ASI2600MM",
	exposure: "300s",
	gain: "100",
	binning: "1x1",
	set_temp: "-10C",
};

/**
 * Resolve a per-type destination pattern string into a sample path by replacing
 * each `{token}` with a representative sample value. Unknown tokens are left as
 * a bracketed placeholder so the preview makes the problem visible rather than
 * silently dropping the segment.
 */
function resolvePerTypePreview(pattern: string): string {
	if (pattern.trim() === "") return "";
	return pattern.replace(/\{([^}]*)\}/g, (_match, token: string) => {
		const sample =
			PER_TYPE_SAMPLE_TOKENS[token as (typeof AVAILABLE_TOKENS)[number]];
		return sample ?? `{${token}}`;
	});
}

// ── Default pattern {target}/{filter}/{date}/{frame_type}/ ────────────────────

const DEFAULT_PATTERN: PatternPart[] = [
	{ id: "p0", kind: "token", value: "target" },
	{ id: "p1", kind: "separator", value: "/" },
	{ id: "p2", kind: "token", value: "filter" },
	{ id: "p3", kind: "separator", value: "/" },
	{ id: "p4", kind: "token", value: "date" },
	{ id: "p5", kind: "separator", value: "/" },
	{ id: "p6", kind: "token", value: "frame_type" },
	{ id: "p7", kind: "separator", value: "/" },
];

// ── Stable id generation ──────────────────────────────────────────────────────

let _idCounter = 100;
function nextId(): string {
	return `pp${(_idCounter++).toString()}`;
}

// ── PatternChipsEditor ────────────────────────────────────────────────────────

function PatternChipsEditor({
	pattern,
	onChange,
	errorCode,
	warnings,
}: {
	pattern: PatternPart[];
	onChange: (parts: PatternPart[]) => void;
	errorCode?: string;
	warnings: string[];
}) {
	const [showTokenMenu, setShowTokenMenu] = useState(false);
	const [showSepMenu, setShowSepMenu] = useState(false);

	const handleRemove = (id: string) =>
		onChange(pattern.filter((p) => p.id !== id));

	const handleAddToken = (value: string) => {
		onChange([...pattern, { id: nextId(), kind: "token", value }]);
		setShowTokenMenu(false);
	};

	const handleAddSep = (value: string) => {
		onChange([...pattern, { id: nextId(), kind: "separator", value }]);
		setShowSepMenu(false);
	};

	return (
		<div>
			{/* Chip row */}
			<div className="alm-naming__chip-row">
				{pattern.map((part) => {
					const isSep = part.kind === "separator";
					const label = isSep
						? part.value === " "
							? "⎵"
							: part.value
						: `{${part.value}}`;
					return (
						<span
							key={part.id}
							className={isSep ? "alm-sep-chip" : "alm-token-chip"}
						>
							{label}
							<span
								className="alm-token-chip__x"
								role="button"
								tabIndex={0}
								aria-label={`Remove ${label}`}
								onClick={() => handleRemove(part.id)}
								onKeyDown={(e) => {
									if (e.key === "Enter") handleRemove(part.id);
								}}
							>
								&times;
							</span>
						</span>
					);
				})}

				{/* Add Token menu */}
				<div className="alm-naming__menu-anchor">
					<Btn
						size="sm"
						onClick={() => {
							setShowTokenMenu(!showTokenMenu);
							setShowSepMenu(false);
						}}
					>
						{m.settings_naming_add_token()}
					</Btn>
					{showTokenMenu && (
						<div className="alm-naming__dropdown alm-naming__dropdown--token">
							{AVAILABLE_TOKENS.map((t) => (
								<button
									key={t}
									type="button"
									className="alm-naming__menu-item"
									onClick={() => handleAddToken(t)}
								>
									{`{${t}}`}
								</button>
							))}
						</div>
					)}
				</div>

				{/* Add Separator menu */}
				<div className="alm-naming__menu-anchor">
					<Btn
						size="sm"
						onClick={() => {
							setShowSepMenu(!showSepMenu);
							setShowTokenMenu(false);
						}}
					>
						{m.settings_naming_add_sep()}
					</Btn>
					{showSepMenu && (
						<div className="alm-naming__dropdown alm-naming__dropdown--sep">
							{SEPARATORS.map((s) => (
								<button
									key={s}
									type="button"
									className="alm-naming__menu-item"
									onClick={() => handleAddSep(s)}
								>
									{s === "/"
										? m.settings_naming_sep_path_label()
										: s === " "
											? "⎵"
											: s}
								</button>
							))}
						</div>
					)}
				</div>
			</div>

			{/* Validation feedback */}
			{errorCode && (
				<div className="alm-naming__error" role="alert">
					{errorCode === "pattern.empty" &&
						m.settings_naming_invalid_pattern()}
					{errorCode === "token.unknown" &&
						m.settings_naming_invalid_pattern()}
					{errorCode &&
						!["pattern.empty", "token.unknown"].includes(errorCode) &&
						m.settings_naming_invalid_pattern()}
				</div>
			)}
			{warnings.length > 0 && (
				<div className="alm-naming__warning">
					{warnings.includes("no_path_separator") && (
						<span>
							{m.settings_naming_warn_no_path_sep()}{" "}
						</span>
					)}
					{warnings.includes("consecutive_separators") && (
						<span>{m.settings_naming_consecutive_seps()} </span>
					)}
				</div>
			)}
		</div>
	);
}

// ── PerTypePatternChipsEditor ─────────────────────────────────────────────────
//
// Chip-based editor for a single per-type destination pattern string.
// Supports three chip kinds: 'token' ({name}), 'literal' (bare segment),
// and 'sep' (/). Visually matches PatternChipsEditor but persists as a path
// string rather than PatternPart[].

function PerTypePatternChipsEditor({
	chips,
	onChange,
	error,
	defaultPlaceholder,
	rowId,
}: {
	chips: PathChip[];
	onChange: (chips: PathChip[]) => void;
	error?: string;
	defaultPlaceholder: string;
	rowId: string;
}) {
	const [showTokenMenu, setShowTokenMenu] = useState(false);
	const [literalInput, setLiteralInput] = useState("");
	const [showLiteralInput, setShowLiteralInput] = useState(false);
	const literalInputRef = useRef<HTMLInputElement>(null);

	const handleRemove = (id: string) =>
		onChange(chips.filter((c) => c.id !== id));

	const handleAddToken = (value: string) => {
		onChange([...chips, { id: nextPathId(), kind: "token", value }]);
		setShowTokenMenu(false);
	};

	const handleAddSep = () => {
		onChange([...chips, { id: nextPathId(), kind: "sep", value: "/" }]);
	};

	const handleAddLiteral = () => {
		const trimmed = literalInput.trim();
		if (trimmed === "") return;
		onChange([...chips, { id: nextPathId(), kind: "literal", value: trimmed }]);
		setLiteralInput("");
		setShowLiteralInput(false);
	};

	const handleLiteralKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Enter") {
			e.preventDefault();
			handleAddLiteral();
		}
		if (e.key === "Escape") {
			setShowLiteralInput(false);
			setLiteralInput("");
		}
	};

	// Show placeholder when no chips yet
	const isEmpty = chips.length === 0;

	return (
		<div>
			{/* Chip row */}
			<div className="alm-naming__chip-row">
				{isEmpty && (
					<span className="alm-naming__chip-placeholder">
						{defaultPlaceholder}
					</span>
				)}

				{chips.map((chip) => {
					const label =
						chip.kind === "token"
							? `{${chip.value}}`
							: chip.kind === "sep"
								? "/"
								: chip.value;
					const chipClass =
						chip.kind === "token"
							? "alm-token-chip"
							: chip.kind === "sep"
								? "alm-sep-chip"
								: "alm-literal-chip";
					return (
						<span key={chip.id} className={chipClass}>
							{label}
							<span
								className="alm-token-chip__x"
								role="button"
								tabIndex={0}
								aria-label={`Remove ${label}`}
								onClick={() => handleRemove(chip.id)}
								onKeyDown={(e) => {
									if (e.key === "Enter") handleRemove(chip.id);
								}}
							>
								&times;
							</span>
						</span>
					);
				})}

				{/* Add Token menu */}
				<div className="alm-naming__menu-anchor">
					<Btn
						size="sm"
						onClick={() => {
							setShowTokenMenu(!showTokenMenu);
							setShowLiteralInput(false);
						}}
					>
						{m.settings_naming_add_token()}
					</Btn>
					{showTokenMenu && (
						<div className="alm-naming__dropdown alm-naming__dropdown--token">
							{AVAILABLE_TOKENS.map((t) => (
								<button
									key={t}
									type="button"
									className="alm-naming__menu-item"
									onClick={() => handleAddToken(t)}
								>
									{`{${t}}`}
								</button>
							))}
						</div>
					)}
				</div>

				{/* Add / separator */}
				<Btn size="sm" onClick={handleAddSep}>
					{m.settings_naming_add_path_sep()}
				</Btn>

				{/* Add Literal segment */}
				<div className="alm-naming__menu-anchor">
					<Btn
						size="sm"
						onClick={() => {
							setShowLiteralInput(!showLiteralInput);
							setShowTokenMenu(false);
							if (!showLiteralInput) {
								// focus the input on next tick
								setTimeout(() => literalInputRef.current?.focus(), 0);
							}
						}}
					>
						{m.settings_naming_add_literal()}
					</Btn>
					{showLiteralInput && (
						<div className="alm-naming__dropdown alm-naming__dropdown--literal">
							<input
								ref={literalInputRef}
								type="text"
								className="alm-naming__literal-input"
								value={literalInput}
								placeholder={m.settings_naming_literal_placeholder()}
								spellCheck={false}
								autoCorrect="off"
								autoCapitalize="off"
								aria-label={m.settings_naming_literal_aria()}
								onChange={(e) => setLiteralInput(e.target.value)}
								onKeyDown={handleLiteralKeyDown}
							/>
							<button
								type="button"
								className="alm-naming__literal-add-btn"
								onClick={handleAddLiteral}
							>
								{m.common_add()}
							</button>
						</div>
					)}
				</div>
			</div>

			{/* Validation / error feedback */}
			{error && (
				<div
					id={`${rowId}-error`}
					role="alert"
					className="alm-naming__error"
				>
					{error}
				</div>
			)}
		</div>
	);
}

// ── PerTypeDestinationPatterns (spec 041 T051, FR-026b) ───────────────────────
//
// Self-contained editor for the `patternsByType` naming-scope key. It loads
// and saves directly (rather than via the parent `save` debounce) so it can
// surface the backend `value.invalid` rejection inline — the parent auto-save
// swallows write errors.

// Empty chip array sentinel — used to detect "using default" state.
function chipsAreEmpty(chips: PathChip[]): boolean {
	return chips.length === 0;
}

function emptyChipsByClass(): Record<FrameTypeClass, PathChip[]> {
	const result = {} as Record<FrameTypeClass, PathChip[]>;
	for (const cls of FRAME_TYPE_CLASSES) result[cls] = [];
	return result;
}

function PerTypeDestinationPatterns() {
	// Override map: class → chip list. Empty array = built-in default.
	const [chipsByClass, setChipsByClass] =
		useState<Record<FrameTypeClass, PathChip[]>>(emptyChipsByClass);
	const [backendErrors, setBackendErrors] = useState<
		Partial<Record<FrameTypeClass, string>>
	>({});
	const [loaded, setLoaded] = useState(false);
	const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	// ── Load saved overrides on mount ────────────────────────────────────────
	useEffect(() => {
		getSettings({ scope: "naming" })
			.then((data) => {
				const vals = data.values as Record<string, unknown>;
				const raw = vals.patternsByType;
				if (raw && typeof raw === "object") {
					const next = emptyChipsByClass();
					for (const cls of FRAME_TYPE_CLASSES) {
						const v = (raw as Record<string, unknown>)[cls];
						if (typeof v === "string" && v.trim() !== "") {
							next[cls] = parsePathPattern(v);
						}
					}
					setChipsByClass(next);
				}
			})
			.catch(() => {
				// Use defaults on load failure (e.g. in test/mock environment).
			})
			.finally(() => setLoaded(true));
	}, []);

	// ── Persist the full override map (debounced, captures backend errors) ────
	const persist = useCallback((next: Record<FrameTypeClass, PathChip[]>) => {
		if (saveTimer.current) clearTimeout(saveTimer.current);
		saveTimer.current = setTimeout(() => {
			// Send only non-empty overrides; an empty/absent class means "default".
			const payload: Record<string, string> = {};
			for (const cls of FRAME_TYPE_CLASSES) {
				if (!chipsAreEmpty(next[cls])) {
					payload[cls] = serializePathPattern(next[cls]);
				}
			}
			void updateSettings({
				scope: "naming",
				values: { patternsByType: payload },
			}).then(
				() => {
					// Clear any stale backend errors on a successful save.
					setBackendErrors({});
				},
				(err: unknown) => {
					// Backend rejected at least one pattern (error code value.invalid).
					// We cannot tell which class from a single string; flag all classes
					// that currently fail client-side validation, falling back to a
					// generic banner keyed on the first overridden class.
					const message = typeof err === "string" ? err : "Invalid pattern";
					const errs: Partial<Record<FrameTypeClass, string>> = {};
					let attributed = false;
					for (const cls of FRAME_TYPE_CLASSES) {
						if (!chipsAreEmpty(next[cls])) {
							const patStr = serializePathPattern(next[cls]);
							if (validatePatternString(patStr) !== null) {
								errs[cls] = message;
								attributed = true;
							}
						}
					}
					if (!attributed) {
						const firstOverride = FRAME_TYPE_CLASSES.find(
							(cls) => !chipsAreEmpty(next[cls]),
						);
						if (firstOverride) errs[firstOverride] = message;
					}
					setBackendErrors(errs);
				},
			);
		}, 300);
	}, []);

	const handleChipsChange = (cls: FrameTypeClass, chips: PathChip[]) => {
		const next = { ...chipsByClass, [cls]: chips };
		setChipsByClass(next);
		// Clear this class's backend error optimistically; re-validated on save.
		setBackendErrors((prev) => {
			if (!(cls in prev)) return prev;
			const { [cls]: _removed, ...rest } = prev;
			return rest;
		});
		persist(next);
	};

	const handleReset = (cls: FrameTypeClass) => {
		const next = { ...chipsByClass, [cls]: [] };
		setChipsByClass(next);
		setBackendErrors((prev) => {
			if (!(cls in prev)) return prev;
			const { [cls]: _removed, ...rest } = prev;
			return rest;
		});
		persist(next);
	};

	return (
		<SettingsSection title={m.settings_naming_pertype_title()}>
			{FRAME_TYPE_CLASSES.map((cls) => {
				const chips = chipsByClass[cls];
				const isOverridden = !chipsAreEmpty(chips);
				const patternStr = isOverridden ? serializePathPattern(chips) : "";
				const clientError =
					loaded && isOverridden ? validatePatternString(patternStr) : null;
				const error = backendErrors[cls] ?? clientError ?? undefined;
				const rowId = `naming-pattern-${cls}`;
				// Live preview: resolve the effective pattern (override or
				// built-in default) against representative sample values. Only
				// shown when the pattern is free of validation errors.
				const effectivePattern = isOverridden
					? patternStr
					: FRAME_TYPE_DEFAULT_PATTERNS[cls];
				const previewPath =
					error == null ? resolvePerTypePreview(effectivePattern) : "";
				return (
					<SettingsRow
						key={cls}
						label={<span id={`${rowId}-label`}>{FRAME_TYPE_LABELS[cls]}</span>}
						info="Destination folder pattern for this frame type, applied when confirming inbox items. Empty = use the built-in default (shown as placeholder)."
					>
						{/* Editor and its buttons live on separate lines (spec 043 §4). */}
						<div className="alm-naming__pertype-stack">
							<div
								className="alm-naming__pertype-editor-wrap"
								role="group"
								aria-labelledby={`${rowId}-label`}
								data-testid={rowId}
							>
								<PerTypePatternChipsEditor
									chips={chips}
									onChange={(c) => handleChipsChange(cls, c)}
									error={error}
									defaultPlaceholder={FRAME_TYPE_DEFAULT_PATTERNS[cls]}
									rowId={rowId}
								/>
							</div>

							{/* Working live preview of the resolved sample path. */}
							{previewPath !== "" && (
								<div
									className="alm-naming__pertype-preview"
									data-testid={`${rowId}-preview`}
								>
									<span className="alm-naming__pertype-preview-label">
										{m.settings_naming_preview_label()}
									</span>{" "}
									<code className="alm-mono alm-naming__pertype-preview-code">
										{previewPath}
									</code>
									{!isOverridden && (
										<span className="alm-naming__pertype-preview-default">
											{m.settings_naming_preview_default()}
										</span>
									)}
								</div>
							)}

							{/* Buttons on their own line. */}
							<div className="alm-naming__pertype-actions">
								<Btn
									size="sm"
									disabled={!isOverridden}
									data-testid={`naming-pattern-reset-${cls}`}
									onClick={() => handleReset(cls)}
								>
									{m.common_reset()}
								</Btn>
							</div>
						</div>
					</SettingsRow>
				);
			})}
		</SettingsSection>
	);
}

// ── NamingStructure ───────────────────────────────────────────────────────────

export function NamingStructure({ save }: NamingStructureProps) {
	const [pattern, setPattern] = useState<PatternPart[]>(DEFAULT_PATTERN);
	const [autoApplyPattern, setAutoApplyPattern] = useState(true);
	const [preview, setPreview] = useState<PatternPreviewResponse | null>(null);
	const [previewError, setPreviewError] = useState<string | null>(null);
	const [validateResult, setValidateResult] = useState<{
		valid: boolean;
		warnings: string[];
		errorCode?: string;
	} | null>(null);
	const [loaded, setLoaded] = useState(false);

	// ── Load saved pattern on mount (spec 018 keys: pattern, autoApplyPattern) ─
	useEffect(() => {
		getSettings({ scope: "naming" })
			.then((data) => {
				const vals = data.values as Record<string, unknown>;
				if (Array.isArray(vals.pattern) && vals.pattern.length > 0) {
					setPattern(vals.pattern as PatternPart[]);
				}
				if (typeof vals.autoApplyPattern === "boolean") {
					setAutoApplyPattern(vals.autoApplyPattern);
				}
			})
			.catch(() => {
				// Use defaults on load failure (e.g. in test/mock environment).
			})
			.finally(() => setLoaded(true));
	}, []);

	// ── Live validation (T1.3 / T1.4) ────────────────────────────────────────
	const runValidation = useCallback((parts: PatternPart[]) => {
		patternValidate(parts)
			.then((resp) => {
				setValidateResult({
					valid: resp.valid,
					warnings: resp.warnings,
					errorCode: resp.errorCode,
				});
			})
			.catch(() => {
				// Ignore validation errors in mock/offline environments.
			});
	}, []);

	// ── Live preview (T2.2 / T3.11) ─────────────────────────────────────────
	const runPreview = useCallback((parts: PatternPart[]) => {
		if (parts.length === 0) {
			setPreview(null);
			setPreviewError(null);
			return;
		}
		patternPreview(parts, SAMPLE_METADATA)
			.then((resp) => {
				setPreview(resp);
				setPreviewError(null);
			})
			.catch((err: unknown) => {
				setPreview(null);
				setPreviewError(typeof err === "string" ? err : "Preview unavailable");
			});
	}, []);

	// Run both when pattern changes, after initial load.
	useEffect(() => {
		if (!loaded) return;
		runValidation(pattern);
		runPreview(pattern);
	}, [pattern, loaded, runValidation, runPreview]);

	// ── Handle pattern change ─────────────────────────────────────────────────
	const handlePatternChange = (parts: PatternPart[]) => {
		setPattern(parts);
		// Persist immediately (spec 018 keys — noisy, no audit).
		save("naming", { pattern: parts, autoApplyPattern });
	};

	const handleAutoApplyChange = (checked: boolean) => {
		setAutoApplyPattern(checked);
		save("naming", { pattern, autoApplyPattern: checked });
	};

	const isValid = validateResult?.valid !== false;
	const canSave = isValid && pattern.length > 0;

	return (
		<>
			<SettingsSection title={m.settings_naming_project_title()}>
				<div className="alm-settings__row">
					<div className="alm-settings__row-content">
						<PatternChipsEditor
							pattern={pattern}
							onChange={handlePatternChange}
							errorCode={
								validateResult?.valid === false
									? validateResult.errorCode
									: undefined
							}
							warnings={validateResult?.warnings ?? []}
						/>
					</div>
				</div>
			</SettingsSection>

			<PerTypeDestinationPatterns />

			<div className="alm-settings__group">
				<div className="alm-settings__row">
					<label className="alm-settings__row-label">
						<input
							type="checkbox"
							className="alm-naming__checkbox"
							checked={autoApplyPattern}
							onChange={(e) => handleAutoApplyChange(e.target.checked)}
						/>
						{m.settings_naming_auto_apply()}
					</label>
				</div>
			</div>

			<SettingsSection title={m.settings_naming_live_preview_title()}>
				<div className="alm-naming__preview-sample">
					{m.settings_naming_live_preview_sample()}
				</div>
				{!canSave && (
					<div className="alm-naming__preview-empty">
						{m.settings_naming_invalid_pattern()}
					</div>
				)}
				{previewError && (
					<div className="alm-naming__preview-error">
						{previewError}
					</div>
				)}
				{preview && canSave && (
					<div className="alm-naming__preview-path-row">
						<code className="alm-mono alm-naming__preview-code">
							{preview.missingTokens.length > 0
								? // Render path with fallback segments dimmed.
									preview.resolvedPath
								: preview.resolvedPath}
						</code>
						{preview.missingTokens.length > 0 && (
							<span className="alm-naming__preview-fallback">
								{m.settings_naming_fallback_used({ tokens: preview.missingTokens.join(", ") })}
							</span>
						)}
					</div>
				)}
			</SettingsSection>
		</>
	);
}
