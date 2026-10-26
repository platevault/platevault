// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Post-restore window geometry correction after `tauri-plugin-window-state`
//! restores a persisted size and position. [`fit`] is a pure function of a
//! [`Snapshot`] of the window and the monitors' work areas, tested against
//! synthetic layouts. The Tauri adapter below reads that snapshot, decides when
//! it can be trusted, and applies the returned [`Placement`].

use std::cell::Cell;

use tauri::{Manager, WebviewWindow};

/// Differences up to half a pixel are rounding from converting physical pixels
/// to logical points, not geometry.
const TOLERANCE: f64 = 0.5;

/// Only Windows applies the restored geometry before the plugin's restore task
/// returns. tao applies it on macOS through the main dispatch queue
/// (`set_content_size_async`, `set_frame_top_left_point_async`) and on Linux
/// through GTK requests, so on those a snapshot taken right after the restore
/// still shows the default geometry (macOS) or a stale cache (Linux).
const RESTORE_APPLIES_AT_ONCE: bool = cfg!(windows);

#[derive(Debug, Clone, Copy, PartialEq)]
struct Size {
    width: f64,
    height: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct Point {
    x: f64,
    y: f64,
}

/// A screen-space rectangle. Positions are signed because monitors left of or
/// above the primary have negative origins.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Rect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl Rect {
    fn right(self) -> f64 {
        self.x + self.width
    }

    fn bottom(self) -> f64 {
        self.y + self.height
    }

    fn overlap_area(self, other: Self) -> f64 {
        let width = (self.right().min(other.right()) - self.x.max(other.x)).max(0.0);
        let height = (self.bottom().min(other.bottom()) - self.y.max(other.y)).max(0.0);
        width * height
    }
}

/// A monitor's work area as Tauri reports it: physical pixels, with that
/// monitor's scale factor.
#[derive(Debug, Clone, Copy, PartialEq)]
struct WorkArea {
    rect: Rect,
    scale: f64,
}

/// The live window as Tauri reports it: physical pixels, with the window's
/// scale factor. `outer` includes the title bar and borders; `inner` is the
/// client area that `set_size` and `set_min_size` address.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Snapshot {
    outer: Rect,
    inner: Size,
    scale: f64,
    maximized: bool,
    fullscreen: bool,
}

/// The unit in which Tauri's window and monitor rectangles line up.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Desktop {
    /// Windows: one physical pixel grid spans every monitor.
    Physical,
    /// macOS and Linux: Tauri reports each monitor in logical points times that
    /// monitor's scale factor, and the window times the window's, so only
    /// logical points line up across monitors of different density.
    Logical,
}

impl Desktop {
    const CURRENT: Self = if cfg!(windows) { Self::Physical } else { Self::Logical };

    /// A physical length measured at `scale`, in desktop units.
    fn physical_length(self, length: f64, scale: f64) -> f64 {
        match self {
            Self::Physical => length,
            Self::Logical => length / scale,
        }
    }

    /// A logical length on a monitor of `scale`, in desktop units.
    fn logical_length(self, length: f64, scale: f64) -> f64 {
        match self {
            Self::Physical => length * scale,
            Self::Logical => length,
        }
    }

    fn rect(self, rect: Rect, scale: f64) -> Rect {
        Rect {
            x: self.physical_length(rect.x, scale),
            y: self.physical_length(rect.y, scale),
            width: self.physical_length(rect.width, scale),
            height: self.physical_length(rect.height, scale),
        }
    }

    fn size(self, size: Size, scale: f64) -> Size {
        Size {
            width: self.physical_length(size.width, scale),
            height: self.physical_length(size.height, scale),
        }
    }

    fn tauri_size(self, size: Size) -> tauri::Size {
        match self {
            Self::Physical => tauri::PhysicalSize::new(size.width, size.height).into(),
            Self::Logical => tauri::LogicalSize::new(size.width, size.height).into(),
        }
    }

    fn tauri_position(self, point: Point) -> tauri::Position {
        match self {
            Self::Physical => tauri::PhysicalPosition::new(point.x, point.y).into(),
            Self::Logical => tauri::LogicalPosition::new(point.x, point.y).into(),
        }
    }
}

/// What [`fit`] decided for one snapshot.
#[derive(Debug, Clone, Copy, PartialEq)]
enum Fit {
    /// Tauri's geometry cache has not caught up with the window. GTK fills it
    /// only from configure events, and before the first one the cached outer
    /// size is the window's position, smaller than its inner size.
    Stale,
    /// Maximized or fullscreen: the OS owns the geometry, and moving or
    /// resizing the window would drop that state.
    OsManaged,
    /// No monitor is connected, so there is nothing to fit into.
    NoMonitor,
    Place(Placement),
}

/// The changes that fit the window, in desktop units. `None` already fits.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
struct Placement {
    /// A smaller inner minimum, set when the work area leaves less room than
    /// the configured one. It stays relaxed for the session, also if the window
    /// moves to a larger monitor later.
    min_inner: Option<Size>,
    inner: Option<Size>,
    position: Option<Point>,
}

/// The work area a window is fitted into, in desktop units.
struct Target {
    area: Rect,
    scale: f64,
    overlaps: bool,
}

/// The work area sharing the most area with `outer`. When none overlaps it, the
/// primary monitor's, else the first connected one's.
fn target_area(
    outer: Rect,
    work_areas: &[WorkArea],
    primary: Option<WorkArea>,
    desktop: Desktop,
) -> Option<Target> {
    let mut best: Option<(WorkArea, f64)> = None;
    for &area in work_areas {
        let overlap = outer.overlap_area(desktop.rect(area.rect, area.scale));
        if overlap > best.map_or(0.0, |(_, best_overlap)| best_overlap) {
            best = Some((area, overlap));
        }
    }
    let (area, overlaps) = match best {
        Some((area, _)) => (area, true),
        None => (primary.or_else(|| work_areas.first().copied())?, false),
    };
    Some(Target { area: desktop.rect(area.rect, area.scale), scale: area.scale, overlaps })
}

/// Fit a window into its target work area (see [`target_area`]). The inner size
/// grows to `minimum`, in logical pixels, and shrinks until the outer frame
/// fits the work area; the minimum gives way where the work area is smaller.
/// A window overlapping its work area slides fully inside it; one overlapping
/// none moves to the work area's top-left corner.
fn fit(
    window: &Snapshot,
    work_areas: &[WorkArea],
    primary: Option<WorkArea>,
    minimum: Size,
    desktop: Desktop,
) -> Fit {
    if window.outer.width < window.inner.width || window.outer.height < window.inner.height {
        return Fit::Stale;
    }
    if window.maximized || window.fullscreen {
        return Fit::OsManaged;
    }
    let outer = desktop.rect(window.outer, window.scale);
    let inner = desktop.size(window.inner, window.scale);
    let frame = Size { width: outer.width - inner.width, height: outer.height - inner.height };
    let Some(target) = target_area(outer, work_areas, primary, desktop) else {
        return Fit::NoMonitor;
    };
    let area = target.area;
    let minimum = Size {
        width: desktop.logical_length(minimum.width, target.scale),
        height: desktop.logical_length(minimum.height, target.scale),
    };
    let room = Size {
        width: (area.width - frame.width).max(0.0),
        height: (area.height - frame.height).max(0.0),
    };
    let fitted = Size {
        width: inner.width.max(minimum.width).min(room.width),
        height: inner.height.max(minimum.height).min(room.height),
    };
    let position = if target.overlaps {
        Point {
            x: outer.x.min(area.right() - fitted.width - frame.width).max(area.x),
            y: outer.y.min(area.bottom() - fitted.height - frame.height).max(area.y),
        }
    } else {
        Point { x: area.x, y: area.y }
    };
    let relax = room.width < minimum.width - TOLERANCE || room.height < minimum.height - TOLERANCE;
    Fit::Place(Placement {
        min_inner: relax.then(|| Size {
            width: minimum.width.min(room.width),
            height: minimum.height.min(room.height),
        }),
        inner: (differs(fitted.width, inner.width) || differs(fitted.height, inner.height))
            .then_some(fitted),
        position: (differs(position.x, outer.x) || differs(position.y, outer.y))
            .then_some(position),
    })
}

fn differs(a: f64, b: f64) -> bool {
    (a - b).abs() > TOLERANCE
}

fn snapshot(window: &WebviewWindow) -> tauri::Result<Snapshot> {
    let position = window.outer_position()?;
    let outer = window.outer_size()?;
    let inner = window.inner_size()?;
    Ok(Snapshot {
        outer: Rect {
            x: f64::from(position.x),
            y: f64::from(position.y),
            width: f64::from(outer.width),
            height: f64::from(outer.height),
        },
        inner: Size { width: f64::from(inner.width), height: f64::from(inner.height) },
        scale: window.scale_factor()?,
        maximized: window.is_maximized()?,
        fullscreen: window.is_fullscreen()?,
    })
}

fn work_area(monitor: &tauri::Monitor) -> WorkArea {
    let area = monitor.work_area();
    WorkArea {
        rect: Rect {
            x: f64::from(area.position.x),
            y: f64::from(area.position.y),
            width: f64::from(area.size.width),
            height: f64::from(area.size.height),
        },
        scale: monitor.scale_factor(),
    }
}

/// The window's `minWidth`/`minHeight` from `tauri.conf.json`, in logical pixels.
fn configured_minimum(window: &WebviewWindow) -> Size {
    let config = window.config().app.windows.iter().find(|config| config.label == window.label());
    Size {
        width: config.and_then(|config| config.min_width).unwrap_or_default(),
        height: config.and_then(|config| config.min_height).unwrap_or_default(),
    }
}

fn warn_on_failure(result: tauri::Result<()>, action: &str) {
    if let Err(error) = result {
        tracing::warn!("failed to {action}: {error:?}");
    }
}

fn apply(window: &WebviewWindow, placement: Placement) {
    let desktop = Desktop::CURRENT;
    // Relax the minimum first: the OS would refuse a size below it.
    if let Some(minimum) = placement.min_inner {
        warn_on_failure(
            window.set_min_size(Some(desktop.tauri_size(minimum))),
            "relax the minimum window size for a small monitor",
        );
    }
    if let Some(size) = placement.inner {
        warn_on_failure(window.set_size(desktop.tauri_size(size)), "fit the restored window size");
    }
    if let Some(position) = placement.position {
        warn_on_failure(
            window.set_position(desktop.tauri_position(position)),
            "move the restored window onto a monitor",
        );
    }
    if placement.inner.is_some() || placement.position.is_some() {
        tracing::info!(?placement, "fitted the restored window into its work area");
    }
}

/// Fit `window` into its work area now, and report what [`fit`] decided.
fn fit_now(window: &WebviewWindow) -> tauri::Result<Fit> {
    let snapshot = snapshot(window)?;
    let work_areas: Vec<WorkArea> = window.available_monitors()?.iter().map(work_area).collect();
    let primary = window.primary_monitor()?.as_ref().map(work_area);
    let decision =
        fit(&snapshot, &work_areas, primary, configured_minimum(window), Desktop::CURRENT);
    tracing::debug!(?snapshot, ?decision, "restored window geometry");
    if let Fit::Place(placement) = decision {
        apply(window, placement);
    }
    Ok(decision)
}

/// How far the correction has got while it waits for the window's real
/// geometry. `main` stays hidden until the splash shows it, so while it is
/// hidden only the restore and this correction move it; once it is shown, its
/// geometry is the user's.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Watch {
    /// No fit has run on real geometry yet.
    Waiting,
    /// A fit ran on real geometry while the window was hidden.
    FittedHidden,
    Done,
}

impl Watch {
    /// The watch after one window event of any kind, seen while the window was
    /// `visible`. It calls `fit` unless the watch is over or the window was
    /// fitted before it was shown, so the first event after showing ends the
    /// watch and a move or resize there stays the user's. Stale geometry keeps
    /// the watch waiting. `fit` returns `None` when the geometry cannot be
    /// read, which ends the watch.
    fn after_event(self, visible: bool, fit: impl FnOnce() -> Option<Fit>) -> Self {
        match self {
            Self::Done => Self::Done,
            Self::FittedHidden if visible => Self::Done,
            Self::Waiting | Self::FittedHidden => match fit() {
                Some(Fit::Stale) => self,
                Some(_) if !visible => Self::FittedHidden,
                Some(_) | None => Self::Done,
            },
        }
    }
}

/// Fit `window` on its window events until [`Watch`] is done.
fn fit_when_settled(window: &WebviewWindow) {
    let watch = Cell::new(Watch::Waiting);
    let target = window.clone();
    window.on_window_event(move |_| {
        if watch.get() == Watch::Done {
            return;
        }
        let visible = target.is_visible().unwrap_or(true);
        watch.set(watch.get().after_event(visible, || {
            fit_now(&target)
                .inspect_err(|error| {
                    tracing::warn!("failed to read the restored window geometry: {error:?}");
                })
                .ok()
        }));
    });
}

/// Fit the window into a visible work area once `tauri-plugin-window-state`
/// has restored it. Call on the main thread, queued behind the plugin's
/// window-ready restore hook.
pub fn clamp_restored_window(window: &WebviewWindow) {
    if RESTORE_APPLIES_AT_ONCE {
        match fit_now(window) {
            Ok(Fit::Stale) => {}
            Ok(_) => return,
            Err(error) => {
                tracing::warn!("failed to read the restored window geometry: {error:?}");
                return;
            }
        }
    }
    fit_when_settled(window);
}

#[cfg(test)]
mod tests {
    use super::{fit, Desktop, Fit, Placement, Point, Rect, Size, Snapshot, Watch, WorkArea};

    const MINIMUM: Size = Size { width: 1280.0, height: 640.0 };

    const fn rect(x: f64, y: f64, width: f64, height: f64) -> Rect {
        Rect { x, y, width, height }
    }

    const fn area(rect: Rect, scale: f64) -> WorkArea {
        WorkArea { rect, scale }
    }

    fn primary() -> WorkArea {
        area(rect(0.0, 0.0, 1920.0, 1080.0), 1.0)
    }

    /// A window without a frame at 1x, as the macOS shell reports `main`.
    const fn frameless(outer: Rect) -> Snapshot {
        Snapshot {
            outer,
            inner: Size { width: outer.width, height: outer.height },
            scale: 1.0,
            maximized: false,
            fullscreen: false,
        }
    }

    fn place(window: Snapshot, work_areas: &[WorkArea], primary: Option<WorkArea>) -> Placement {
        place_in(window, work_areas, primary, Desktop::Physical)
    }

    fn place_in(
        window: Snapshot,
        work_areas: &[WorkArea],
        primary: Option<WorkArea>,
        desktop: Desktop,
    ) -> Placement {
        match fit(&window, work_areas, primary, MINIMUM, desktop) {
            Fit::Place(placement) => placement,
            other => panic!("expected a placement, got {other:?}"),
        }
    }

    fn moved_to(x: f64, y: f64) -> Placement {
        Placement { position: Some(Point { x, y }), ..Placement::default() }
    }

    #[test]
    fn leaves_a_window_that_fits_unchanged() {
        let window = frameless(rect(100.0, 100.0, 1280.0, 820.0));
        assert_eq!(place(window, &[primary()], Some(primary())), Placement::default());
    }

    #[test]
    fn moves_a_window_offscreen_to_the_left_onto_the_primary() {
        let window = frameless(rect(-2000.0, 100.0, 1280.0, 640.0));
        assert_eq!(place(window, &[primary()], Some(primary())), moved_to(0.0, 0.0));
    }

    #[test]
    fn moves_a_window_offscreen_to_the_right_onto_the_primary() {
        let window = frameless(rect(2000.0, 100.0, 1280.0, 640.0));
        assert_eq!(place(window, &[primary()], Some(primary())), moved_to(0.0, 0.0));
    }

    #[test]
    fn moves_a_window_offscreen_below_the_primary() {
        let window = frameless(rect(100.0, 1200.0, 1280.0, 640.0));
        assert_eq!(place(window, &[primary()], Some(primary())), moved_to(0.0, 0.0));
    }

    #[test]
    fn pulls_a_partly_offscreen_window_fully_into_the_work_area() {
        let window = frameless(rect(1800.0, 100.0, 1280.0, 640.0));
        assert_eq!(place(window, &[primary()], Some(primary())), moved_to(640.0, 100.0));
    }

    #[test]
    fn shrinks_a_window_larger_than_the_screen() {
        let window = frameless(rect(-1.0, -1.0, 3000.0, 2000.0));
        assert_eq!(
            place(window, &[primary()], Some(primary())),
            Placement { inner: Some(Size { width: 1920.0, height: 1080.0 }), ..moved_to(0.0, 0.0) }
        );
    }

    #[test]
    fn grows_a_small_window_to_the_minimum() {
        let window = frameless(rect(100.0, 100.0, 800.0, 500.0));
        assert_eq!(
            place(window, &[primary()], Some(primary())),
            Placement { inner: Some(MINIMUM), ..Placement::default() }
        );
    }

    #[test]
    fn permits_a_screen_smaller_than_the_minimum_size() {
        let small = area(rect(0.0, 0.0, 1024.0, 600.0), 1.0);
        let screen = Size { width: 1024.0, height: 600.0 };
        let window = frameless(rect(100.0, 100.0, 600.0, 400.0));
        assert_eq!(
            place(window, &[small], Some(small)),
            Placement { min_inner: Some(screen), inner: Some(screen), ..moved_to(0.0, 0.0) }
        );
    }

    #[test]
    fn clamps_on_a_secondary_monitor_with_negative_coordinates() {
        let left = area(rect(-1920.0, 0.0, 1920.0, 1080.0), 1.0);
        let window = frameless(rect(-1800.0, 1000.0, 1280.0, 640.0));
        assert_eq!(place(window, &[left, primary()], Some(primary())), moved_to(-1800.0, 440.0));
    }

    /// The left monitor is listed first, so taking the first overlapping work
    /// area would keep the window on the left one.
    #[test]
    fn fits_onto_the_monitor_holding_most_of_the_window() {
        let left = area(rect(-1920.0, 0.0, 1920.0, 1080.0), 1.0);
        let window = frameless(rect(-400.0, 100.0, 1280.0, 640.0));
        assert_eq!(place(window, &[left, primary()], Some(primary())), moved_to(0.0, 100.0));
    }

    #[test]
    fn falls_back_to_first_monitor_when_primary_is_unavailable() {
        let screen = area(rect(-1920.0, 0.0, 1920.0, 1080.0), 1.0);
        let window = frameless(rect(4000.0, 4000.0, 1280.0, 640.0));
        assert_eq!(place(window, &[screen], None), moved_to(-1920.0, 0.0));
    }

    #[test]
    fn leaves_geometry_unchanged_when_no_monitor_is_connected() {
        let window = frameless(rect(4.0, 5.0, 6.0, 7.0));
        assert_eq!(fit(&window, &[], None, MINIMUM, Desktop::Physical), Fit::NoMonitor);
    }

    #[test]
    fn copes_with_an_absurd_persisted_geometry() {
        let max_x = f64::from(i32::MAX);
        let max_size = f64::from(u32::MAX);
        let window = frameless(rect(max_x, max_x, max_size, max_size));
        assert_eq!(
            place(window, &[primary()], Some(primary())),
            Placement { inner: Some(Size { width: 1920.0, height: 1080.0 }), ..moved_to(0.0, 0.0) }
        );
    }

    /// Windows reports a maximized window's outer frame hanging past the work
    /// area, and `set_size` or `set_position` would clear the maximized state.
    #[test]
    fn leaves_a_maximized_window_to_the_os() {
        let window = Snapshot {
            maximized: true,
            inner: Size { width: 1920.0, height: 1009.0 },
            ..frameless(rect(-8.0, -8.0, 1936.0, 1056.0))
        };
        let taskbar_above = area(rect(0.0, 0.0, 1920.0, 1040.0), 1.0);
        assert_eq!(
            fit(&window, &[taskbar_above], None, MINIMUM, Desktop::Physical),
            Fit::OsManaged
        );
    }

    #[test]
    fn leaves_a_fullscreen_window_to_the_os() {
        let window = Snapshot { fullscreen: true, ..frameless(rect(0.0, 0.0, 1920.0, 1080.0)) };
        let taskbar_above = area(rect(0.0, 0.0, 1920.0, 1040.0), 1.0);
        assert_eq!(
            fit(&window, &[taskbar_above], None, MINIMUM, Desktop::Physical),
            Fit::OsManaged
        );
    }

    /// `set_size` sets the inner size, so the shrunk inner size leaves room for
    /// the 16 x 39 px frame around it.
    #[test]
    fn subtracts_the_frame_when_shrinking_to_the_work_area() {
        let window = Snapshot {
            inner: Size { width: 1920.0, height: 1061.0 },
            ..frameless(rect(0.0, 0.0, 1936.0, 1100.0))
        };
        let taskbar_above = area(rect(0.0, 0.0, 1920.0, 1040.0), 1.0);
        assert_eq!(
            place(window, &[taskbar_above], None),
            Placement {
                inner: Some(Size { width: 1904.0, height: 1001.0 }),
                ..Placement::default()
            }
        );
    }

    #[test]
    fn subtracts_the_frame_from_a_relaxed_minimum() {
        let window = Snapshot {
            inner: Size { width: 1000.0, height: 500.0 },
            ..frameless(rect(100.0, 100.0, 1016.0, 539.0))
        };
        let small = area(rect(0.0, 0.0, 1024.0, 600.0), 1.0);
        let room = Size { width: 1008.0, height: 561.0 };
        assert_eq!(
            place(window, &[small], Some(small)),
            Placement { min_inner: Some(room), inner: Some(room), ..moved_to(0.0, 0.0) }
        );
    }

    /// A 1080p laptop at 175 % has about 1097 x 590 logical pixels of work
    /// area, below the 1280 x 640 logical minimum, although its 1920 x 1032
    /// physical pixels exceed 1280 x 640.
    #[test]
    fn relaxes_the_logical_minimum_on_a_175_percent_laptop() {
        let laptop = area(rect(0.0, 0.0, 1920.0, 1032.0), 1.75);
        let window = Snapshot { scale: 1.75, ..frameless(rect(0.0, 0.0, 1600.0, 900.0)) };
        let screen = Size { width: 1920.0, height: 1032.0 };
        assert_eq!(
            place(window, &[laptop], Some(laptop)),
            Placement { min_inner: Some(screen), inner: Some(screen), ..Placement::default() }
        );
    }

    #[test]
    fn grows_to_the_logical_minimum_at_175_percent() {
        let monitor = area(rect(0.0, 0.0, 3840.0, 2080.0), 1.75);
        let window = Snapshot { scale: 1.75, ..frameless(rect(100.0, 100.0, 1600.0, 900.0)) };
        assert_eq!(
            place(window, &[monitor], Some(monitor)),
            Placement {
                inner: Some(Size { width: 2240.0, height: 1120.0 }),
                ..Placement::default()
            }
        );
    }

    /// Before GTK's first configure event, tao caches the window position as
    /// its outer size, so the outer size is smaller than the inner size.
    #[test]
    fn waits_while_the_geometry_cache_is_stale() {
        for outer in [rect(0.0, 0.0, 0.0, 0.0), rect(0.0, 0.0, 2560.0, 1600.0)] {
            let window =
                Snapshot { inner: Size { width: 2560.0, height: 1640.0 }, ..frameless(outer) };
            assert_eq!(fit(&window, &[primary()], None, MINIMUM, Desktop::Logical), Fit::Stale);
        }
    }

    /// A Retina panel (1512 x 982 points at 2x) left of a 1x external screen
    /// reaches x = 3024 in Tauri's physical units, so in those units the window
    /// below overlaps the panel more than the external screen it is on.
    #[test]
    fn compares_mixed_density_monitors_in_logical_points() {
        let retina = area(rect(0.0, 0.0, 3024.0, 1964.0), 2.0);
        let external = area(rect(1512.0, 0.0, 1920.0, 1080.0), 1.0);
        let window = frameless(rect(1600.0, 500.0, 1280.0, 800.0));
        assert_eq!(
            place_in(window, &[retina, external], Some(retina), Desktop::Logical),
            moved_to(1600.0, 280.0)
        );
    }

    #[test]
    fn places_in_logical_points_on_a_2x_monitor() {
        let retina = area(rect(0.0, 0.0, 3024.0, 1964.0), 2.0);
        let window = Snapshot { scale: 2.0, ..frameless(rect(2000.0, 200.0, 3000.0, 3400.0)) };
        assert_eq!(
            place_in(window, &[retina], Some(retina), Desktop::Logical),
            Placement { inner: Some(Size { width: 1500.0, height: 982.0 }), ..moved_to(12.0, 0.0) }
        );
    }

    /// A fit that read real geometry.
    const PLACED: Option<Fit> =
        Some(Fit::Place(Placement { min_inner: None, inner: None, position: None }));

    /// Shown, then focused: nothing moved the window while it was hidden (no
    /// saved state), so the focus event fits it, and no later event does.
    #[test]
    fn fits_once_on_the_first_event_after_showing() {
        let mut fits = 0;
        let watch = Watch::Waiting.after_event(true, || {
            fits += 1;
            PLACED
        });
        assert_eq!((watch, fits), (Watch::Done, 1));
        assert_eq!(watch.after_event(true, || unreachable!("the watch is over")), Watch::Done);
    }

    /// Shown, then moved without focus: the restore and the fit settled while
    /// the window was hidden, so its first event once shown, the user's move,
    /// ends the watch without a fit.
    #[test]
    fn leaves_the_first_move_after_showing_to_the_user() {
        let restored = Watch::Waiting.after_event(false, || PLACED);
        assert_eq!(restored, Watch::FittedHidden);
        let fitted = restored.after_event(false, || PLACED);
        assert_eq!(fitted, Watch::FittedHidden);
        assert_eq!(
            fitted.after_event(true, || unreachable!("a fit of the user's move")),
            Watch::Done
        );
    }

    /// Stale, then settled: GTK's geometry cache can still be stale at the
    /// shown window's first event, so the watch waits for the configure event.
    #[test]
    fn waits_out_stale_geometry_then_fits_once() {
        let stale = Watch::Waiting.after_event(true, || Some(Fit::Stale));
        assert_eq!(stale, Watch::Waiting);
        let mut fits = 0;
        let settled = stale.after_event(true, || {
            fits += 1;
            PLACED
        });
        assert_eq!((settled, fits), (Watch::Done, 1));
    }
}
