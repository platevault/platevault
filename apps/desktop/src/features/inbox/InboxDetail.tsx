/**
 * InboxDetail — bottom pane for the Inbox classify/confirm workflow.
 *
 * Follows the SessionDetail shape (spec 043 §4 redesign):
 *
 *   HEADER — item path (title, bold) + titleExtra: classification pill +
 *             inline action buttons (left-packed, alm-session-detail2__actions).
 *             Confirm lives HERE; disabled for "mixed" rows (spec 041 FR-050 —
 *             the backend "split" action is removed, T071/T072).
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
import type { InboxFileMetadata_Serialize as InboxFileMetadata, InboxItemSummary } from "@/bindings/index";
import type { PropertyDef } from "@/components";
import { DetailPanel, PropertyTable } from "@/components";
import { errMessage } from "@/lib/errors";
import { m } from "@/lib/i18n";
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

/**
 * Applicable destination-root category for a frame type (point 1: only show
 * libraries that can actually receive this image type). Light frames go to a
 * "raw" root; calibration frames (bias/dark/flat) + their masters go to a
 * "calibration" root. Returns null when we can't narrow (e.g. mixed) — then all
 * roots are shown. NOTE: this is a pragmatic frontend mapping; the spec-045
 * iterate (single-type sub-items) will make this authoritative per item.
 */
function applicableRootCategory(frameType?: string | null): string | null {
	if (!frameType) return null;
	const ft = frameType.toLowerCase();
	if (ft.includes("light")) return "raw";
	if (ft.includes("bias") || ft.includes("dark") || ft.includes("flat"))
		return "calibration";
	return null;
}

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
				label: m.inbox_field_instrument(),
				value: fmtOrDash(file.instrume),
				testid: "inspector-instrume",
			},
			{
				label: m.inbox_field_telescope(),
				value: fmtOrDash(file.telescop),
				testid: "inspector-telescop",
			},
			{
				label: m.inbox_field_dimensions(),
				value: fmtDimensions(file.naxis1, file.naxis2),
				testid: "inspector-dims",
			},
			{
				label: m.inbox_field_stack_count(),
				value: fmtOrDash(file.stackCount),
				testid: "inspector-stackcount",
			},
			{
				label: m.inbox_field_raw_imagetyp(),
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

	const title = item.relativePath || m.inbox_list_root_label();
	const classType = classification?.type ?? "pending";

	// Library picker (point 1): narrow the destination roots to the category that
	// can receive this item's frame type. Only meaningful for a single-type item
	// (or a master); mixed/unknown → show all roots. The picker is shown only when
	// MORE THAN ONE applicable root exists (otherwise there's nothing to choose).
	const itemFrameType =
		classType === "single_type"
			? (classification?.frameType ?? null)
			: item.isMaster
				? (item.masterFrameType ?? null)
				: null;
	const applicableCategory = applicableRootCategory(itemFrameType);
	const applicableRoots =
		applicableCategory && destinationRoots
			? destinationRoots.filter((r) => r.category === applicableCategory)
			: (destinationRoots ?? []);

	// ── Unclassified ("Needs review") table ───────────────────────────────────

	const allSelected =
		unclassifiedFiles.length > 0 &&
		selectedFiles.size === unclassifiedFiles.length;
	const someSelected = selectedFiles.size > 0 && !allSelected;

	const unclassifiedColumns = [
		{ key: "select", label: "", style: { width: 36 } },
		{ key: "file", label: m.inbox_col_file(), style: { width: 160 } },
		{ key: "override", label: m.inbox_col_assign_frame_type() },
	];

	const unclassifiedRows = unclassifiedFiles.map((filePath, idx) => ({
		select: (
			<input
				type="checkbox"
				checked={selectedFiles.has(filePath)}
				onChange={() => handleToggleFile(filePath)}
				aria-label={m.inbox_select_file_aria({ file: filePath })}
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
				aria-label={m.inbox_override_frame_type_aria({ file: filePath })}
				data-testid={`override-select-${filePath}`}
				className="alm-select alm-select--sm"
			>
				<option value="">{m.inbox_pick_type_placeholder()}</option>
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
		{ key: "file", label: m.inbox_col_file(), style: { minWidth: 160 } },
		{ key: "type", label: m.inbox_col_type(), style: { width: 80 } },
		{ key: "filter", label: m.common_filter(), style: { width: 70 } },
		{ key: "exposure", label: m.inbox_col_exposure(), style: { width: 80 } },
		{ key: "binning", label: m.inbox_col_binning(), style: { width: 70 } },
		{ key: "gain", label: m.inbox_col_gain(), style: { width: 60 } },
		{ key: "temp", label: m.inbox_col_temp(), style: { width: 70 } },
		{ key: "object", label: m.inbox_col_object(), style: { width: 100 } },
		{ key: "date", label: m.archive_prop_date(), style: { width: 110 } },
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
							title={m.inbox_missing_attrs_title({ attrs: missingAttrs.join(", ") })}
							className="alm-inbox-detail__missing-attr-badge"
						>
							{m.inbox_needs_attrs({ attrs: missingAttrs.join(", ") })}
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
			label: m.inbox_prop_classification(),
			value:
				classType === "single_type"
					? (classification?.frameType ?? "single_type")
					: classType,
		},
		{
			key: "files",
			label: m.inbox_col_files(),
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
						label: m.inbox_dim_target(),
						value: repFile.object,
						source: "fits",
					} as PropertyDef,
				]
			: []),
		...(repFile?.filter != null
			? [
					{
						key: "filter",
						label: m.common_filter(),
						value: repFile.filter,
						source: "fits",
					} as PropertyDef,
				]
			: []),
		...(repFile?.exposureS != null
			? [
					{
						key: "exposure",
						label: m.inbox_col_exposure(),
						value: fmtExposure(repFile.exposureS),
						source: "fits",
					} as PropertyDef,
				]
			: []),
		...(repFile?.binningX != null || repFile?.binningY != null
			? [
					{
						key: "binning",
						label: m.settings_calmatch_binning(),
						value: fmtBinning(repFile?.binningX, repFile?.binningY),
						source: "fits",
					} as PropertyDef,
				]
			: []),
		...(repFile?.gain != null
			? [
					{
						key: "gain",
						label: m.inbox_col_gain(),
						value: repFile.gain,
						source: "fits",
					} as PropertyDef,
				]
			: []),
		...(repFile?.temperatureC != null
			? [
					{
						key: "temp",
						label: m.settings_calmatch_sensor_temp(),
						value: fmtTemp(repFile.temperatureC),
						source: "fits",
					} as PropertyDef,
				]
			: []),
		...(repFile?.instrume != null
			? [
					{
						key: "instrume",
						label: m.inbox_field_instrument(),
						value: repFile.instrume,
						source: "fits",
					} as PropertyDef,
				]
			: []),
		...(repFile != null && (repFile.naxis1 != null || repFile.naxis2 != null)
			? [
					{
						key: "dims",
						label: m.inbox_field_dimensions(),
						value: fmtDimensions(repFile.naxis1, repFile.naxis2),
						source: "fits",
					} as PropertyDef,
				]
			: []),
		...(repFile?.dateObs != null
			? [
					{
						key: "date",
						label: m.sessions_col_night(),
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
					? (classification?.frameType ?? m.inbox_detail_single_fallback())
					: classType}
			</Pill>
			{item.lane === "video" && <Pill variant="ghost">{m.inbox_lane_video()}</Pill>}
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
					{confirmBusy ? m.common_working() : confirmLabel}
				</Btn>
			)}
			{/* Destination library picker — to the RIGHT of Confirm. Lets the user
			    choose which library the files are placed in (Auto = backend pick). */}
			{onConfirm && applicableRoots.length > 1 && (
				<label className="alm-inbox-detail__dest-root">
					<span className="alm-inbox-detail__dest-root-label">{m.inbox_dest_root_label()}</span>
					<select
						className="alm-select alm-select--sm"
						value={selectedRootId ?? ""}
						onChange={(e) => onSelectRoot?.(e.target.value)}
						aria-label={m.inbox_dest_root_aria()}
						data-testid="inbox-dest-root-select"
					>
						<option value="">{m.projects_edit_channels_auto_tag()}</option>
						{applicableRoots.map((r) => (
							<option key={r.id} value={r.id}>
								{basename(r.path)} · {r.category}
							</option>
						))}
					</select>
				</label>
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
						<span className="alm-inbox-alert__title">{m.inbox_mixed_folder_title()}</span>
						<span className="alm-inbox-alert__body">
							{m.inbox_mixed_folder_body()}
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
						<span className="alm-inbox-alert__title">{m.inbox_frame_types_required_title()}</span>
						<span className="alm-inbox-alert__body">
							{m.inbox_frame_types_required_body()}
						</span>
					</div>
				</Banner>
			)}

			{!classification && (
				<div className="alm-inbox-detail__empty">
					{m.inbox_select_item_prompt()}
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
					<div className="alm-session-detail2__head">{m.inbox_col_files()}</div>

					{/* FR-011: compact mixed-composition summary */}
					{mixedSummary && (
						<section
							aria-label={m.inbox_mixed_composition_summary_aria()}
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
								aria-label={m.inbox_file_metadata_count({ count: metadataRows.length })}
								data-testid="inbox-files-popover-trigger"
							>
								{m.inbox_file_metadata_count({ count: metadataRows.length })} ▾
							</Popover.Trigger>
							<Popover.Portal>
								<Popover.Positioner side="bottom" align="start" sideOffset={4}>
									<Popover.Popup
										className="alm-inbox-detail__files-popup"
										data-testid="inbox-files-popup"
										aria-label={m.inbox_file_metadata_aria()}
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
								{m.inbox_no_file_metadata()}
							</span>
						)
					)}
				</div>

				{/* Needs review — rendered when unclassified files exist */}
				{unclassifiedRows.length > 0 && (
					<div className="alm-session-detail2__col">
						<Section title={m.inbox_needs_review_title({ count: unclassifiedRows.length })}>
							<div className="alm-inbox-detail__select-all-row">
								<input
									type="checkbox"
									checked={allSelected}
									ref={(el) => {
										if (el) el.indeterminate = someSelected;
									}}
									onChange={handleSelectAll}
									aria-label={m.inbox_select_all_unclassified_aria()}
									data-testid="reclassify-select-all"
								/>
								<span className="alm-inbox-detail__select-all-label">
									{selectedFiles.size === 0
										? m.common_select_all()
										: m.inbox_n_selected({ count: selectedFiles.size })}
								</span>
							</div>
							<Table columns={unclassifiedColumns} rows={unclassifiedRows} />

							{selectedFiles.size > 0 && (
								<fieldset className="alm-inbox-detail__bulk-controls">
									<legend className="alm-visually-hidden">
										{m.inbox_bulk_override_controls_aria()}
									</legend>
									<div className="alm-inbox-detail__bulk-field">
										{ }
										<label
											htmlFor="bulk-frame-type"
											className="alm-inbox-detail__bulk-label"
										>
											{m.inbox_frame_type_label()}
										</label>
										<select
											id="bulk-frame-type"
											value={bulkFrameType}
											onChange={(e) => setBulkFrameType(e.target.value)}
											aria-label={m.inbox_bulk_frame_type_aria()}
											data-testid="bulk-frame-type"
											className="alm-select alm-select--sm"
										>
											<option value="">{m.inbox_unchanged_placeholder()}</option>
											{FRAME_TYPE_OPTIONS.map((t) => (
												<option key={t} value={t}>
													{t}
												</option>
											))}
										</select>
									</div>

									<div className="alm-inbox-detail__bulk-field">
										{ }
										<label
											htmlFor="bulk-filter"
											className="alm-inbox-detail__bulk-label"
										>
											{m.common_filter()}
										</label>
										<input
											id="bulk-filter"
											type="text"
											value={bulkFilter}
											onChange={(e) => setBulkFilter(e.target.value)}
											placeholder={m.inbox_filter_placeholder()}
											aria-label={m.inbox_bulk_filter_aria()}
											data-testid="bulk-filter"
											className="alm-input alm-input--sm alm-inbox-detail__bulk-input-w80"
										/>
									</div>

									<div className="alm-inbox-detail__bulk-field">
										{ }
										<label
											htmlFor="bulk-exposure"
											className="alm-inbox-detail__bulk-label"
										>
											{m.inbox_exposure_label()}
										</label>
										<input
											id="bulk-exposure"
											type="number"
											value={bulkExposureS}
											onChange={(e) => setBulkExposureS(e.target.value)}
											placeholder={m.inbox_exposure_placeholder()}
											aria-label={m.inbox_bulk_exposure_aria()}
											data-testid="bulk-exposure-s"
											className="alm-input alm-input--sm alm-inbox-detail__bulk-input-w80"
											min={0}
										/>
									</div>

									<div className="alm-inbox-detail__bulk-field">
										{ }
										<label
											htmlFor="bulk-binning"
											className="alm-inbox-detail__bulk-label"
										>
											{m.settings_calmatch_binning()}
										</label>
										<input
											id="bulk-binning"
											type="text"
											value={bulkBinning}
											onChange={(e) => setBulkBinning(e.target.value)}
											placeholder={m.inbox_binning_placeholder()}
											aria-label={m.inbox_bulk_binning_aria()}
											data-testid="bulk-binning"
											className="alm-input alm-input--sm alm-inbox-detail__bulk-input-w80"
										/>
									</div>

								<button
									type="button"
									className="alm-btn alm-btn--sm alm-btn--accent"
									onClick={handleBulkApply}
									disabled={reclassifyLoading}
									aria-label={m.inbox_bulk_override_apply_aria({ count: selectedFiles.size })}
									data-testid="bulk-apply-btn"
								>
									{reclassifyLoading
										? m.common_applying()
										: m.inbox_apply_to_selected({ count: selectedFiles.size })}
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
									aria-label={m.inbox_apply_manual_overrides_aria()}
								>
									{reclassifyLoading
										? m.common_applying()
										: m.inbox_apply_n_overrides({ count: Object.keys(pendingOverrides).length })}
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
								{m.inbox_required_metadata_missing_title()}
							</span>
							<span className="alm-inbox-alert__body">
								{m.inbox_required_metadata_body({ count: filesMissingAttrs.length })}
							</span>
						</div>
					</Banner>
				</div>
			)}
		</div>
	</DetailPanel>
	);
}
