// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Post-restore window geometry corrections (spec 051 US4), applied after
//! `tauri-plugin-window-state` restores a persisted size/position.
//!
//! The geometry decisions live in [`clamp_to_min_size`] and [`Rect`] so they
//! can be tested against synthetic monitor layouts; the `tauri`-typed
//! functions only read the live window and apply the result.

/// `tauri.conf.json`'s `minWidth`/`minHeight`. Duplicated here because the
/// restored size arrives from the window-state plugin's store, not the config.
const MIN_WIDTH: u32 = 1100;
const MIN_HEIGHT: u32 = 720;

/// Raise a restored size to the configured floor, per axis independently.
const fn clamp_to_min_size(width: u32, height: u32) -> (u32, u32) {
    (
        if width < MIN_WIDTH { MIN_WIDTH } else { width },
        if height < MIN_HEIGHT { MIN_HEIGHT } else { height },
    )
}

/// A screen-space rectangle in physical pixels. Positions are signed because
/// monitors left of / above the primary have negative origins.
#[derive(Debug, Clone, Copy)]
struct Rect {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

impl Rect {
    const fn new(x: i32, y: i32, width: u32, height: u32) -> Self {
        Self { x, y, width, height }
    }

    /// Saturating so an absurd persisted size cannot overflow the addition and
    /// panic in a debug build; a saturated edge still compares correctly.
    fn right(self) -> i32 {
        self.x.saturating_add(i32::try_from(self.width).unwrap_or(i32::MAX))
    }

    fn bottom(self) -> i32 {
        self.y.saturating_add(i32::try_from(self.height).unwrap_or(i32::MAX))
    }

    /// Strict overlap: rectangles that merely share an edge do not intersect,
    /// so a window resting exactly against a monitor's outer edge counts as
    /// off-screen and gets recentered.
    fn intersects(&self, other: &Self) -> bool {
        self.x < other.right()
            && self.right() > other.x
            && self.y < other.bottom()
            && self.bottom() > other.y
    }
}

/// Enforce the min-size floor (spec 051 US4, T029) after
/// `tauri-plugin-window-state` restores a persisted size, in case a prior
/// app version persisted a smaller size than the current `tauri.conf.json`
/// `minWidth`/`minHeight` (1100x720) — mirrors the `astro-up` reference's own
/// explicit post-restore clamp (research.md's cited `lib.rs` excerpt).
pub fn enforce_min_window_size(window: &tauri::WebviewWindow) {
    if let Ok(size) = window.inner_size() {
        let (w, h) = clamp_to_min_size(size.width, size.height);
        if w != size.width || h != size.height {
            if let Err(e) = window.set_size(tauri::Size::Physical(tauri::PhysicalSize::new(w, h))) {
                tracing::warn!("failed to enforce minimum window size: {e:?}");
            } else {
                tracing::info!(width = w, height = h, "enforced minimum window size");
            }
        }
    }
}

/// Off-screen-position fallback (spec 051 US4, T030/FR-013): if the restored
/// position has no overlap with any currently-connected display (e.g. a
/// second monitor the window was on has since been disconnected), recenter
/// the window instead of leaving it stranded off-screen.
pub fn recenter_if_offscreen(window: &tauri::WebviewWindow) {
    let (Ok(pos), Ok(size), Ok(monitors)) =
        (window.outer_position(), window.outer_size(), window.available_monitors())
    else {
        return;
    };

    let win = Rect::new(pos.x, pos.y, size.width, size.height);
    let on_screen = monitors.iter().any(|m| {
        win.intersects(&Rect::new(m.position().x, m.position().y, m.size().width, m.size().height))
    });

    if !on_screen {
        if let Err(e) = window.center() {
            tracing::warn!("failed to recenter off-screen window: {e:?}");
        } else {
            tracing::info!("restored window position was off-screen; recentered");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{clamp_to_min_size, Rect, MIN_HEIGHT, MIN_WIDTH};

    /// A monitor layout with the primary at the origin and a second display
    /// positioned to its left, which is where negative coordinates come from.
    fn dual_monitors() -> [Rect; 2] {
        [Rect::new(0, 0, 1920, 1080), Rect::new(-1920, 0, 1920, 1080)]
    }

    fn on_any(win: Rect, monitors: &[Rect]) -> bool {
        monitors.iter().any(|m| win.intersects(m))
    }

    #[test]
    fn clamp_raises_each_axis_independently() {
        assert_eq!(clamp_to_min_size(800, 900), (MIN_WIDTH, 900));
        assert_eq!(clamp_to_min_size(1600, 400), (1600, MIN_HEIGHT));
    }

    #[test]
    fn clamp_never_shrinks_an_oversized_window() {
        assert_eq!(clamp_to_min_size(3840, 2160), (3840, 2160));
    }

    #[test]
    fn window_on_the_secondary_monitor_is_on_screen() {
        assert!(on_any(Rect::new(-1800, 100, 1280, 800), &dual_monitors()));
    }

    /// The failure this guard exists for: the display the window was parked on
    /// is gone, so only the primary remains and the position is stranded.
    #[test]
    fn window_is_offscreen_once_its_monitor_disconnects() {
        let win = Rect::new(-1800, 100, 1280, 800);
        assert!(on_any(win, &dual_monitors()));
        assert!(!on_any(win, &[Rect::new(0, 0, 1920, 1080)]));
    }

    #[test]
    fn window_straddling_two_monitors_is_on_screen() {
        assert!(on_any(Rect::new(-200, 100, 1280, 800), &dual_monitors()));
    }

    #[test]
    fn window_touching_a_monitor_edge_counts_as_offscreen() {
        // Right edge lands exactly on the monitor's left edge: zero overlap.
        assert!(!on_any(Rect::new(-1280, 100, 1280, 800), &[Rect::new(0, 0, 1920, 1080)]));
        // One pixel of overlap is enough to keep it on-screen.
        assert!(on_any(Rect::new(-1279, 100, 1280, 800), &[Rect::new(0, 0, 1920, 1080)]));
    }

    #[test]
    fn window_below_every_monitor_is_offscreen() {
        assert!(!on_any(Rect::new(100, 4000, 1280, 800), &dual_monitors()));
    }

    #[test]
    fn no_connected_monitors_means_offscreen() {
        assert!(!on_any(Rect::new(0, 0, 1280, 800), &[]));
    }

    /// A corrupt persisted size must not overflow the edge arithmetic and
    /// panic in a debug build; it saturates and the window still gets judged.
    #[test]
    fn absurd_persisted_size_saturates_instead_of_overflowing() {
        let win = Rect::new(i32::MAX - 1, 0, u32::MAX, u32::MAX);
        assert_eq!(win.right(), i32::MAX);
        assert!(!on_any(win, &dual_monitors()));
    }
}
