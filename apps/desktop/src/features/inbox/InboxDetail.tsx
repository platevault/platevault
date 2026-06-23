/**
 * InboxDetail — bottom pane for the Inbox classify/confirm workflow.
 *
 * Follows the SessionDetail shape (spec 043 §4 redesign):
 *
 *   HEADER — item path (title, bold) + titleExtra: classification pill +
 *             inline action buttons (left-packed, alm-session-detail2__actions).
 *             "Generate split plan" for mixed folders lives HERE.
 *   BODY   — left-packed .alm-session-detail2 flex row:
 *     col A (PropertyTable) — classification + file-count + FITS metadata
 *     mixed-summary line   — compact "N light · M dark" muted text (mixed only)
 *     "Files (N) ▾" popover trigger — opens a portaled popup containing:
 *       • scrollable per-file metadata table
 *       • FileInspector detail for the clicked row
 *     "Needs review" col  — unclassified-file type-override editing (if any)
 *     FR-032 banner col   — missing-attr gate (if any)
 *
 * No facts/aux props on DetailPanel — body is fully self-contained.
 * No breakdown-filter interaction — the breakdown table is gone from the detail.
 */

import { Popover } from "@base-ui-components/react/popover";
import { useState } from "react";
import type { InboxFileMetadata, InboxItemSummary } from "@/api/commands";
import type { PropertyDef } from "@/components";
import { DetailPanel, PropertyTable } from "@/components";
import { errMessage } from "@/lib/errors";
import type { PillVariant } from "@/ui";
import { Banner, Btn, Pill, Section, Table } from "@/ui";
import type { InboxClassifyResponse } from "./store";
import { useInboxReclassify } from "./store";

// ── Helpers ───────────────────────────────────────────────────────────────────

function classificationVariant(type: string): PillVariant {
	switch (type) {
		case "single_type":
			return "info";
		case "mixed":
			return "warn";
		case "unclassified":
			return "neutral";
		default:
			return "neutral";
	}
}

const FRAME_TYPE_OPTIONS = [
	"light",
	"dark",
	"bias",
	"flat",
	"dark_flat",
] as const;

/** Last path segment of a relative file path (forward- or back-slash separated). */
function basename(path: string): string {
	const parts = path.replace(/\\/g, "/").split("/");
	return parts[parts.length - 1] || path;
}

/** Format a nullable value as a muted dash. */
function fmtOrDash(value: string | number | null | undefined): React.ReactNode {
	if (value === null || value === undefined || value === "") {
		return <span className="alm-inbox-detail__dash">—</span>;
	}
	return String(value);
}

/** Format binning as "XxY" or dash. */
function fmtBinning(
	x: number | null | undefined,
	y: number | null | undefined,
): React.ReactNode {
	if (x == null && y == null)
		return <span className="alm-inbox-detail__dash">—</span>;
	return `${x != null ? x : "?"}x${y != null ? y : "?"}`;
}

/** Format exposure in seconds. */
function fmtExposure(s: number | null | undefined): React.ReactNode {
	if (s == null) return <span className="alm-inbox-detail__dash">—</span>;
	return `${s} s`;
}

/** Format temperature in °C. */
function fmtTemp(c: number | null | undefined): React.ReactNode {
	if (c == null) return <span className="alm-inbox-detail__dash">—</span>;
	return `${c} °C`;
}

/** Format pixel dimensions as "WxH" or dash. */
function fmtDimensions(
	w: number | null | undefined,
	h: number | null | undefined,
): React.ReactNode {
	if (w == null && h == null)
		return <span className="alm-inbox-detail__dash">—</span>;
	return `${w ?? "?"}×${h ?? "?"}`;
}

/**
 * Build a plain-language composition summary for a mixed classification.
 * Example: "12 light · 4 dark · 1 bias"
 */
function buildMixedSummary(
	breakdown: InboxClassifyResponse["breakdown"],
): string {
	if (!breakdown || breakdown.length === 0) return "";
	return breakdown.map((e) => `${e.count} ${e.kind}`).join(" · ");
}

// ── FileInspector ─────────────────────────────────────────────────────────────

/**
 * Compact inspector for per-file fields NOT already shown in the metadata table:
 *   instrume, telescop, naxis1×naxis2, stackCount, imageTyp.
 *
 * Rendered inside the Files popover when a row is clicked.
 */
function FileInspector({ file }: { file: InboxFileMetadata | null }) {
	if (!file) {
		return (
			<div
				className="alm-inbox-inspector alm-inbox-inspector--empty"
				data-testid="file-inspector"
			/>
		);
	}

	const rows: Array<{ label: string; value: React.ReactNode; testid: string }> =
		[
			{
				label: "Instrument",
				value: fmtOrDash(file.instrume),
				testid: "inspector-instrume",
			},
			{
				label: "Telescope",
				value: fmtOrDash(file.telescop),
				testid: "inspector-telescop",
			},
			{
				label: "Dimensions",
				value: fmtDimensions(file.naxis1, file.naxis2),
				testid: "inspector-dims",
			},
			{
				label: "Stack count",
				value: fmtOrDash(file.stackCount),
				testid: "inspector-stackcount",
			},
			{
				label: "Raw IMAGETYP",
				value: fmtOrDash(file.imageTyp),
				testid: "inspector-imagetyp",
			},
		];

	return (
		<div className="alm-inbox-inspector" data-testid="file-inspector">
			<div className="alm-inbox-inspector__name" title={file.relativeFilePath}>
				{basename(file.relativeFilePath)}
			</div>
			<dl className="alm-inbox-inspector__dl">
				{rows.map((r) => (
					<div
						key={r.label}
						className="alm-inbox-inspector__row"
						data-testid={r.testid}
					>
						<dt className="alm-inbox-inspector__label">{r.label}</dt>
						<dd className="alm-inbox-inspector__value">{r.value}</dd>
					</div>
				))}
			</dl>
		</div>
	);
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface InboxDetailProps {
	item: InboxItemSummary;
	rootAbsolutePath: string;
	classification: InboxClassifyResponse | null;
	/**
	 * Per-file metadata from `inbox.item.metadata` (FR-010).
	 * Optional — rendered when provided and non-empty.
	 */
	fileMetadata?: InboxFileMetadata[];
	/**
	 * Primary confirm action for this detection — runs the confirm/split flow.
	 * For a mixed folder the page labels this "Generate split plan"; otherwise
	 * "Confirm to inventory". Rendered inline-left in the detail header (the
	 * canonical Sessions placement). Omit to hide the button.
	 */
	onConfirm?: () => void;
	/** Header confirm label, e.g. "Confirm to inventory" / "Generate split plan". */
	confirmLabel?: string;
	/** Disable the confirm action (gated: unclassified / missing attrs / open plan). */
	confirmDisabled?: boolean;
	/** True while a confirm/split is in flight — shows "Working…" + disables. */
	confirmBusy?: boolean;
	/**
	 * Candidate destination library roots (non-inbox). When more than one
	 * exists, a "Source" picker is shown next to Confirm so the user chooses
	 * WHERE files are placed instead of relying on auto-selection.
	 */
	destinationRoots?: Array<{ id: string; path: string; category: string }>;
	/** Currently chosen destination root id; "" / null means auto-select. */
	selectedRootId?: string | null;
	/** Called when the user picks a destination root ("" = auto). */
	onSelectRoot?: (rootId: string) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function InboxDetail({
	item,
	classification,
	fileMetadata,
	onConfirm,
	confirmLabel = "Confirm to inventory",
	confirmDisabled = false,
	confirmBusy = false,
	destinationRoots,
	selectedRootId,
	onSelectRoot,
}: InboxDetailProps) {
	const { reclassify, loading: reclassifyLoading } = useInboxReclassify(
		item.inboxItemId,
	);

	// Per-file overrides pending submission (single-file flow).
	const [pendingOverrides, setPendingOverrides] = useState<
		Record<string, string>
	>({});
	const [applyError, setApplyError] = useState<string | null>(null);

	// T027: multi-select + bulk override state.
	const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
	const [bulkFrameType, setBulkFrameType] = useState("");
	const [bulkFilter, setBulkFilter] = useState("");
	const [bulkExposureS, setBulkExposureS] = useState("");
	const [bulkBinning, setBulkBinning] = useState("");
	const [bulkError, setBulkError] = useState<string | null>(null);

	// Files popover: which row is "inspected" inside the popover.
	const [inspectedIdx, setInspectedIdx] = useState<number | null>(null);

	const handleOverrideChange = (filePath: string, frameType: string) => {
		setPendingOverrides((prev) => ({ ...prev, [filePath]: frameType }));
	};

	const handleApplyOverrides = async () => {
		const overrides = Object.entries(pendingOverrides).map(
			([filePath, frameType]) => ({
				filePath,
				frameType,
			}),
		);
		if (overrides.length === 0) return;
		setApplyError(null);
		try {
			await reclassify(overrides);
			setPendingOverrides({});
		} catch (err) {
			setApplyError(errMessage(err));
		}
	};

	// T027 selection helpers.
	const unclassifiedFiles = classification?.unclassifiedFiles ?? [];

	const handleToggleFile = (filePath: string) => {
		setSelectedFiles((prev) => {
			const next = new Set(prev);
			if (next.has(filePath)) next.delete(filePath);
			else next.add(filePath);
			return next;
		});
	};

	const handleSelectAll = () => {
		if (selectedFiles.size === unclassifiedFiles.length)
			setSelectedFiles(new Set());
		else setSelectedFiles(new Set(unclassifiedFiles));
	};

	const handleBulkApply = async () => {
		if (selectedFiles.size === 0) return;
		const overrides = Array.from(selectedFiles).map((filePath) => {
			const override: {
				filePath: string;
				frameType?: string | null;
				filter?: string | null;
				exposureS?: number | null;
				binning?: string | null;
			} = { filePath };
			if (bulkFrameType !== "") override.frameType = bulkFrameType;
			if (bulkFilter !== "") override.filter = bulkFilter;
			if (bulkExposureS !== "") {
				const n = parseFloat(bulkExposureS);
				if (!Number.isNaN(n)) override.exposureS = n;
			}
			if (bulkBinning !== "") override.binning = bulkBinning;
			return override;
		});
		setBulkError(null);
		try {
			await reclassify(overrides);
			setSelectedFiles(new Set());
			setBulkFrameType("");
			setBulkFilter("");
			setBulkExposureS("");
			setBulkBinning("");
		} catch (err) {
			setBulkError(err instanceof Error ? err.message : String(err));
		}
	};

	const title = item.relativePath || "(root)";
	const classType = classification?.type ?? "pending";

	// ── Unclassified ("Needs review") table ───────────────────────────────────

	const allSelected =
		unclassifiedFiles.length > 0 &&
		selectedFiles.size === unclassifiedFiles.length;
	const someSelected = selectedFiles.size > 0 && !allSelected;

	const unclassifiedColumns = [
		{ key: "select", label: "", style: { width: 36 } },
		{ key: "file", label: "File", style: { width: 160 } },
		{ key: "override", label: "Assign frame type" },
	];

	const unclassifiedRows = unclassifiedFiles.map((filePath, idx) => ({
		select: (
			<input
				type="checkbox"
				checked={selectedFiles.has(filePath)}
				onChange={() => handleToggleFile(filePath)}
				aria-label={`Select ${filePath}`}
				data-testid={`reclassify-select-${idx}`}
			/>
		),
		file: (
			<span title={filePath} className="alm-inbox-detail__file-cell">
				{filePath}
			</span>
		),
		override: (
			<select
				value={pendingOverrides[filePath] ?? ""}
				onChange={(e) => handleOverrideChange(filePath, e.target.value)}
				aria-label={`Override frame type for ${filePath}`}
				data-testid={`override-select-${filePath}`}
				className="alm-select alm-select--sm"
			>
				<option value="">— pick type —</option>
				{FRAME_TYPE_OPTIONS.map((t) => (
					<option key={t} value={t}>
						{t}
					</option>
				))}
			</select>
		),
	}));

	// ── Per-file metadata table (FR-010) ──────────────────────────────────────

	const metadataColumns = [
		{ key: "file", label: "File", style: { minWidth: 160 } },
		{ key: "type", label: "Type", style: { width: 80 } },
		{ key: "filter", label: "Filter", style: { width: 70 } },
		{ key: "exposure", label: "Exposure", style: { width: 80 } },
		{ key: "binning", label: "Binning", style: { width: 70 } },
		{ key: "gain", label: "Gain", style: { width: 60 } },
		{ key: "temp", label: "Temp", style: { width: 70 } },
		{ key: "object", label: "Object", style: { width: 100 } },
		{ key: "date", label: "Date", style: { width: 110 } },
	];

	// FR-032 (US9): files missing a path-load-bearing attribute.
	const filesMissingAttrs = (fileMetadata ?? []).filter(
		(f) => (f.missingPathAttributes?.length ?? 0) > 0,
	);

	const metadataRows = (fileMetadata ?? []).map((f, rowIdx) => {
		const missingAttrs = f.missingPathAttributes ?? [];
		const fileName = basename(f.relativeFilePath);
		const needsAttention = f.overrideStale || missingAttrs.length > 0;
		const isInspected = inspectedIdx === rowIdx;
		return {
			file: (
				<span
					title={f.relativeFilePath}
					className="alm-inbox-detail__file-cell"
				>
					{f.relativeFilePath}
					{missingAttrs.length > 0 && (
						<span
							data-testid={`inbox-missing-attr-${fileName}`}
							title={`Missing required attribute(s): ${missingAttrs.join(", ")}`}
							className="alm-inbox-detail__missing-attr-badge"
						>
							needs {missingAttrs.join(", ")}
						</span>
					)}
				</span>
			),
			type: fmtOrDash(f.frameTypeEffective),
			filter: fmtOrDash(f.filter),
			exposure: fmtExposure(f.exposureS),
			binning: fmtBinning(f.binningX, f.binningY),
			gain: fmtOrDash(f.gain),
			temp: fmtTemp(f.temperatureC),
			object: fmtOrDash(f.object),
			date: fmtOrDash(f.dateObs),
			_rowClassName: [
				needsAttention ? "alm-inbox-meta-row--warn" : "",
				isInspected ? "alm-inbox-meta-row--inspected" : "",
				"alm-inbox-meta-row",
			]
				.filter(Boolean)
				.join(" "),
			_onClick: () => setInspectedIdx(isInspected ? null : rowIdx),
		};
	});

	// ── Mixed composition summary (FR-011) ────────────────────────────────────

	const mixedSummary =
		classType === "mixed" && classification?.breakdown
			? buildMixedSummary(classification.breakdown)
			: null;

	// ── Detection property table (col A) ─────────────────────────────────────
	// Representative file for FITS metadata display (best-effort).

	const repFile = fileMetadata?.[0] ?? null;

	const detectionProps: PropertyDef[] = [
		{
			key: "classification",
			label: "Classification",
			value:
				classType === "single_type"
					? (classification?.frameType ?? "single_type")
					: classType,
		},
		{
			key: "files",
			label: "Files",
			value: classification
				? String(
						classification.breakdown?.reduce((s, e) => s + e.count, 0) ||
							item.fileCount,
					)
				: String(item.fileCount),
		},
		...(repFile?.object != null
			? [
					{
						key: "target",
						label: "Target",
						value: repFile.object,
						source: "fits",
					} as PropertyDef,
				]
			: []),
		...(repFile?.filter != null
			? [
					{
						key: "filter",
						label: "Filter",
						value: repFile.filter,
						source: "fits",
					} as PropertyDef,
				]
			: []),
		...(repFile?.exposureS != null
			? [
					{
						key: "exposure",
						label: "Exposure",
						value: fmtExposure(repFile.exposureS),
						source: "fits",
					} as PropertyDef,
				]
			: []),
		...(repFile?.binningX != null || repFile?.binningY != null
			? [
					{
						key: "binning",
						label: "Binning",
						value: fmtBinning(repFile?.binningX, repFile?.binningY),
						source: "fits",
					} as PropertyDef,
				]
			: []),
		...(repFile?.gain != null
			? [
					{
						key: "gain",
						label: "Gain",
						value: repFile.gain,
						source: "fits",
					} as PropertyDef,
				]
			: []),
		...(repFile?.temperatureC != null
			? [
					{
						key: "temp",
						label: "Sensor temp",
						value: fmtTemp(repFile.temperatureC),
						source: "fits",
					} as PropertyDef,
				]
			: []),
		...(repFile?.instrume != null
			? [
					{
						key: "instrume",
						label: "Instrument",
						value: repFile.instrume,
						source: "fits",
					} as PropertyDef,
				]
			: []),
		...(repFile != null && (repFile.naxis1 != null || repFile.naxis2 != null)
			? [
					{
						key: "dims",
						label: "Dimensions",
						value: fmtDimensions(repFile.naxis1, repFile.naxis2),
						source: "fits",
					} as PropertyDef,
				]
			: []),
		...(repFile?.dateObs != null
			? [
					{
						key: "date",
						label: "Night",
						value: repFile.dateObs,
						source: "fits",
					} as PropertyDef,
				]
			: []),
	];

	// Spread the detection facts across two left-packed columns (the canonical
	// SessionDetail shape) so the bottom panel reads as multi-column, not one
	// cramped stack.
	const detMid = Math.ceil(detectionProps.length / 2);
	const detColA = detectionProps.slice(0, detMid);
	const detColB = detectionProps.slice(detMid);

	// ── Inline header actions ─────────────────────────────────────────────────

	const titleActions = (
		<span className="alm-session-detail2__actions">
			<Pill variant={classificationVariant(classType)}>
				{classType === "single_type"
					? (classification?.frameType ?? "single")
					: classType}
			</Pill>
			{item.lane === "video" && <Pill variant="ghost">video</Pill>}
			{onConfirm &&
				destinationRoots &&
				destinationRoots.length > 1 && (
					<label className="alm-inbox-detail__dest-root">
						<span className="alm-inbox-detail__dest-root-label">Source</span>
						<select
							className="alm-select alm-select--sm"
							value={selectedRootId ?? ""}
							onChange={(e) => onSelectRoot?.(e.target.value)}
							aria-label="Destination library source"
							data-testid="inbox-dest-root-select"
						>
							<option value="">Auto</option>
							{destinationRoots.map((r) => (
								<option key={r.id} value={r.id}>
									{basename(r.path)} · {r.category}
								</option>
							))}
						</select>
					</label>
				)}
			{onConfirm && (
				<Btn
					size="sm"
					variant="primary"
					onClick={onConfirm}
					disabled={confirmDisabled || confirmBusy}
					aria-label={confirmLabel}
					data-testid="inbox-confirm-btn"
					data-guide-anchor="inbox.confirm-row"
				>
					{confirmBusy ? "Working…" : confirmLabel}
				</Btn>
			)}
		</span>
	);

	// ── Render ────────────────────────────────────────────────────────────────

	const hasMetadata = metadataRows.length > 0;

	return (
		<DetailPanel
			variant="inbox"
			title={<strong>{title}</strong>}
			titleExtra={titleActions}
		>
			{/* Mixed: advisory banner */}
			{classType === "mixed" && (
				<Banner
					variant="warn"
					className="alm-inbox-detail__banner-mt3 alm-inbox-alert"
					data-testid="inbox-mixed-alert"
				>
					<div className="alm-inbox-alert__msg">
						<span className="alm-inbox-alert__title">Mixed folder</span>
						<span className="alm-inbox-alert__body">
							Multiple frame types detected. Confirm to produce a reviewable
							split plan.
						</span>
					</div>
				</Banner>
			)}

			{/* Unclassified: blocking banner */}
			{classType === "unclassified" && (
				<Banner
					variant="danger"
					className="alm-inbox-detail__banner-mt3 alm-inbox-alert"
					data-testid="inbox-unclassified-alert"
				>
					<div className="alm-inbox-alert__msg">
						<span className="alm-inbox-alert__title">Frame types required</span>
						<span className="alm-inbox-alert__body">
							No IMAGETYP headers could be read. Assign frame types below, then
							confirm.
						</span>
					</div>
				</Banner>
			)}

			{!classification && (
				<div className="alm-inbox-detail__empty">
					Select an item to see the classification breakdown.
				</div>
			)}

			{/* Left-packed .alm-session-detail2 row */}
			<div className="alm-session-detail2">
				{/* Col A: detection facts (first half) */}
				<div className="alm-session-detail2__col">
					<PropertyTable mode="view" showSource properties={detColA} />
				</div>

				{/* Col B: detection facts (second half) — only when there are enough */}
				{detColB.length > 0 && (
					<div className="alm-session-detail2__col">
						<PropertyTable mode="view" showSource properties={detColB} />
					</div>
				)}

				{/* Col C: Files — mixed-composition summary + the metadata popover */}
				<div className="alm-session-detail2__col">
					<div className="alm-session-detail2__head">Files</div>

					{/* FR-011: compact mixed-composition summary */}
					{mixedSummary && (
						<section
							aria-label="Mixed composition summary"
							className="alm-inbox-detail__mixed-summary"
						>
							{mixedSummary}
						</section>
					)}

					{/* Files popover — trigger + portaled popup with metadata table + inspector */}
					{hasMetadata ? (
						<Popover.Root
							onOpenChange={() => {
								// Reset inspector selection whenever the popover is closed.
								setInspectedIdx(null);
							}}
						>
							<Popover.Trigger
								className="alm-inbox-detail__files-trigger"
								aria-label={`File metadata (${metadataRows.length})`}
								data-testid="inbox-files-popover-trigger"
							>
								File metadata ({metadataRows.length}) ▾
							</Popover.Trigger>
							<Popover.Portal>
								<Popover.Positioner side="bottom" align="start" sideOffset={4}>
									<Popover.Popup
										className="alm-inbox-detail__files-popup"
										data-testid="inbox-files-popup"
										aria-label="File metadata"
									>
										{/* Scrollable metadata table */}
										<div className="alm-inbox-detail__files-popup-table">
											<Table columns={metadataColumns} rows={metadataRows} />
										</div>
										{/* Inspector — updates on row click */}
										{inspectedIdx != null && (
											<div className="alm-inbox-detail__files-popup-inspector">
												<FileInspector
													file={fileMetadata?.[inspectedIdx] ?? null}
												/>
											</div>
										)}
									</Popover.Popup>
								</Popover.Positioner>
							</Popover.Portal>
						</Popover.Root>
					) : (
						!mixedSummary && (
							<span className="alm-session-detail2__muted">
								No file metadata
							</span>
						)
					)}
				</div>

				{/* Needs review — rendered when unclassified files exist */}
				{unclassifiedRows.length > 0 && (
					<div className="alm-session-detail2__col">
						<Section title={`Needs review (${unclassifiedRows.length})`}>
							<div className="alm-inbox-detail__select-all-row">
								<input
									type="checkbox"
									checked={allSelected}
									ref={(el) => {
										if (el) el.indeterminate = someSelected;
									}}
									onChange={handleSelectAll}
									aria-label="Select all unclassified files"
									data-testid="reclassify-select-all"
								/>
								<span className="alm-inbox-detail__select-all-label">
									{selectedFiles.size === 0
										? "Select all"
										: `${selectedFiles.size} selected`}
								</span>
							</div>
							<Table columns={unclassifiedColumns} rows={unclassifiedRows} />

							{selectedFiles.size > 0 && (
								<fieldset className="alm-inbox-detail__bulk-controls">
									<legend className="alm-visually-hidden">
										Bulk override controls
									</legend>
									<div className="alm-inbox-detail__bulk-field">
										<label
											htmlFor="bulk-frame-type"
											className="alm-inbox-detail__bulk-label"
										>
											Frame type
										</label>
										<select
											id="bulk-frame-type"
											value={bulkFrameType}
											onChange={(e) => setBulkFrameType(e.target.value)}
											aria-label="Bulk frame type"
											data-testid="bulk-frame-type"
											className="alm-select alm-select--sm"
										>
											<option value="">— unchanged —</option>
											{FRAME_TYPE_OPTIONS.map((t) => (
												<option key={t} value={t}>
													{t}
												</option>
											))}
										</select>
									</div>

									<div className="alm-inbox-detail__bulk-field">
										<label
											htmlFor="bulk-filter"
											className="alm-inbox-detail__bulk-label"
										>
											Filter
										</label>
										<input
											id="bulk-filter"
											type="text"
											value={bulkFilter}
											onChange={(e) => setBulkFilter(e.target.value)}
											placeholder="e.g. Ha"
											aria-label="Bulk filter"
											data-testid="bulk-filter"
											className="alm-input alm-input--sm alm-inbox-detail__bulk-input-w80"
										/>
									</div>

									<div className="alm-inbox-detail__bulk-field">
										<label
											htmlFor="bulk-exposure"
											className="alm-inbox-detail__bulk-label"
										>
											Exposure (s)
										</label>
										<input
											id="bulk-exposure"
											type="number"
											value={bulkExposureS}
											onChange={(e) => setBulkExposureS(e.target.value)}
											placeholder="e.g. 300"
											aria-label="Bulk exposure seconds"
											data-testid="bulk-exposure-s"
											className="alm-input alm-input--sm alm-inbox-detail__bulk-input-w80"
											min={0}
										/>
									</div>

									<div className="alm-inbox-detail__bulk-field">
										<label
											htmlFor="bulk-binning"
											className="alm-inbox-detail__bulk-label"
										>
											Binning
										</label>
										<input
											id="bulk-binning"
											type="text"
											value={bulkBinning}
											onChange={(e) => setBulkBinning(e.target.value)}
											placeholder="e.g. 2x2"
											aria-label="Bulk binning"
											data-testid="bulk-binning"
											className="alm-input alm-input--sm alm-inbox-detail__bulk-input-w80"
										/>
									</div>

									<button
										type="button"
										className="alm-btn alm-btn--sm alm-btn--accent"
										onClick={handleBulkApply}
										disabled={reclassifyLoading}
										aria-label={`Apply bulk override to ${selectedFiles.size} file${selectedFiles.size !== 1 ? "s" : ""}`}
										data-testid="bulk-apply-btn"
									>
										{reclassifyLoading
											? "Applying…"
											: `Apply to selected (${selectedFiles.size})`}
									</button>
								</fieldset>
							)}

							{bulkError && (
								<Banner
									variant="danger"
									className="alm-inbox-detail__banner-mt2"
								>
									{bulkError}
								</Banner>
							)}

							{Object.keys(pendingOverrides).length > 0 && (
								<div className="alm-inbox-detail__apply-row">
									<button
										type="button"
										className="alm-btn alm-btn--sm alm-btn--accent"
										onClick={handleApplyOverrides}
										disabled={
											Object.keys(pendingOverrides).length === 0 ||
											reclassifyLoading
										}
										aria-label="Apply manual overrides"
									>
										{reclassifyLoading
											? "Applying…"
											: `Apply ${Object.keys(pendingOverrides).length} override${Object.keys(pendingOverrides).length !== 1 ? "s" : ""}`}
									</button>
								</div>
							)}

							{applyError && (
								<Banner
									variant="danger"
									className="alm-inbox-detail__banner-mt2"
								>
									{applyError}
								</Banner>
							)}
						</Section>
					</div>
				)}

				{/* FR-032 (US9): blocking banner for missing path attributes */}
				{filesMissingAttrs.length > 0 && (
					<div className="alm-session-detail2__col">
						<Banner
							variant="danger"
							className="alm-inbox-detail__banner-mt3 alm-inbox-alert"
							data-testid="inbox-missing-attr-banner"
						>
							<div className="alm-inbox-alert__msg">
								<span className="alm-inbox-alert__title">
									Required metadata missing
								</span>
								<span className="alm-inbox-alert__body">
									{filesMissingAttrs.length} file
									{filesMissingAttrs.length !== 1 ? "s" : ""} missing required
									attribute(s) for their destination — confirm disabled. Assign
									the missing value(s) in "Needs review" above, then confirm.
								</span>
							</div>
						</Banner>
					</div>
				)}
			</div>
		</DetailPanel>
	);
}
