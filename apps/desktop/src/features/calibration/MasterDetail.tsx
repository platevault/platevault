/**
 * MasterDetail — spec 007 wired · spec 043 §4 (calibration detail redesign).
 *
 * Left-packed flat tabular layout matching SessionDetail exactly:
 *   [props A] [props B] [sessions column: "Used by" + "Compatible" stacked]
 *
 * Actions (Use in project / Replace master / Reveal) are inline-left
 * in the title via titleExtra, wrapped in alm-session-detail2__actions — same
 * pattern as SessionDetail's actionButtons. No `actions` prop passed to
 * DetailPanel. No subtitle (kind is already in the title, size is redundant).
 *
 * Data wiring:
 *   - master.usedBySessionIds from the list endpoint is always empty.
 *   - We fetch getCalibrationMaster(master.id) → MasterDetail_Serialize whose
 *     usedBySessionIds and compatibleSessions are populated, then cross-reference
 *     listSessions() to build "{target} · {filter} · {night}" labels for both.
 *
 * Matching hero (spec 043 §4 "Detail hero = compatible-sessions match table"):
 *   `MatchCandidatesPanel` is mounted below the fingerprint/linked-sessions row
 *   using the master's first `usedBySessionIds` entry as the matching context
 *   — `calibration.match.suggest` is anchored on a light SESSION (it returns
 *   ranked candidate masters for that one session), so a session id is
 *   required to drive it. `compatibleSessions` cannot supply that id: the
 *   backend leaves it an empty stub today (`masters_get` in
 *   crates/app/calibration/src/matching.rs hardcodes `compatible_sessions:
 *   vec![]`), so it is not used here. When the master has no used session yet
 *   the panel shows its existing "no selection" empty state — real once the
 *   master gets its first assignment instead of faked from stub data.
 */

import { useEffect, useState } from "react";
import { commands } from "@/bindings/index";
import { unwrap } from "@/api/ipc";
import type { CalibrationMaster_Serialize as CalibrationMaster } from "@/bindings/index";
import {
	DetailPane,
	DetailPanel,
	type PropertyDef,
	PropertyTable,
} from "@/components";
import { Btn, EmptyState } from "@/ui";
import { m } from "@/lib/i18n";
import { revealLabel } from "@/lib/reveal-label";
import { SessionListPopover } from "./SessionListPopover";
import { MatchCandidatesPanel } from "./MatchCandidatesPanel";
import { useCalibrationAssign, useCalibrationSuggest } from "./useCalibration";

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// ── Detail state (confirmed + compatible sessions resolved to names) ──────────

interface DetailState {
	confirmedNames: string[];
	compatibleNames: string[];
	loading: boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function MasterDetail({ master, prefillSuggestion, agingThresholdDays }: Props) {
	const [detail, setDetail] = useState<DetailState>({
		confirmedNames: [],
		compatibleNames: [],
		loading: false,
	});

	// Matching context: the session `calibration.match.suggest` is anchored on.
	// See the file-header note — real `usedBySessionIds`, not the stub
	// `compatibleSessions` field.
	const matchSessionId = master?.usedBySessionIds[0];
	const {
		response: suggestResponse,
		loading: suggestLoading,
		error: suggestError,
		refresh: refreshSuggest,
	} = useCalibrationSuggest(matchSessionId);
	const { assigning, assign } = useCalibrationAssign();

	const handleAssign = async (masterId: string, override: boolean) => {
		if (!matchSessionId) {
			return {
				status: "error",
				error: { code: "no_session", message: m.calibration_compatible_sessions_no_anchor_desc() },
			};
		}
		const res = await assign(matchSessionId, masterId, override);
		if (res.status === "success") refreshSuggest();
		// Normalize: the real response types `error`/`details` as `| null`, while
		// the panel's prop type only allows the object or `undefined`.
		return {
			status: res.status,
			error: res.error
				? {
						code: res.error.code,
						message: res.error.message,
						details: res.error.details ?? undefined,
					}
				: undefined,
		};
	};

	useEffect(() => {
		if (!master) {
			setDetail({ confirmedNames: [], compatibleNames: [], loading: false });
			return;
		}
		const masterId = master.id;
		let cancelled = false;
		setDetail({ confirmedNames: [], compatibleNames: [], loading: true });

		Promise.all([
			commands.calibrationMastersGet(masterId).then(unwrap),
			commands.sessionsList().then(unwrap),
		])
			.then(([masterDetail, sessions]) => {
				if (cancelled) return;
				const idToName = new Map<string, string>();
				for (const s of sessions) {
					const k = s.sessionKey;
					idToName.set(s.id, `${k.target} · ${k.filter} · ${k.night}`);
				}
				const confirmedNames = masterDetail.usedBySessionIds
					.map((id) => idToName.get(id) ?? id)
					.filter(Boolean);
				const compatibleNames = masterDetail.compatibleSessions
					.map((e) => idToName.get(e.sessionId) ?? e.sessionId)
					.filter(Boolean);
				setDetail({ confirmedNames, compatibleNames, loading: false });
			})
			.catch(() => {
				if (!cancelled)
					setDetail({
						confirmedNames: [],
						compatibleNames: [],
						loading: false,
					});
			});

		return () => {
			cancelled = true;
		};
	}, [master]);

	if (!master) {
		return (
			<DetailPane>
				<EmptyState
					title={m.calibration_select_master_title()}
					desc={m.calibration_select_master_desc()}
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
		? m.calibration_master_title_disc({ kind: kindCap, disc: masterDisc })
		: m.calibration_master_title({ kind: kindCap });

	// Fingerprint as flat PropertyTable rows — split across two columns like
	// SessionDetail's factProps.
	const fingerprintProps: PropertyDef[] = [
		{ key: "kind", label: m.calibration_fp_kind(), value: kindStr },
		{ key: "camera", label: m.settings_calmatch_camera(), value: fp.camera },
		{ key: "gain", label: m.settings_calmatch_gain(), value: String(fp.gain) },
		{ key: "exposure", label: m.calibration_fp_exposure(), value: `${fp.exposureS}s` },
		...(fp.tempC != null
			? [
					{
						key: "temp",
						label: m.calibration_fp_temperature(),
						value: `${fp.tempC}°C`,
					} as PropertyDef,
				]
			: []),
		...(fp.filter
			? [{ key: "filter", label: m.common_filter(), value: fp.filter } as PropertyDef]
			: []),
		...(fp.sensorMode
			? [
					{
						key: "sensorMode",
						label: m.calibration_fp_sensor_mode(),
						value: fp.sensorMode,
					} as PropertyDef,
				]
			: []),
		{ key: "binning", label: m.settings_calmatch_binning(), value: fp.binning },
		{ key: "size", label: m.settings_advanced_db_size(), value: fmtBytes(master.sizeBytes) },
	];

	const mid = Math.ceil(fingerprintProps.length / 2);
	const colA = fingerprintProps.slice(0, mid);
	const colB = fingerprintProps.slice(mid);

	// Actions inline-left in the title, same pattern as SessionDetail's actionButtons.
	const actionButtons = (
		<span className="alm-session-detail2__actions">
			<Btn size="sm" variant="primary">
				{m.calibration_action_use_in_project()}
			</Btn>
			{(isAging1Year || isAgingWarn) && (
				<Btn size="sm" variant="danger">
					{m.calibration_action_replace_master()}
				</Btn>
			)}
			{/* Platform-native label via the shared revealLabel() helper. */}
			<Btn size="sm">{revealLabel()}</Btn>
		</span>
	);

	return (
		<DetailPanel
			variant="calibration"
			title={<strong>{masterTitle}</strong>}
			titleExtra={actionButtons}
		>
			{/* Left-packed columns: [props A] [props B] [sessions: Used by + Compatible stacked]. */}
			<div className="alm-session-detail2">
				<div className="alm-session-detail2__col">
					<PropertyTable mode="view" properties={colA} />
				</div>
				<div className="alm-session-detail2__col">
					<PropertyTable mode="view" properties={colB} />
				</div>

				{/* Single column with both session popovers stacked vertically. */}
				<div className="alm-session-detail2__linked alm-session-detail2__linked--stack">
					<SessionListPopover
						label={m.calibration_used_by_label()}
						names={detail.loading ? [] : detail.confirmedNames}
					/>
					<SessionListPopover
						label={m.calibration_compatible_label()}
						names={detail.loading ? [] : detail.compatibleNames}
					/>
				</div>
			</div>

			{/* Detail hero (spec 043 §4): ranked candidate-masters match table for
			    the master's matching-context session, with assign/cancel. */}
			<div className="alm-session-detail2__match">
				<MatchCandidatesPanel
					sessionId={matchSessionId ?? ""}
					response={suggestResponse}
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
