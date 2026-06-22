/**
 * MasterDetail — spec 007 wired · spec 043 §4 (calibration detail redesign) ·
 * tasks #100/#101.
 *
 * Left-packed flat tabular layout matching SessionDetail and TargetDetailV2:
 *   Row 1 — [fingerprint PropertyTable] [confirmed sessions column]
 *   Row 2 — MatchCandidatesPanel (full-width, the hero content)
 *
 * Grey RailCard / KV / MetricLine boxes removed. No facts/aux props passed
 * to DetailPanel — the children carry all content.
 *
 * Data wiring for confirmed sessions:
 *   - master.usedBySessionIds from the list endpoint is always empty.
 *   - We fetch calibrationMastersGet(master.id) → MasterDetail_Serialize whose
 *     usedBySessionIds is populated, then cross-reference sessionsList() to
 *     build "{target} · {filter} · {night}" labels.
 */

import { useEffect, useState } from "react";
import { getCalibrationMaster, listSessions } from "@/api/commands";
import type { CalibrationMaster_Serialize as CalibrationMaster } from "@/bindings/index";
import {
	DetailPane,
	DetailPanel,
	type PropertyDef,
	PropertyTable,
} from "@/components";
import type { PillVariant } from "@/ui";
import { Btn, EmptyState, Pill } from "@/ui";
import { MatchCandidatesPanel } from "./MatchCandidatesPanel";
import { useCalibrationAssign, useCalibrationSuggest } from "./useCalibration";

// ── Helpers ───────────────────────────────────────────────────────────────────

function kindVariant(kind: string): PillVariant {
	const map: Record<string, PillVariant> = {
		dark: "info",
		flat: "accent",
		bias: "neutral",
	};
	return map[kind.toLowerCase()] ?? "neutral";
}

interface ContextualAction {
	label: string;
	variant?: "primary" | "danger" | "ghost";
}

function masterActions(
	master: CalibrationMaster,
	agingThresholdDays: number,
): ContextualAction[] {
	const isAging = master.ageDays > agingThresholdDays;
	const actions: ContextualAction[] = [
		{ label: "Use in project", variant: "primary" },
	];
	if (isAging) actions.push({ label: "Replace master", variant: "danger" });
	actions.push({ label: "Reveal in Explorer" });
	return actions;
}

function fmtBytes(bytes: number): string {
	if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
	if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(0)} MB`;
	return `${(bytes / 1024).toFixed(0)} KB`;
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
	master: CalibrationMaster | null;
	prefillSuggestion: boolean;
	/** Days threshold for aging warnings. Comes from persisted settings (FR-023). */
	agingThresholdDays: number;
}

// ── Confirmed sessions state ──────────────────────────────────────────────────

interface ConfirmedState {
	names: string[];
	loading: boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function MasterDetail({
	master,
	prefillSuggestion,
	agingThresholdDays,
}: Props) {
	const sessionId = master?.sourceSessionId ?? undefined;

	const {
		response,
		loading: suggestLoading,
		error: suggestError,
		refresh,
	} = useCalibrationSuggest(sessionId);
	const { assigning, assign } = useCalibrationAssign();

	// Confirmed sessions — fetch detail + sessions list, keyed on master.id.
	const [confirmed, setConfirmed] = useState<ConfirmedState>({
		names: [],
		loading: false,
	});

	useEffect(() => {
		if (!master) {
			setConfirmed({ names: [], loading: false });
			return;
		}
		const masterId = master.id;
		let cancelled = false;
		setConfirmed({ names: [], loading: true });

		Promise.all([getCalibrationMaster({ id: masterId }), listSessions()])
			.then(([detail, sessions]) => {
				if (cancelled) return;
				const idToName = new Map<string, string>();
				for (const s of sessions) {
					const k = s.sessionKey;
					idToName.set(s.id, `${k.target} · ${k.filter} · ${k.night}`);
				}
				const names = detail.usedBySessionIds
					.map((id) => idToName.get(id) ?? id)
					.filter(Boolean);
				setConfirmed({ names, loading: false });
			})
			.catch(() => {
				if (!cancelled) setConfirmed({ names: [], loading: false });
			});

		return () => {
			cancelled = true;
		};
	}, [master]);

	const handleAssign = async (masterId: string, override: boolean) => {
		if (!sessionId)
			return {
				status: "error" as const,
				error: { code: "session.not_found", message: "No session" },
			};
		const res = await assign(sessionId, masterId, override);
		if (res.status === "success") {
			refresh();
		}
		return res as {
			status: string;
			error?: {
				code: string;
				message: string;
				details?: { dimensions: string[] };
			};
		};
	};

	if (!master) {
		return (
			<DetailPane>
				<EmptyState
					title="Select a master"
					desc="Select a master to view its details."
				/>
			</DetailPane>
		);
	}

	const isAging1Year = master.ageDays >= 365;
	const isAgingWarn = master.ageDays > agingThresholdDays && !isAging1Year;
	const kindStr = master.kind.toString().toLowerCase().replace("_", " ");

	const fp = master.fingerprint;

	const kindCap = kindStr.charAt(0).toUpperCase() + kindStr.slice(1);
	const masterDisc =
		kindStr === "dark"
			? fp.exposureS != null
				? `${fp.exposureS}s`
				: ""
			: kindStr === "flat"
				? (fp.filter ?? "")
				: "";
	const masterTitle = masterDisc
		? `Master ${kindCap} · ${masterDisc}`
		: `Master ${kindCap}`;

	// Fingerprint as flat PropertyTable rows.
	const fingerprintProps: PropertyDef[] = [
		{ key: "kind", label: "Kind", value: kindStr },
		{ key: "camera", label: "Camera", value: fp.camera },
		{ key: "gain", label: "Gain", value: String(fp.gain) },
		{ key: "exposure", label: "Exposure", value: `${fp.exposureS}s` },
		...(fp.tempC != null
			? [
					{
						key: "temp",
						label: "Temperature",
						value: `${fp.tempC}°C`,
					} as PropertyDef,
				]
			: []),
		...(fp.filter
			? [{ key: "filter", label: "Filter", value: fp.filter } as PropertyDef]
			: []),
		...(fp.sensorMode
			? [
					{
						key: "sensorMode",
						label: "Sensor mode",
						value: fp.sensorMode,
					} as PropertyDef,
				]
			: []),
		{ key: "binning", label: "Binning", value: fp.binning },
		{ key: "size", label: "Size", value: fmtBytes(master.sizeBytes) },
	];

	return (
		<DetailPanel
			variant="calibration"
			title={<span>{masterTitle}</span>}
			titleExtra={
				<>
					<Pill variant={kindVariant(kindStr)}>{kindStr.toUpperCase()}</Pill>
					{isAging1Year && <Pill variant="danger">aging &gt; 1 year</Pill>}
					{isAgingWarn && <Pill variant="warn">aging {master.ageDays}d</Pill>}
				</>
			}
			subtitle={`${kindStr} · ${fmtBytes(master.sizeBytes)}`}
			actions={masterActions(master, agingThresholdDays).map((a) => (
				<Btn key={a.label} size="sm" variant={a.variant}>
					{a.label}
				</Btn>
			))}
		>
			{/* Left-packed row: [fingerprint] [confirmed sessions] */}
			<div className="alm-calib-detail2">
				<div className="alm-calib-detail2__col">
					<PropertyTable mode="view" properties={fingerprintProps} />
				</div>
				<div className="alm-calib-detail2__confirmed">
					<div className="alm-calib-detail2__head">Confirmed sessions</div>
					{confirmed.loading ? (
						<span className="alm-calib-detail2__muted">Loading…</span>
					) : confirmed.names.length > 0 ? (
						<div className="alm-calib-detail2__confirmed-list">
							{confirmed.names.map((name) => (
								<span key={name} className="alm-calib-detail2__confirmed-name">
									{name}
								</span>
							))}
						</div>
					) : (
						<span className="alm-calib-detail2__muted">None</span>
					)}
				</div>
			</div>

			{/* Compatible-sessions match table — hero content, full-width below the row. */}
			<div className="alm-calib-detail2__match-wrap">
				<MatchCandidatesPanel
					sessionId={sessionId ?? ""}
					response={response}
					loading={suggestLoading}
					error={suggestError}
					onAssign={handleAssign}
					assigning={assigning}
					prefillSuggestion={prefillSuggestion}
				/>
			</div>
		</DetailPanel>
	);
}
