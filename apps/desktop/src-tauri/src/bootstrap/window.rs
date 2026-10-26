// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Post-restore window geometry correction after `tauri-plugin-window-state`
//! restores a persisted size and position. Geometry policy is pure and tested
//! against synthetic monitor layouts; this module adapts it to Tauri windows.

const MIN_WIDTH: u32 = 1280;
const MIN_HEIGHT: u32 = 640;

/// A screen-space rectangle in physical pixels. Positions are signed because
/// monitors left of / above the primary have negative origins.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
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

    fn right(self) -> i64 {
        i64::from(self.x) + i64::from(self.width)
    }

    fn bottom(self) -> i64 {
        i64::from(self.y) + i64::from(self.height)
    }

    fn overlap_area(self, other: Self) -> u64 {
        let width = (self.right().min(other.right()) - i64::from(self.x.max(other.x))).max(0);
        let height = (self.bottom().min(other.bottom()) - i64::from(self.y.max(other.y))).max(0);
        u64::try_from(width).unwrap_or_default() * u64::try_from(height).unwrap_or_default()
    }
}

/// Clamp a restored window into its best-overlapping work area. If no area
/// overlaps the saved rectangle, use the primary monitor; if that is not
/// available, use the first connected monitor. Oversized windows shrink to
/// the work area, while small windows grow to the configured minimum unless
/// the monitor itself is smaller.
fn clamp_window_geometry(window: Rect, work_areas: &[Rect], primary: Option<Rect>) -> Option<Rect> {
    let mut best: Option<(Rect, u64)> = None;
    for &area in work_areas {
        let overlap = window.overlap_area(area);
        if overlap > best.map_or(0, |(_, best_overlap)| best_overlap) {
            best = Some((area, overlap));
        }
    }

    let (area, overlaps) = match best.filter(|(_, overlap)| *overlap > 0) {
        Some(best) => best,
        None => (primary.or_else(|| work_areas.first().copied())?, 0),
    };
    let width = window.width.max(MIN_WIDTH.min(area.width)).min(area.width);
    let height = window.height.max(MIN_HEIGHT.min(area.height)).min(area.height);
    let (x, y) = if overlaps > 0 {
        (
            i64::from(window.x).clamp(i64::from(area.x), area.right() - i64::from(width)),
            i64::from(window.y).clamp(i64::from(area.y), area.bottom() - i64::from(height)),
        )
    } else {
        (i64::from(area.x), i64::from(area.y))
    };

    Some(Rect::new(
        i32::try_from(x).unwrap_or(if x < 0 { i32::MIN } else { i32::MAX }),
        i32::try_from(y).unwrap_or(if y < 0 { i32::MIN } else { i32::MAX }),
        width,
        height,
    ))
}

fn work_area_rect(monitor: &tauri::Monitor) -> Rect {
    let area = monitor.work_area();
    Rect::new(area.position.x, area.position.y, area.size.width, area.size.height)
}

#[expect(
    clippy::cognitive_complexity,
    reason = "sequentially applying the three returned window geometry settings"
)]
fn apply_geometry(window: &tauri::WebviewWindow, current: Rect, clamped: Rect) {
    if clamped.width < MIN_WIDTH || clamped.height < MIN_HEIGHT {
        let minimum =
            tauri::PhysicalSize::new(MIN_WIDTH.min(clamped.width), MIN_HEIGHT.min(clamped.height));
        if let Err(error) = window.set_min_size(Some(minimum)) {
            tracing::warn!("failed to adjust minimum window size for a small monitor: {error:?}");
        }
    }
    if clamped.width != current.width || clamped.height != current.height {
        let size = tauri::Size::Physical(tauri::PhysicalSize::new(clamped.width, clamped.height));
        if let Err(error) = window.set_size(size) {
            tracing::warn!("failed to clamp restored window size: {error:?}");
        }
    }
    if clamped.x != current.x || clamped.y != current.y {
        let position =
            tauri::Position::Physical(tauri::PhysicalPosition::new(clamped.x, clamped.y));
        if let Err(error) = window.set_position(position) {
            tracing::warn!("failed to clamp restored window position: {error:?}");
        }
    }
}

/// Correct geometry restored by the window-state plugin on window-ready.
pub fn clamp_restored_window(window: &tauri::WebviewWindow) {
    let Ok(position) = window.outer_position() else { return };
    let Ok(size) = window.outer_size() else { return };
    let Ok(monitors) = window.available_monitors() else { return };
    let Ok(primary) = window.primary_monitor() else { return };
    let current = Rect::new(position.x, position.y, size.width, size.height);
    let work_areas: Vec<Rect> = monitors.iter().map(work_area_rect).collect();
    let primary = primary.as_ref().map(work_area_rect);
    if let Some(clamped) = clamp_window_geometry(current, &work_areas, primary) {
        apply_geometry(window, current, clamped);
    }
}

#[cfg(test)]
mod tests {
    use super::{clamp_window_geometry, Rect, MIN_HEIGHT, MIN_WIDTH};

    fn primary() -> Rect {
        Rect::new(0, 0, 1920, 1080)
    }

    fn clamp(window: Rect, screens: &[Rect], primary: Option<Rect>) -> Rect {
        clamp_window_geometry(window, screens, primary).unwrap()
    }

    #[test]
    fn moves_a_window_offscreen_to_the_left_onto_the_primary() {
        assert_eq!(
            clamp(Rect::new(-2000, 100, 1280, 640), &[primary()], Some(primary())),
            Rect::new(0, 0, 1280, 640)
        );
    }

    #[test]
    fn moves_a_window_offscreen_to_the_right_onto_the_primary() {
        assert_eq!(
            clamp(Rect::new(2000, 100, 1280, 640), &[primary()], Some(primary())),
            Rect::new(0, 0, 1280, 640)
        );
    }

    #[test]
    fn moves_a_window_offscreen_below_the_primary() {
        assert_eq!(
            clamp(Rect::new(100, 1200, 1280, 640), &[primary()], Some(primary())),
            Rect::new(0, 0, 1280, 640)
        );
    }

    #[test]
    fn pulls_a_partly_offscreen_window_fully_into_the_work_area() {
        assert_eq!(
            clamp(Rect::new(1800, 100, 1280, 640), &[primary()], Some(primary())),
            Rect::new(640, 100, 1280, 640)
        );
    }

    #[test]
    fn shrinks_a_window_larger_than_the_screen() {
        assert_eq!(clamp(Rect::new(-1, -1, 3000, 2000), &[primary()], Some(primary())), primary());
    }

    #[test]
    fn permits_a_screen_smaller_than_the_minimum_size() {
        let small_screen = Rect::new(0, 0, 1024, 600);
        assert!(small_screen.width < MIN_WIDTH && small_screen.height < MIN_HEIGHT);
        assert_eq!(
            clamp(Rect::new(100, 100, 600, 400), &[small_screen], Some(small_screen)),
            small_screen
        );
    }

    #[test]
    fn clamps_on_a_secondary_monitor_with_negative_coordinates() {
        let left = Rect::new(-1920, 0, 1920, 1080);
        assert_eq!(
            clamp(Rect::new(-1800, 1000, 1280, 640), &[left, primary()], Some(primary())),
            Rect::new(-1800, 440, 1280, 640)
        );
    }

    #[test]
    fn falls_back_to_first_monitor_when_primary_is_unavailable() {
        let screen = Rect::new(-1920, 0, 1920, 1080);
        assert_eq!(
            clamp(Rect::new(4000, 4000, 1280, 640), &[screen], None),
            Rect::new(-1920, 0, 1280, 640)
        );
    }

    #[test]
    fn leaves_geometry_unchanged_when_no_monitor_is_connected() {
        assert_eq!(clamp_window_geometry(Rect::new(4, 5, 6, 7), &[], None), None);
    }
}
