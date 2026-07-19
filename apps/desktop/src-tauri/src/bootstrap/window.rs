// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Post-restore window geometry corrections (spec 051 US4), applied after
//! `tauri-plugin-window-state` restores a persisted size/position.

/// Enforce the min-size floor (spec 051 US4, T029) after
/// `tauri-plugin-window-state` restores a persisted size, in case a prior
/// app version persisted a smaller size than the current `tauri.conf.json`
/// `minWidth`/`minHeight` (1100x720) — mirrors the `astro-up` reference's own
/// explicit post-restore clamp (research.md's cited `lib.rs` excerpt).
pub(crate) fn enforce_min_window_size(window: &tauri::WebviewWindow) {
    const MIN_WIDTH: u32 = 1100;
    const MIN_HEIGHT: u32 = 720;

    if let Ok(size) = window.inner_size() {
        let w = size.width.max(MIN_WIDTH);
        let h = size.height.max(MIN_HEIGHT);
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
pub(crate) fn recenter_if_offscreen(window: &tauri::WebviewWindow) {
    let (Ok(pos), Ok(size), Ok(monitors)) =
        (window.outer_position(), window.outer_size(), window.available_monitors())
    else {
        return;
    };

    let win_right = pos.x + i32::try_from(size.width).unwrap_or(i32::MAX);
    let win_bottom = pos.y + i32::try_from(size.height).unwrap_or(i32::MAX);

    let on_screen = monitors.iter().any(|m| {
        let mp = m.position();
        let ms = m.size();
        let mon_right = mp.x + i32::try_from(ms.width).unwrap_or(i32::MAX);
        let mon_bottom = mp.y + i32::try_from(ms.height).unwrap_or(i32::MAX);
        // Any overlap between the window rect and this monitor's rect.
        pos.x < mon_right && win_right > mp.x && pos.y < mon_bottom && win_bottom > mp.y
    });

    if !on_screen {
        if let Err(e) = window.center() {
            tracing::warn!("failed to recenter off-screen window: {e:?}");
        } else {
            tracing::info!("restored window position was off-screen; recentered");
        }
    }
}
