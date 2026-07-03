/**
 * InboxPage — classify / confirm workflow on the Inbox's OWN 3-zone layout.
 *
 * spec 043 (#83 inbox redesign): the Inbox is a special page that does NOT use
 * the shared `ListPageLayout` bottom-split. It shares only the pinned
 * `PageTopBar` convention (search + group/sort/frame-type filter + Confirm /
 * Rescan actions, no page title) and then composes its OWN body with three
 * zones:
 *
 *   ┌──────────────── PageTopBar (pinned) ─────────────────┐
 *   ├───────────────────────────────┬──────────────────────┤
 *   │ detection LIST (primary,       │ file-details SIDE    │
 *   │ full height of the top region) │ panel (selected      │
 *   │                                │ detection: class +   │
 *   │                                │ breakdown + metadata)│
 *   ├═════════ planned-actions BOTTOM panel (docked) ═══════┤
 *   │ full width · own scroll · shown only when a plan/root │
 *   │ pick exists · never steals the list or side panel     │
 *   └───────────────────────────────────────────────────────┘
 *
 *   - #83: ONE search only (top-bar FilterToolbar). The list no longer wraps in
 *     ListSidebar (which carried a 2nd search box + a 3rd folder/master count).
 *     The triplicate counts collapse to a single compact per-frame-type
 *     breakdown in the top-bar summary; global totals live in the status bar.
 *   - The SIDE panel holds the selected detection's detail (`InboxDetail`):
 *     classification + breakdown + per-file metadata, at a sensible fixed width.
 *   - The BOTTOM panel holds the aggregate `PlanPanel` (every open plan), docked
 *     full-width with its own scroll. #75: per-group summaries collapse per-file
 *     rows and aggregate by ACTUAL frame type from the item's breakdown.
 *
 * spec 039: the left list is a cross-root aggregate of all unacknowledged
 * items (inbox.list), grouped/labelled by their registered root.
 */

import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { listRoots } from "@/api/commands";
import type { InboxConfirmDestination } from "@/api/commands";
import { useSetPageStatus } from "@/app/PageStatusContext";
import { FilterToolbar, ListPageLayout, PageTopBar } from "@/components";
import { usePlanApplyProgress } from "@/features/plans/usePlanApplyProgress";
import { m } from "@/lib/i18n";
import type { FrameType } from "@/lib/route-contract";
import { useGrouping } from "@/lib/use-grouping";
import { useStaleSelectionCleanup } from "@/lib/use-stale-selection";
import { addToast } from "@/shared/toast";
import { Btn } from "@/ui";
import { GROUPING_DIMENSIONS, GROUPING_STORAGE_KEY } from "./InboxControls";
import { InboxDetail } from "./InboxDetail";
import { InboxList, DEFAULT_INBOX_SORT } from "./InboxList";
import type { InboxSortCol, InboxSort } from "./InboxList";
import { InboxStatsSummary } from "./InboxStatsSummary";
import { deriveInboxStats } from "./inboxStatsFromItems";
import { PlanApprovalOverlay } from "./PlanApprovalOverlay";
import type { DestructiveDestination, PendingRootPick } from "./PlanPanel";
import { buildBreakdownFromActions } from "./PlanPanel";
import type { InboxBreakdownTarget } from "./store";
import {
	normalizeConfirmError,
	useApplySelectedInboxPlans,
	useInboxClassification,
	useInboxConfirm,
	useInboxItemMetadata,
	useInboxList,
	useInboxPlanApplyAll,
	useInboxPlanBreakdowns,
	useInboxPlanCancel,
	useInboxRescan,
	useOpenInboxPlans,
} from "./store";

/** Shape of `inbox.destination_root_required` error details (spec 041 US8/FR-029). */
interface DestinationRootRequiredDetails {
	category: string;
	candidates: Array<{ rootId: string; path: string; kind: string }>;
}

/** Type-guard for the destination-root-required details payload. */
function asRootRequiredDetails(
	d: unknown,
): DestinationRootRequiredDetails | null {
	if (
		d &&
		typeof d === "object" &&
		"candidates" in d &&
		Array.isArray((d).candidates)
	) {
		return d as DestinationRootRequiredDetails;
	}
	return null;
}

export function InboxPage() {
	const { selected, type } = useSearch({ from: "/shell/inbox" });
	const navigate = useNavigate({ from: "/inbox" });

	// FR-001 / FR-002: cross-root aggregate list replaces the hardcoded scan.
	const {
		data: listData,
		loading: listLoading,
		refresh: refreshList,
	} = useInboxList();
	const items = listData?.items ?? [];

	// Search + grouping / sort / frame-type controls now live in the top bar
	// (spec 043 #73/#31). `useGrouping` owns the persisted ordered grouping
	// dimensions; sort is local column-header state; lane + kind filters are
	// URL-backed (`type`) and local state respectively.
	const [search, setSearch] = useState("");
	const { dims, setSlot } = useGrouping({
		storageKey: GROUPING_STORAGE_KEY,
		validIds: GROUPING_DIMENSIONS.map((d) => d.id),
		defaultDims: [],
	});

	// Column-header sort state (replaces the old sort dropdown).
	const [inboxSort, setInboxSort] = useState<InboxSort>(DEFAULT_INBOX_SORT);
	const handleSort = useCallback(
		(col: InboxSortCol) => {
			setInboxSort((prev) =>
				prev.col === col
					? { col, dir: prev.dir === "asc" ? "desc" : "asc" }
					: { col, dir: "asc" },
			);
		},
		[],
	);

	// Kind filter: frame type of the detection (bias/dark/flat/light/master).
	const [kindFilter, setKindFilter] = useState("");

	// spec 041: aggregate open-plan surface (all ingestions at once).
	const { data: openPlansData, refresh: refreshOpenPlans } =
		useOpenInboxPlans();

	const openPlans = openPlansData?.plans ?? [];
	const totalActions = openPlansData?.totalActions ?? 0;

	// Refresh both the inbox list and the aggregate plan surface after any
	// apply/cancel/confirm mutation.
	const refreshAll = useCallback(() => {
		refreshList();
		refreshOpenPlans();
	}, [refreshList, refreshOpenPlans]);

	// Derive the unique roots from the current item list so rescan knows which
	// roots to ping (FR-005). Deduplicated by rootId.
	const roots = useMemo(() => {
		const seen = new Set<string>();
		const result: Array<{ rootId: string; rootAbsolutePath: string }> = [];
		for (const item of items) {
			if (!seen.has(item.rootId)) {
				seen.add(item.rootId);
				result.push({
					rootId: item.rootId,
					rootAbsolutePath: item.rootAbsolutePath,
				});
			}
		}
		return result;
	}, [items]);

	const onRescanComplete = useCallback(() => refreshAll(), [refreshAll]);
	const { loading: rescanLoading, rescan } = useInboxRescan(
		roots,
		onRescanComplete,
	);

	// FR-006: items are already bounded at 500 by the backend; surface a notice
	// when the cap is hit.
	const isCapped = listData?.capped ?? false;

	// Client-side text search across the relative path (the list's primary key).
	// task 33: also apply the breakdown-row frame-type filter when active.
	const filteredItems = useMemo(() => {
		let result = items;
		const q = search.trim().toLowerCase();
		if (q) {
			result = result.filter(
				(it) =>
					it.relativePath.toLowerCase().includes(q) ||
					(it.groupTarget ?? "").toLowerCase().includes(q),
			);
		}
		return result;
	}, [items, search]);

	// URL-backed selection is by index into the FILTERED list so it stays stable
	// across re-fetches and tracks what the user actually sees.
	const selectedItem =
		selected !== undefined ? filteredItems[selected] : undefined;

	useStaleSelectionCleanup(selected, selectedItem !== undefined, () =>
		navigate({
			search: (prev) => ({ ...prev, selected: undefined }),
			replace: true,
		}),
	);

	const onSelect = (idx: number) =>
		navigate({ search: (prev) => ({ ...prev, selected: idx }) });

	const clearSelection = useCallback(
		() =>
			navigate({
				search: (prev) => ({ ...prev, selected: undefined }),
				replace: true,
			}),
		[navigate],
	);

	// Each item carries its own root path — use it for classify / confirm calls.
	const selectedRootPath = selectedItem?.rootAbsolutePath ?? "";

	// Load classification for the selected item (no-op when nothing selected).
	const { data: classification } = useInboxClassification(
		selectedItem?.inboxItemId ?? "",
		selectedRootPath,
	);

	// Load per-file extracted metadata for the selected item (spec 041 US2/FR-010).
	const { data: fileMetadata } = useInboxItemMetadata(
		selectedItem?.inboxItemId ?? null,
	);

	// Destination library roots (non-inbox) for the per-detection "Source" picker.
	// When more than one exists, the user can choose where files land instead of
	// relying on backend auto-selection. "" = auto.
	const [destRoots, setDestRoots] = useState<
		Array<{ id: string; path: string; category: string }>
	>([]);
	const [selectedDestRootId, setSelectedDestRootId] = useState("");
	useEffect(() => {
		let alive = true;
		listRoots()
			.then((rs) => {
				if (!alive) return;
				setDestRoots(
					rs
						.filter((r) => r.category !== "inbox")
						.map((r) => ({ id: r.id, path: r.path, category: r.category })),
				);
			})
			.catch(() => {
				/* roots are optional UI sugar — ignore fetch failures */
			});
		return () => {
			alive = false;
		};
	}, []);

	const { confirm, loading: confirmLoading } = useInboxConfirm();
	// FR-032: destructive-destination choice, defaults to 'archive' (Constitution §II).
	// The literal 'archive' | 'trash' values are exactly what inbox.confirm accepts.
	const [destructiveDestination, setDestructiveDestination] =
		useState<DestructiveDestination>("archive");

	// spec 041 US8/FR-029: when a confirm needs the user to pick among multiple
	// candidate library roots, hold the prompt + the item it belongs to so the
	// PlanPanel can render the picker and we can re-confirm with the chosen root.
	const [pendingRootPick, setPendingRootPick] =
		useState<PendingRootPick | null>(null);
	const [rootPickItemId, setRootPickItemId] = useState<string | null>(null);

	// spec 041 US8/FR-031: absolute destination paths keyed by source path,
	// accumulated from each successful confirm's `destinations[]`. Lets the plan
	// panel show the full absolute destination per action.
	const [absoluteByFromPath, setAbsoluteByFromPath] = useState<
		Record<string, string>
	>({});

	// Drop a pending root pick when the user navigates away from its item, so a
	// stale picker never lingers under a different selection.
	const selectedItemId = selectedItem?.inboxItemId ?? null;
	useEffect(() => {
		if (rootPickItemId && rootPickItemId !== selectedItemId) {
			setPendingRootPick(null);
			setRootPickItemId(null);
		}
	}, [rootPickItemId, selectedItemId]);

	const mergeDestinations = useCallback(
		(destinations?: InboxConfirmDestination[] | null) => {
			if (!destinations || destinations.length === 0) return;
			setAbsoluteByFromPath((prev) => {
				const next = { ...prev };
				for (const d of destinations) {
					next[d.fromPath] = d.toAbsolutePath;
				}
				return next;
			});
		},
		[],
	);

	const { applyAll, loading: applyAllLoading } = useInboxPlanApplyAll();
	const { applySelected, loading: applySelectedLoading } =
		useApplySelectedInboxPlans();
	const { cancel, loading: cancelLoading } = useInboxPlanCancel();
	// Live long-op progress consumer (spec 042 US16 / FR-021): streams per-item
	// OperationEvents over the channel when applying a single ingestion plan.
	const { progress: applyProgress, run: runPlanApply } = usePlanApplyProgress();
	const [progressPlanId, setProgressPlanId] = useState<string | null>(null);

	/**
	 * Confirm `item` (optionally targeting a caller-chosen destination `rootId`).
	 * Centralises the success path and the structured-error handling so the
	 * initial confirm and a re-confirm after a root pick share one code path.
	 */
	const runConfirm = useCallback(
		async (
			item: { inboxItemId: string; rootAbsolutePath: string },
			contentSignature: string,
			rootId?: string,
		) => {
			try {
				const result = await confirm({
					inboxItemId: item.inboxItemId,
					contentSignature,
					rootAbsolutePath: item.rootAbsolutePath,
					destructiveDestination,
					rootId: rootId ?? null,
				});
				// Success: clear any pending root pick and capture absolute destinations.
				setPendingRootPick(null);
				setRootPickItemId(null);
				mergeDestinations(result.destinations);
				// spec 041: masters now always return a plan too — every confirm produces
				// a reviewable plan that appears in the aggregate surface below.
				addToast({
					message: m.inbox_toast_plan_created({
						count: String(result.itemsTotal),
					}),
					variant: "info",
				});
				refreshAll();
			} catch (e) {
				const { code, message, details } = normalizeConfirmError(e);
				if (code === "inbox.destination_root_required") {
					// FR-029: multiple candidate roots — prompt the user to choose one.
					const parsed = asRootRequiredDetails(details);
					if (parsed) {
						setPendingRootPick({
							category: parsed.category,
							candidates: parsed.candidates,
						});
						setRootPickItemId(item.inboxItemId);
						addToast({
							message: m.inbox_toast_choose_dest_root(),
							variant: "warn",
						});
						return;
					}
				}
				if (code === "inbox.invalid_destination_root") {
					addToast({
						message: message || m.inbox_toast_invalid_destination_root(),
						variant: "error",
					});
					return;
				}
				if (code === "inbox.no_destination_root") {
					addToast({
						message:
							message || m.inbox_toast_no_destination_root(),
						variant: "error",
					});
					return;
				}
				if (code === "inbox.missing_path_attributes") {
					// FR-032 (US9): files lack a path-load-bearing attribute. The detail
					// panel already annotates each blocked file; point the user there.
					addToast({
						message: m.inbox_toast_missing_path_attrs(),
						variant: "warn",
					});
					return;
				}
				if (message.includes("inbox.has.open.plan")) {
					addToast({ message: m.inbox_toast_has_open_plan(), variant: "warn" });
				} else if (message.includes("classification.stale")) {
					addToast({
						message: m.inbox_toast_stale_classification(),
						variant: "warn",
					});
				} else {
					addToast({
						message: m.inbox_toast_confirm_failed({ message }),
						variant: "error",
					});
				}
			}
		},
		[confirm, destructiveDestination, mergeDestinations, refreshAll],
	);

	const handleConfirm = async () => {
		// spec 041 T071/T072 (FR-050): the backend "split" action is removed —
		// classification.type === "mixed" is only reachable when the SELECTED
		// item is still the pre-materialization leaf-folder row spanning more
		// than one frame type (T066 already split it into single-type
		// sub-items, which appear as separate list rows). Such a row can never
		// itself be confirmed (its classification.result is never
		// "classified"), so confirm is gated off entirely for it via
		// `canConfirm` below — guard here too as defense in depth.
		if (!selectedItem || !classification || classification.type === "mixed") return;
		await runConfirm(
			{
				inboxItemId: selectedItem.inboxItemId,
				rootAbsolutePath: selectedRootPath,
			},
			classification.contentSignature,
			// "" = auto-select (let the backend choose); otherwise the picked root.
			selectedDestRootId || undefined,
		);
	};

	// task 35: bulk-confirm all cleanly-classified detections in sequence.
	// "Cleanly classified" = state is 'classified', no open plan, and
	// classification.type is 'single_type' (not mixed / unclassified). We use
	// the item's contentSignature from the list (same value InboxPage uses for
	// the single-item confirm) and always pass action='confirm' (never 'split').
	// Items that fail individually are reported; the rest proceed.
	const [bulkConfirmLoading, setBulkConfirmLoading] = useState(false);

	// Eligible items: classified state, no plan open, not a mixed type.
	// We only know classification type per-item when it is loaded; the list item
	// carries `state` and `contentSignature`, so we filter on those. The backend
	// will reject anything that turns out to be unclassified or missing attrs, and
	// each failure produces a toast. This matches the pattern for rescan.
	const bulkEligibleItems = useMemo(
		() => items.filter((it) => it.state === "classified"),
		[items],
	);

	const canBulkConfirm = bulkEligibleItems.length > 0 && !bulkConfirmLoading;

	const handleBulkConfirm = async () => {
		if (bulkEligibleItems.length === 0) return;
		setBulkConfirmLoading(true);
		let successCount = 0;
		let failCount = 0;
		for (const it of bulkEligibleItems) {
			try {
				await confirm({
					inboxItemId: it.inboxItemId,
					contentSignature: it.contentSignature,
					rootAbsolutePath: it.rootAbsolutePath,
					destructiveDestination,
					rootId: null,
				});
				successCount += 1;
			} catch {
				failCount += 1;
			}
		}
		setBulkConfirmLoading(false);
		if (failCount > 0 && successCount > 0) {
			addToast({
				message: m.inbox_toast_bulk_partial({
					success: String(successCount),
					fail: String(failCount),
				}),
				variant: "warn",
			});
		} else if (failCount > 0 && successCount === 0) {
			addToast({
				message: m.inbox_toast_bulk_all_need_review(),
				variant: "warn",
			});
		} else {
			addToast({
				message: m.inbox_toast_bulk_confirmed({
					count: successCount,
				}),
				variant: "info",
			});
		}
		refreshAll();
	};

	/** FR-029: re-confirm the pending item with the chosen destination root. */
	const handlePickDestinationRoot = async (rootId: string) => {
		if (!rootPickItemId || !selectedItem || !classification) return;
		if (selectedItem.inboxItemId !== rootPickItemId) return;
		// A "mixed" classification can never reach the destination-root picker
		// (confirm rejects it with classification.ambiguous before root
		// resolution runs) — guarded as defense in depth, matching handleConfirm.
		if (classification.type === "mixed") return;
		await runConfirm(
			{
				inboxItemId: selectedItem.inboxItemId,
				rootAbsolutePath: selectedRootPath,
			},
			classification.contentSignature,
			rootId,
		);
	};

	const handleApplySelected = async (inboxItemIds: string[]) => {
		if (inboxItemIds.length === 0) return;
		const result = await applySelected(inboxItemIds);
		if (result) {
			const failed = result.results.filter((r) => r.error != null).length;
			if (failed > 0) {
				addToast({
					message: m.inbox_toast_plans_partial({
						applied: String(result.results.length - failed),
						failed: String(failed),
					}),
					variant: "warn",
				});
			} else {
				addToast({
					message: m.inbox_toast_plans_applying({
						count: String(result.results.length),
					}),
					variant: "info",
				});
			}
			refreshAll();
		} else {
			addToast({ message: m.inbox_toast_apply_failed(), variant: "error" });
		}
	};

	const handleApplyAll = async () => {
		const result = await applyAll();
		if (result) {
			const failed = result.results.filter((r) => r.error != null).length;
			if (failed > 0) {
				addToast({
					message: m.inbox_toast_all_plans_partial({
						applied: String(result.results.length - failed),
						failed: String(failed),
					}),
					variant: "warn",
				});
			} else {
				addToast({
					message: m.inbox_toast_all_plans_applying({
						count: String(result.results.length),
					}),
					variant: "info",
				});
			}
			refreshAll();
		}
	};

	// Apply a single ingestion plan with live per-item progress streamed over
	// the long-operation OperationEvent channel (spec 042 US16 / FR-021). This is
	// the end-to-end consumer of the channel contract on the inbox plan surface.
	const handleApplyOne = async (planId: string) => {
		setProgressPlanId(planId);
		const response = await runPlanApply({ id: planId });
		if (response) {
			addToast({ message: m.inbox_plan_applied_toast(), variant: "info" });
			refreshAll();
		} else {
			addToast({ message: m.inbox_plan_apply_failed_toast(), variant: "error" });
		}
	};

	const handleCancel = async (inboxItemId: string) => {
		await cancel(inboxItemId);
		addToast({ message: m.inbox_toast_plan_discarded(), variant: "info" });
		refreshAll();
	};

	const hasOpenPlan = selectedItem?.state === "plan_open";

	// Confirm gating (spec 043 §4 / task #34): MISSING REQUIRED metadata blocks
	// confirm — any file lacking a path-load-bearing attribute cannot be routed
	// to a destination, so the backend rejects it (inbox.missing_path_attributes).
	// Disable confirm up-front and let the detail pane's danger alert explain why.
	const hasMissingRequiredMeta = useMemo(
		() =>
			(fileMetadata ?? []).some(
				(f) => (f.missingPathAttributes?.length ?? 0) > 0,
			),
		[fileMetadata],
	);

	// spec 041 T071/T072 (FR-050): the backend "split" action for MIXED items
	// is removed — a folder that still classifies as "mixed" (multiple frame
	// types on this row) can never itself be confirmed; only "single_type"
	// rows (including the sub-items T066 already materialized alongside it)
	// are confirmable, so confirm is disabled for both "unclassified" and
	// "mixed" here.
	const canConfirm =
		!!selectedItem &&
		!!classification &&
		classification.type === "single_type" &&
		!hasMissingRequiredMeta &&
		!hasOpenPlan;

	const planBusy = applyAllLoading || applySelectedLoading || cancelLoading;

	// Stage B: plan review overlay open/close state.
	const [planOverlayOpen, setPlanOverlayOpen] = useState(false);

	// Auto-close the overlay once all plans have been applied/cancelled.
	useEffect(() => {
		if (planOverlayOpen && openPlans.length === 0 && pendingRootPick == null) {
			setPlanOverlayOpen(false);
		}
	}, [planOverlayOpen, openPlans.length, pendingRootPick]);

	// spec 041 T072: "Generate split plan" is retired along with the backend
	// "split" action (FR-050) — a mixed row is disabled via `canConfirm`
	// above, so the label is always the plain confirm label now.
	const confirmLabel = m.inbox_confirm_to_inventory();

	// spec 041 US6: aggregate inbox queue stats. Derived from the SAME item list
	// the header/footer count from (distinct-folder counting) so the stats strip,
	// header, and footer always reconcile — a mixed folder counts once overall.
	const derivedStats = useMemo(() => deriveInboxStats(items), [items]);

	// #75: frame-type hint per ingestion, derived from the inbox item's
	// classification/breakdown (here: the dominant `groupFrameType`, or the
	// master's `masterFrameType`). PlanPanel uses this to label each collapsed
	// group bucket by frame type (bias/dark/flat/light/master) instead of
	// degenerating to one line per catalogue action.
	const frameTypeByItemId = useMemo(() => {
		const m: Record<string, string> = {};
		for (const it of items) {
			const ft = it.isMaster
				? (it.masterFrameType ?? "master")
				: it.groupFrameType;
			if (ft) m[it.inboxItemId] = ft;
		}
		return m;
	}, [items]);

	// #98: PRELOAD the authoritative per-type breakdown for EVERY item that has
	// an open plan — not just the selected one. Each open plan is mapped to its
	// item's registered root path (from the inbox list) so the classify query can
	// run. The hook shares `useInboxClassification`'s cache key, so the selected
	// item's classification is reused rather than re-fetched. The result is a
	// `inboxItemId → breakdown[]` map covering all unselected mixed folders, which
	// previously degraded to a dominant-type guess (e.g. "41 darks").
	const rootPathByItemId = useMemo(() => {
		const m: Record<string, string> = {};
		for (const it of items) m[it.inboxItemId] = it.rootAbsolutePath;
		return m;
	}, [items]);

	const breakdownTargets = useMemo<InboxBreakdownTarget[]>(() => {
		const seen = new Set<string>();
		const out: InboxBreakdownTarget[] = [];
		for (const plan of openPlans) {
			const rootAbsolutePath = rootPathByItemId[plan.inboxItemId];
			if (!rootAbsolutePath || seen.has(plan.inboxItemId)) continue;
			seen.add(plan.inboxItemId);
			out.push({ inboxItemId: plan.inboxItemId, rootAbsolutePath });
		}
		return out;
	}, [openPlans, rootPathByItemId]);

	const preloadedBreakdowns = useInboxPlanBreakdowns(breakdownTargets);

	// #75/#98: per-ingestion frame-type BREAKDOWN for the collapsed plan summary —
	// the per-type bias/dark/flat/light/master counts (same shape the classify
	// breakdown / InboxStatsSummary use). Sourced + merged per item, preferring
	// the most authoritative source available:
	//   1. From each open plan's ACTIONS, classified by destination-path keyword
	//      + the per-item hint (`buildBreakdownFromActions`) — the always-present
	//      fallback. A MOVE/SPLIT plan whose files land in typed folders yields a
	//      TRUE multi-type tally even before classify resolves.
	//   2. The PRELOADED real classification `breakdown[]` for the plan's item
	//      (#98) — resolves a MIXED in-place catalogue the action paths cannot,
	//      for EVERY open plan regardless of selection.
	//   3. The SELECTED item's freshly-loaded classification breakdown — same
	//      data as (2) but guaranteed current for the active selection.
	// The result keys each plan to its tally so PlanPanel renders one summary
	// line ("10 bias · 21 dark · 12 light → (root)") instead of per-file rows.
	const breakdownByItemId = useMemo(() => {
		const m: Record<
			string,
			ReadonlyArray<{ kind: string; count: number }>
		> = {};
		for (const plan of openPlans) {
			m[plan.inboxItemId] = buildBreakdownFromActions(
				plan.actions,
				frameTypeByItemId[plan.inboxItemId],
				absoluteByFromPath,
			);
		}
		// Overlay the preloaded authoritative breakdown for every open plan item.
		for (const [id, breakdown] of Object.entries(preloadedBreakdowns)) {
			if (breakdown.length > 0 && m[id] != null) m[id] = breakdown;
		}
		// Prefer the selected item's authoritative classification breakdown.
		if (
			selectedItem &&
			classification?.breakdown &&
			classification.breakdown.length > 0 &&
			m[selectedItem.inboxItemId] != null
		) {
			m[selectedItem.inboxItemId] = classification.breakdown.map((b) => ({
				kind: b.kind,
				count: b.count,
			}));
		}
		return m;
	}, [
		openPlans,
		frameTypeByItemId,
		absoluteByFromPath,
		preloadedBreakdowns,
		selectedItem,
		classification,
	]);

	// Summary count (no page title — top-bar convention): folders / masters.
	const folderCount = items.filter((it) => !it.isMaster).length;
	const masterCount = items.filter((it) => it.isMaster).length;
	const summary = useMemo(() => {
		if (listLoading) return m.common_loading();
		const parts: string[] = [];
		if (folderCount > 0)
			parts.push(m.inbox_count_folders({ count: folderCount }));
		if (masterCount > 0)
			parts.push(m.inbox_count_masters({ count: masterCount }));
		const base = parts.length > 0 ? parts.join(" · ") : m.inbox_summary_zero_detections();
		return isCapped ? m.inbox_summary_capped({ base, limit: String(listData?.limit ?? 500) }) : base;
	}, [listLoading, folderCount, masterCount, isCapped, listData?.limit]);

	// ── Status bar: push the inbox-specific folder/master count + per-frame-type
	// breakdown into the global status bar's page-contextual slot. The top bar
	// reverts to filters + actions only (matching all other pages). The slot is
	// automatically cleared when this page unmounts (route change). ──
	useSetPageStatus(
		<span className="alm-inbox-summary" data-testid="statusbar-inbox-summary">
			<span className="alm-inbox-summary__count">{summary}</span>
			{!listLoading && <InboxStatsSummary stats={derivedStats} />}
		</span>,
	);

	// Shown when ≥1 open plan exists OR a destination-root pick is pending (the
	// latter can occur with zero open plans — the plan wasn't generated yet).
	// Declared BEFORE topBar: the topBar JSX evaluates these eagerly at createElement.
	const showPlans = openPlans.length > 0 || pendingRootPick != null;
	const planCount = openPlans.length;

	// ── Top bar: NO page title, NO summary (top-bar convention matches other pages).
	// Search + group/sort/filter in FilterToolbar; Confirm + Rescan on the right. ──
	const topBar = (
		<PageTopBar
			filters={
				<FilterToolbar
					search={{
						value: search,
						onChange: setSearch,
						placeholder: m.inbox_search_placeholder(),
						ariaLabel: m.inbox_search_aria_label(),
					}}
					fields={[
						{
							key: "fileType",
							label: m.inbox_filter_file_type_label(),
							value: type ?? "",
							options: [
								{ value: "fits", label: m.inbox_filter_fits() },
								{ value: "video", label: m.inbox_filter_video() },
							],
							allLabel: m.inbox_filter_all_file_types(),
							onChange: (v) =>
								navigate({
									search: (prev) => ({
										...prev,
										type: (v || undefined) as FrameType | undefined,
									}),
								}),
						},
						{
							key: "kind",
							label: m.inbox_filter_kind_label(),
							value: kindFilter,
							options: [
								{ value: "bias", label: m.inbox_kind_bias() },
								{ value: "dark", label: m.inbox_kind_dark() },
								{ value: "flat", label: m.inbox_kind_flat() },
								{ value: "light", label: m.inbox_kind_light() },
								{ value: "master", label: m.inbox_kind_master() },
							],
							allLabel: m.inbox_filter_kind_all(),
							onChange: setKindFilter,
						},
					]}
					grouping={{
						dimensions: GROUPING_DIMENSIONS.map((d) => ({
							value: d.id,
							label: d.label,
						})),
						dims,
						setSlot,
					}}
				/>
			}
			actions={
				<>
					{/* Stage B: trigger to open the plan-approval overlay. Shown
						    whenever open plans OR a pending root pick exist. */}
					{showPlans && (
						<Btn
							size="sm"
							variant="accent"
							onClick={() => setPlanOverlayOpen(true)}
							aria-label={m.inbox_review_plans_with_count({ count: planCount })}
							data-testid="inbox-review-plans-btn"
						>
							{planCount > 0
								? m.inbox_review_plans_with_count({ count: planCount })
								: m.inbox_review_plans()}
						</Btn>
					)}
					{/* task 35: bulk-confirm all cleanly-classified items in one action */}
					{bulkEligibleItems.length > 0 && (
						<Btn
							size="sm"
							variant="accent"
							disabled={!canBulkConfirm}
							onClick={() => void handleBulkConfirm()}
							aria-label={m.inbox_confirm_all_classified_aria({ count: bulkEligibleItems.length })}
							data-testid="inbox-bulk-confirm-btn"
							// Guided-tour target (spec 010/041). The redesign moved the
							// page-level confirm to this bulk-confirm action; keep the
							// `inbox.confirm-row` anchor on it so the tour still resolves.
							data-guide-anchor="inbox.confirm-row"
						>
							{bulkConfirmLoading
								? m.common_confirming()
								: m.inbox_confirm_all({ count: bulkEligibleItems.length })}
						</Btn>
					)}
					{/* Per-detection "Confirm to inventory" lives in the bottom detail
						header (Sessions convention). The top bar keeps only page-level
						actions: review plans, bulk confirm, rescan. */}
					<Btn
						size="sm"
						disabled={rescanLoading}
						onClick={() => void rescan()}
						aria-label={m.inbox_rescan_all_roots_aria()}
					>
						{rescanLoading ? m.common_rescanning() : m.common_rescan()}
					</Btn>
				</>
			}
		/>
	);

	// ── Standardised list-page layout (Sessions/Calibration reference) ──
	//   primary: detection LIST (full width)
	//   detail:  InboxDetail docked in the BOTTOM panel (auto-size, own scroll)
	//            with the per-detection "Confirm to inventory" inline in its
	//            header. Plan review remains the focused PlanApprovalOverlay.
	return (
		<>
			<ListPageLayout
				topBar={topBar}
				detailLabel={m.inbox_detection_details()}
				detail={
					selectedItem != null ? (
						<InboxDetail
							// Remount per item so per-item state (pending type overrides)
							// never leaks across selections.
							key={selectedItem.inboxItemId}
							item={selectedItem}
							rootAbsolutePath={selectedRootPath}
							classification={classification ?? null}
							fileMetadata={fileMetadata}
							// Confirm runs the same flow the old top-bar button did.
							// Disabled entirely for "mixed" rows (FR-050) — see
							// canConfirm above.
							onConfirm={() => void handleConfirm()}
							confirmLabel={confirmLabel}
							confirmDisabled={!canConfirm}
							confirmBusy={confirmLoading}
							destinationRoots={destRoots}
							selectedRootId={selectedDestRootId}
							onSelectRoot={setSelectedDestRootId}
						/>
					) : undefined
				}
				onCloseDetail={selectedItem != null ? clearSelection : undefined}
			>
				<InboxList
					items={filteredItems}
					selectedIdx={selected ?? null}
					onSelect={onSelect}
					filterType={type ?? "all"}
					dims={dims}
					kindFilter={kindFilter}
					sort={inboxSort}
					onSort={handleSort}
				/>
			</ListPageLayout>

			{/* Plan-approval overlay — opens via top-bar trigger.
			    Wraps the existing PlanPanel; all apply/cancel/root-pick
			    handlers are passed through unchanged. The per-plan live-apply
			    progress stream (spec 042 US16 / FR-021) threads through here so
			    the overlay's PlanPanel can show per-group apply progress. */}
			<PlanApprovalOverlay
				open={planOverlayOpen}
				onClose={() => setPlanOverlayOpen(false)}
				plans={openPlans}
				totalActions={totalActions}
				destructiveDestination={destructiveDestination}
				onDestructiveDestinationChange={setDestructiveDestination}
				onApplySelected={(ids) => void handleApplySelected(ids)}
				onApplyAll={() => void handleApplyAll()}
				onApplyOne={(planId) => void handleApplyOne(planId)}
				progress={applyProgress}
				progressPlanId={progressPlanId}
				onCancel={(id) => void handleCancel(id)}
				busy={planBusy || applyProgress.running}
				pendingRootPick={pendingRootPick}
				onPickDestinationRoot={(rootId) =>
					void handlePickDestinationRoot(rootId)
				}
				rootPickBusy={confirmLoading}
				absoluteByFromPath={absoluteByFromPath}
				frameTypeByItemId={frameTypeByItemId}
				breakdownByItemId={breakdownByItemId}
			/>
		</>
	);
}
