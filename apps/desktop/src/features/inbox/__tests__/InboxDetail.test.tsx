/// <reference types="@testing-library/jest-dom" />
/**
 * Tests for InboxDetail (FR-010: per-file metadata table, FR-011: mixed
 * composition summary).
 *
 * Scope: ONLY InboxDetail.tsx. Uses fixtures; no IPC mocks needed because
 * InboxDetail never fetches — it renders the data it receives.
 *
 * InboxFileMetadata is the generated Specta type (camelCase), re-exported via
 * '@/api/commands' (spec 041 US2/FR-010 — wired in T019):
 *   relativeFilePath, frameTypeEffective, imageTyp, filter, exposureS, binningX,
 *   binningY, gain (string), temperatureC, object, dateObs, instrume, telescop,
 *   naxis1, naxis2, stackCount, isMaster, overrideStale
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render as rtlRender, screen } from "@testing-library/react";
import type React from "react";
import { describe, expect, it, vi } from "vitest";
import type { InboxFileMetadata } from "@/api/commands";
import type {
	InboxClassifyResponse_Serialize as InboxClassifyResponse,
	InboxItemSummary_Serialize as InboxItemSummary,
} from "@/bindings";

import { InboxDetail } from "../InboxDetail";

// InboxDetail uses the TanStack-Query-backed `useInboxReclassify` hook (spec 042),
// so every render must be wrapped in a QueryClientProvider.
function render(ui: React.ReactElement) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return rtlRender(
		<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
	);
}

// ── Mock reclassify hook ─────────────────────────────────────────────────────
vi.mock("@/api/commands", async (importOriginal) => {
	const mod = await importOriginal<typeof import("@/api/commands")>();
	return {
		...mod,
		inboxReclassify: vi.fn().mockResolvedValue({
			inboxItemId: "item-001",
			remainingUnclassified: 0,
		}),
	};
});

// ── Fixtures ─────────────────────────────────────────────────────────────────

const sampleItem: InboxItemSummary = {
	inboxItemId: "item-001",
	relativePath: "2025-10-10/NGC7000",
	fileCount: 17,
	lane: "fits",
	format: "fits",
	state: "classified",
	contentSignature: "sig-001",
	isMaster: false,
	masterFrameType: null,
	masterFilter: null,
	masterExposureS: null,
};

/** Classification with three frame types → classType "mixed" */
const mixedClassification: InboxClassifyResponse = {
	inboxItemId: "item-001",
	type: "mixed",
	frameType: null,
	contentSignature: "sig-001",
	breakdown: [
		{
			kind: "light",
			count: 12,
			destinationPreview: "NGC7000/Ha/light/",
			sampleFiles: [],
		},
		{
			kind: "dark",
			count: 4,
			destinationPreview: "calib/dark/",
			sampleFiles: [],
		},
		{
			kind: "flat",
			count: 1,
			destinationPreview: "calib/flat/",
			sampleFiles: [],
		},
	],
	unclassifiedFiles: [],
	sampleFiles: [],
	computedAt: "2025-10-10T22:00:00Z",
};

/** Classification with a single frame type */
const singleTypeClassification: InboxClassifyResponse = {
	inboxItemId: "item-001",
	type: "single_type",
	frameType: "light",
	contentSignature: "sig-001",
	breakdown: [
		{
			kind: "light",
			count: 17,
			destinationPreview: "NGC7000/Ha/light/",
			sampleFiles: [],
		},
	],
	unclassifiedFiles: [],
	sampleFiles: [],
	computedAt: "2025-10-10T22:00:00Z",
};

/** Two-row fixture for the per-file metadata table (FR-010). */
const fileMetadataFixture: InboxFileMetadata[] = [
	{
		relativeFilePath: "light_0001.fits",
		frameTypeEffective: "light",
		imageTyp: "LIGHT",
		filter: "Ha",
		exposureS: 300,
		binningX: 1,
		binningY: 1,
		gain: "100",
		temperatureC: -10,
		object: "NGC7000",
		dateObs: "2025-10-10T22:00:00Z",
		instrume: "ASI2600MM",
		telescop: null,
		naxis1: 6248,
		naxis2: 4176,
		stackCount: null,
		isMaster: false,
		overrideStale: false,
	},
	{
		relativeFilePath: "calib_dark_0001.fits",
		frameTypeEffective: "dark",
		imageTyp: "DARK",
		filter: null,
		exposureS: null,
		binningX: 1,
		binningY: 1,
		gain: "100",
		temperatureC: null,
		object: null,
		dateObs: null,
		instrume: null,
		telescop: null,
		naxis1: null,
		naxis2: null,
		stackCount: 30,
		isMaster: true,
		overrideStale: false,
	},
];

// ── FR-011: Mixed composition summary ────────────────────────────────────────

describe("InboxDetail — FR-011: mixed composition summary", () => {
	it("renders an explicit per-type count string for mixed folders", () => {
		render(
			<InboxDetail
				item={
					sampleItem as unknown as Parameters<typeof InboxDetail>[0]["item"]
				}
				rootAbsolutePath="/astro/inbox"
				classification={
					mixedClassification as unknown as Parameters<
						typeof InboxDetail
					>[0]["classification"]
				}
			/>,
		);
		const summary = screen.getByLabelText("Mixed composition summary");
		expect(summary).toBeInTheDocument();
		expect(summary.textContent).toContain("12");
		expect(summary.textContent).toContain("light");
		expect(summary.textContent).toContain("4");
		expect(summary.textContent).toContain("dark");
		expect(summary.textContent).toContain("1");
		expect(summary.textContent).toContain("flat");
	});

	it("does NOT render a composition summary for single-type folders", () => {
		render(
			<InboxDetail
				item={
					sampleItem as unknown as Parameters<typeof InboxDetail>[0]["item"]
				}
				rootAbsolutePath="/astro/inbox"
				classification={
					singleTypeClassification as unknown as Parameters<
						typeof InboxDetail
					>[0]["classification"]
				}
			/>,
		);
		expect(
			screen.queryByLabelText("Mixed composition summary"),
		).not.toBeInTheDocument();
	});

	it("does NOT render a composition summary when classification is null", () => {
		render(
			<InboxDetail
				item={
					sampleItem as unknown as Parameters<typeof InboxDetail>[0]["item"]
				}
				rootAbsolutePath="/astro/inbox"
				classification={null}
			/>,
		);
		expect(
			screen.queryByLabelText("Mixed composition summary"),
		).not.toBeInTheDocument();
	});
});

// ── FR-010: Per-file metadata popover trigger ─────────────────────────────────
//
// The metadata table now lives inside a portaled Popover. The trigger button
// ("File metadata (N) ▾") is always visible when fileMetadata is provided.
// The table columns are inside the popup (not in the DOM until the popup is
// opened — base-ui portals), so tests assert the trigger and the table content
// that IS rendered in the document (the trigger renders unconditionally).

describe("InboxDetail — FR-010: file metadata popover trigger", () => {
	it("renders the popover trigger button when fileMetadata is provided", () => {
		render(
			<InboxDetail
				item={
					sampleItem as unknown as Parameters<typeof InboxDetail>[0]["item"]
				}
				rootAbsolutePath="/astro/inbox"
				classification={
					singleTypeClassification as unknown as Parameters<
						typeof InboxDetail
					>[0]["classification"]
				}
				fileMetadata={fileMetadataFixture}
			/>,
		);
		expect(
			screen.getByTestId("inbox-files-popover-trigger"),
		).toBeInTheDocument();
		expect(
			screen.getByTestId("inbox-files-popover-trigger").textContent,
		).toContain("File metadata (2)");
	});

	it("does NOT render the popover trigger when fileMetadata is absent", () => {
		render(
			<InboxDetail
				item={
					sampleItem as unknown as Parameters<typeof InboxDetail>[0]["item"]
				}
				rootAbsolutePath="/astro/inbox"
				classification={
					singleTypeClassification as unknown as Parameters<
						typeof InboxDetail
					>[0]["classification"]
				}
			/>,
		);
		expect(
			screen.queryByTestId("inbox-files-popover-trigger"),
		).not.toBeInTheDocument();
	});

	it("does NOT render the popover trigger when fileMetadata is an empty array", () => {
		render(
			<InboxDetail
				item={
					sampleItem as unknown as Parameters<typeof InboxDetail>[0]["item"]
				}
				rootAbsolutePath="/astro/inbox"
				classification={
					singleTypeClassification as unknown as Parameters<
						typeof InboxDetail
					>[0]["classification"]
				}
				fileMetadata={[]}
			/>,
		);
		expect(
			screen.queryByTestId("inbox-files-popover-trigger"),
		).not.toBeInTheDocument();
	});

	it("renders both the FR-011 composition summary and the FR-010 popover trigger simultaneously", () => {
		render(
			<InboxDetail
				item={
					sampleItem as unknown as Parameters<typeof InboxDetail>[0]["item"]
				}
				rootAbsolutePath="/astro/inbox"
				classification={
					mixedClassification as unknown as Parameters<
						typeof InboxDetail
					>[0]["classification"]
				}
				fileMetadata={fileMetadataFixture}
			/>,
		);
		expect(
			screen.getByLabelText("Mixed composition summary"),
		).toBeInTheDocument();
		expect(
			screen.getByTestId("inbox-files-popover-trigger"),
		).toBeInTheDocument();
	});

	it("opens the popup with the metadata table when the trigger is clicked", () => {
		render(
			<InboxDetail
				item={
					sampleItem as unknown as Parameters<typeof InboxDetail>[0]["item"]
				}
				rootAbsolutePath="/astro/inbox"
				classification={
					singleTypeClassification as unknown as Parameters<
						typeof InboxDetail
					>[0]["classification"]
				}
				fileMetadata={fileMetadataFixture}
			/>,
		);
		fireEvent.click(screen.getByTestId("inbox-files-popover-trigger"));
		// Popup should now be in the DOM (portaled to body).
		expect(screen.getByTestId("inbox-files-popup")).toBeInTheDocument();
		// File paths appear in the popup table.
		expect(screen.getByTitle("light_0001.fits")).toBeInTheDocument();
		expect(screen.getByTitle("calib_dark_0001.fits")).toBeInTheDocument();
	});

	it("popup contains the missing-attr badge for files that need it", () => {
		const withMissing: InboxFileMetadata[] = [
			{
				...fileMetadataFixture[0],
				relativeFilePath: "light_ok.fits",
				missingPathAttributes: [],
			},
			{
				...fileMetadataFixture[0],
				relativeFilePath: "light_nodate.fits",
				dateObs: null,
				missingPathAttributes: ["date"],
			},
		];
		render(
			<InboxDetail
				item={
					sampleItem as unknown as Parameters<typeof InboxDetail>[0]["item"]
				}
				rootAbsolutePath="/astro/inbox"
				classification={
					singleTypeClassification as unknown as Parameters<
						typeof InboxDetail
					>[0]["classification"]
				}
				fileMetadata={withMissing}
			/>,
		);
		fireEvent.click(screen.getByTestId("inbox-files-popover-trigger"));
		const badge = screen.getByTestId("inbox-missing-attr-light_nodate.fits");
		expect(badge).toHaveTextContent("needs date");
		expect(
			screen.queryByTestId("inbox-missing-attr-light_ok.fits"),
		).not.toBeInTheDocument();
	});
});

// ── FR-032 (US9): missing path-load-bearing attribute gate ───────────────────

describe("InboxDetail — FR-032: missing-attribute banner", () => {
	const withMissing: InboxFileMetadata[] = [
		{
			...fileMetadataFixture[0],
			relativeFilePath: "light_ok.fits",
			missingPathAttributes: [],
		},
		{
			...fileMetadataFixture[0],
			relativeFilePath: "light_nodate.fits",
			dateObs: null,
			missingPathAttributes: ["date"],
		},
	];

	it("shows a summary banner counting the blocked files", () => {
		render(
			<InboxDetail
				item={
					sampleItem as unknown as Parameters<typeof InboxDetail>[0]["item"]
				}
				rootAbsolutePath="/astro/inbox"
				classification={
					singleTypeClassification as unknown as Parameters<
						typeof InboxDetail
					>[0]["classification"]
				}
				fileMetadata={withMissing}
			/>,
		);
		expect(screen.getByTestId("inbox-missing-attr-banner")).toHaveTextContent(
			"1 file",
		);
	});

	it("renders no banner when no file is missing attributes", () => {
		render(
			<InboxDetail
				item={
					sampleItem as unknown as Parameters<typeof InboxDetail>[0]["item"]
				}
				rootAbsolutePath="/astro/inbox"
				classification={
					singleTypeClassification as unknown as Parameters<
						typeof InboxDetail
					>[0]["classification"]
				}
				fileMetadata={fileMetadataFixture}
			/>,
		);
		expect(
			screen.queryByTestId("inbox-missing-attr-banner"),
		).not.toBeInTheDocument();
	});
});

// ── task #34: mixed-folder — banner in body, action in header ────────────────

describe("InboxDetail — task #34: mixed-folder banner + header confirm action", () => {
	it('renders the mixed banner AND the confirm button (labelled "Generate split plan") in the header', () => {
		const onConfirm = vi.fn();
		render(
			<InboxDetail
				item={
					sampleItem as unknown as Parameters<typeof InboxDetail>[0]["item"]
				}
				rootAbsolutePath="/astro/inbox"
				classification={
					mixedClassification as unknown as Parameters<
						typeof InboxDetail
					>[0]["classification"]
				}
				onConfirm={onConfirm}
				confirmLabel="Generate split plan"
			/>,
		);
		expect(screen.getByTestId("inbox-mixed-alert")).toBeInTheDocument();
		const btn = screen.getByTestId("inbox-confirm-btn");
		expect(btn).toHaveTextContent("Generate split plan");
		fireEvent.click(btn);
		expect(onConfirm).toHaveBeenCalledTimes(1);
		// Button is NOT inside the banner.
		const banner = screen.getByTestId("inbox-mixed-alert");
		expect(
			banner.querySelector('[data-testid="inbox-confirm-btn"]'),
		).toBeNull();
	});

	it("disables the header confirm button while busy", () => {
		render(
			<InboxDetail
				item={
					sampleItem as unknown as Parameters<typeof InboxDetail>[0]["item"]
				}
				rootAbsolutePath="/astro/inbox"
				classification={
					mixedClassification as unknown as Parameters<
						typeof InboxDetail
					>[0]["classification"]
				}
				onConfirm={vi.fn()}
				confirmLabel="Generate split plan"
				confirmBusy
			/>,
		);
		expect(screen.getByTestId("inbox-confirm-btn")).toBeDisabled();
	});

	it("does not render the header confirm button when no callback is supplied", () => {
		render(
			<InboxDetail
				item={
					sampleItem as unknown as Parameters<typeof InboxDetail>[0]["item"]
				}
				rootAbsolutePath="/astro/inbox"
				classification={
					mixedClassification as unknown as Parameters<
						typeof InboxDetail
					>[0]["classification"]
				}
			/>,
		);
		expect(screen.getByTestId("inbox-mixed-alert")).toBeInTheDocument();
		expect(screen.queryByTestId("inbox-confirm-btn")).not.toBeInTheDocument();
	});

	it("does NOT render the mixed banner for single-type folders, but DOES render the confirm button", () => {
		render(
			<InboxDetail
				item={
					sampleItem as unknown as Parameters<typeof InboxDetail>[0]["item"]
				}
				rootAbsolutePath="/astro/inbox"
				classification={
					singleTypeClassification as unknown as Parameters<
						typeof InboxDetail
					>[0]["classification"]
				}
				onConfirm={vi.fn()}
			/>,
		);
		expect(screen.queryByTestId("inbox-mixed-alert")).not.toBeInTheDocument();
		// The unified confirm action (default label "Confirm to inventory") is the
		// per-detection primary action for single-type folders.
		expect(screen.getByTestId("inbox-confirm-btn")).toHaveTextContent(
			"Confirm to inventory",
		);
	});
});

// ── Compact layout: SessionDetail-style left-packed col ───────────────────────
//
// The body is a .alm-session-detail2 flex row.
// Col A: PropertyTable with detection facts + mixed-summary line + Files popover trigger.
// No breakdown table. No inline metadata col. No FileInspector in the row.

describe("InboxDetail — compact layout: detection col + popover trigger", () => {
	it("renders the alm-session-detail2 row wrapper", () => {
		const { container } = render(
			<InboxDetail
				item={
					sampleItem as unknown as Parameters<typeof InboxDetail>[0]["item"]
				}
				rootAbsolutePath="/astro/inbox"
				classification={
					singleTypeClassification as unknown as Parameters<
						typeof InboxDetail
					>[0]["classification"]
				}
				fileMetadata={fileMetadataFixture}
			/>,
		);
		expect(container.querySelector(".alm-session-detail2")).not.toBeNull();
		// No old 3-zone wrappers.
		expect(container.querySelector(".alm-detailpanel__facts")).toBeNull();
		expect(container.querySelector(".alm-detailpanel__aux")).toBeNull();
		// No inline metadata col (it lives in the popover).
		expect(container.querySelector(".alm-inbox-detail__meta-col")).toBeNull();
	});

	it("renders detection facts spread across multiple property columns", () => {
		const { container } = render(
			<InboxDetail
				item={
					sampleItem as unknown as Parameters<typeof InboxDetail>[0]["item"]
				}
				rootAbsolutePath="/astro/inbox"
				classification={
					singleTypeClassification as unknown as Parameters<
						typeof InboxDetail
					>[0]["classification"]
				}
				fileMetadata={fileMetadataFixture}
			/>,
		);
		// Left-packed multi-column body (Sessions convention): ≥2 columns.
		expect(
			container.querySelectorAll(".alm-session-detail2__col").length,
		).toBeGreaterThanOrEqual(2);
		// The Files column carries a head label (scoped to the head element —
		// "Files" also appears as a PropertyTable row label).
		const heads = [
			...container.querySelectorAll(".alm-session-detail2__head"),
		];
		expect(heads.some((h) => h.textContent === "Files")).toBe(true);
		// 'light' from frameType appears in the PropertyTable value.
		expect(screen.getAllByText(/light/).length).toBeGreaterThan(0);
	});

	it("mixed composition summary renders inside a detail column", () => {
		const { container } = render(
			<InboxDetail
				item={
					sampleItem as unknown as Parameters<typeof InboxDetail>[0]["item"]
				}
				rootAbsolutePath="/astro/inbox"
				classification={
					mixedClassification as unknown as Parameters<
						typeof InboxDetail
					>[0]["classification"]
				}
			/>,
		);
		const cols = [...container.querySelectorAll(".alm-session-detail2__col")];
		expect(cols.length).toBeGreaterThan(0);
		// Summary lives within one of the left-packed columns (the Files column).
		expect(
			cols.some(
				(c) =>
					c.querySelector('[aria-label="Mixed composition summary"]') != null,
			),
		).toBe(true);
	});

	it("files popover trigger renders inside a detail column", () => {
		const { container } = render(
			<InboxDetail
				item={
					sampleItem as unknown as Parameters<typeof InboxDetail>[0]["item"]
				}
				rootAbsolutePath="/astro/inbox"
				classification={
					singleTypeClassification as unknown as Parameters<
						typeof InboxDetail
					>[0]["classification"]
				}
				fileMetadata={fileMetadataFixture}
			/>,
		);
		const cols = [...container.querySelectorAll(".alm-session-detail2__col")];
		expect(
			cols.some(
				(c) =>
					c.querySelector('[data-testid="inbox-files-popover-trigger"]') !=
					null,
			),
		).toBe(true);
	});

	it("no breakdown table is rendered in the detail body", () => {
		const { container } = render(
			<InboxDetail
				item={
					sampleItem as unknown as Parameters<typeof InboxDetail>[0]["item"]
				}
				rootAbsolutePath="/astro/inbox"
				classification={
					mixedClassification as unknown as Parameters<
						typeof InboxDetail
					>[0]["classification"]
				}
			/>,
		);
		// The old frame-type breakdown table buttons are gone.
		expect(
			container.querySelector('[data-testid^="breakdown-filter-"]'),
		).toBeNull();
		expect(screen.queryByText("Frame type breakdown")).not.toBeInTheDocument();
	});
});
