// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Hosted runtime checks for the restored main-window geometry contract.
//!
//! These tests read the native outer bounds from e2e-only Tauri commands. The
//! window-state file is seeded in the per-test app-data directory so startup
//! restores the actual persisted record before the production clamp runs.

mod common;

#[cfg(target_os = "linux")]
use std::process::Command;

use std::time::Duration;

use anyhow::{ensure, Context};
use common::E2eApp;
use serde_json::{json, Value};

const SETTLE: Duration = Duration::from_secs(2);
const RESTORE_TIMEOUT: Duration = Duration::from_secs(20);
const MIN_WIDTH: u32 = 1280;
const MIN_HEIGHT: u32 = 640;

fn saved_window_state(x: i32, y: i32, width: u32, height: u32, maximized: bool) -> Value {
    json!({
        "main": {
            "width": width,
            "height": height,
            "x": x,
            "y": y,
            "prev_x": x,
            "prev_y": y,
            "maximized": maximized,
            // The application excludes VISIBLE from state restoration. The
            // initial configuration keeps the main window hidden until the
            // splash's boot-ready handshake, preserving that lifecycle.
            "visible": false,
            "decorated": true,
            "fullscreen": false
        }
    })
}

async fn seed_and_launch(
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    maximized: bool,
) -> anyhow::Result<E2eApp> {
    let path = E2eApp::window_state_path();
    std::fs::write(
        &path,
        serde_json::to_vec_pretty(&saved_window_state(x, y, width, height, maximized))?,
    )
    .with_context(|| format!("failed to seed saved window state at {}", path.display()))?;

    let app = E2eApp::launch_preserving_window_state().await?;
    app.wait_bridge_ready(Duration::from_secs(30)).await?;
    Ok(app)
}

async fn invoke_native<T: serde::de::DeserializeOwned>(
    app: &E2eApp,
    command: &str,
    args: Value,
) -> anyhow::Result<T> {
    app.invoke(command, args).await
}

async fn probe(app: &E2eApp) -> anyhow::Result<Value> {
    invoke_native(app, "e2e_window_probe", json!({})).await
}

async fn wait_for_settled_probe(app: &E2eApp) -> anyhow::Result<Value> {
    let deadline = tokio::time::Instant::now() + RESTORE_TIMEOUT;
    loop {
        let last = probe(app).await?;
        let outer = &last["outer"];
        let inner = &last["inner"];
        let work = &last["monitor_work_area"];
        let x = outer["x"].as_i64().context("probe outer.x missing")?;
        let y = outer["y"].as_i64().context("probe outer.y missing")?;
        let outer_w = outer["w"].as_u64().context("probe outer.w missing")?;
        let outer_h = outer["h"].as_u64().context("probe outer.h missing")?;
        let inner_w = inner["w"].as_u64().context("probe inner.w missing")?;
        let inner_h = inner["h"].as_u64().context("probe inner.h missing")?;
        let work_x = work["x"].as_i64().context("probe monitor_work_area.x missing")?;
        let work_y = work["y"].as_i64().context("probe monitor_work_area.y missing")?;
        let work_w = work["w"].as_u64().context("probe monitor_work_area.w missing")?;
        let work_h = work["h"].as_u64().context("probe monitor_work_area.h missing")?;
        let min_inner_w = u64::from(MIN_WIDTH).min(work_w.saturating_sub(outer_w.saturating_sub(inner_w)));
        let min_inner_h = u64::from(MIN_HEIGHT).min(work_h.saturating_sub(outer_h.saturating_sub(inner_h)));
        let fully_on_monitor = x >= work_x
            && y >= work_y
            && x.saturating_add(outer_w as i64) <= work_x.saturating_add(work_w as i64)
            && y.saturating_add(outer_h as i64) <= work_y.saturating_add(work_h as i64);
        let normal_bounds_fit = last["maximized"] == false
            && fully_on_monitor
            && inner_w >= min_inner_w
            && inner_h >= min_inner_h;
        if normal_bounds_fit || last["maximized"] == true {
            tokio::time::sleep(SETTLE).await;
            return probe(app).await;
        }
        if tokio::time::Instant::now() >= deadline {
            anyhow::bail!(
                "window geometry did not settle to the expected normal/maximized state: {last}"
            );
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}
fn work_bounds(state: &Value) -> anyhow::Result<(i64, i64, i64, i64)> {
    let work = &state["monitor_work_area"];
    Ok((
        work["x"].as_i64().context("monitor work-area x missing")?,
        work["y"].as_i64().context("monitor work-area y missing")?,
        work["w"].as_i64().context("monitor work-area w missing")?,
        work["h"].as_i64().context("monitor work-area h missing")?,
    ))
}

fn assert_fully_on_monitor(state: &Value) -> anyhow::Result<()> {
    let outer = &state["outer"];
    let x = outer["x"].as_i64().context("outer.x missing")?;
    let y = outer["y"].as_i64().context("outer.y missing")?;
    let w = outer["w"].as_i64().context("outer.w missing")?;
    let h = outer["h"].as_i64().context("outer.h missing")?;
    let (work_x, work_y, work_w, work_h) = work_bounds(state)?;
    ensure!(x >= work_x, "window left edge is outside monitor: {state}");
    ensure!(y >= work_y, "window top edge is outside monitor: {state}");
    ensure!(x + w <= work_x + work_w, "window right edge is outside monitor: {state}");
    ensure!(y + h <= work_y + work_h, "window bottom edge is outside monitor: {state}");
    Ok(())
}

/// A persisted undersized, partly off-screen window is clamped into the
/// visible monitor and raised to the configured minimum client size.
#[tokio::test]
#[ignore = "Layer-2 real-UI runtime check: needs tauri-webdriver CLI + desktop_shell --features e2e + served frontend; run via dedicated window runtime workflow"]
async fn restored_offscreen_small_window_is_clamped_to_visible_monitor() -> anyhow::Result<()> {
    // The right edge starts beyond the 1600px Xvfb monitor; Windows hosted
    // runners are only 1024px wide, so their attainable geometry is bounded by
    // the monitor work area when the configured minimum does not fit.
    let app = seed_and_launch(1000, 40, 800, 500, false).await?;
    let state = wait_for_settled_probe(&app).await?;
    assert_fully_on_monitor(&state)?;
    let inner = &state["inner"];
    let (_, _, work_w, work_h) = work_bounds(&state)?;
    ensure!(state["maximized"] == false, "normal saved state became maximized: {state}");
    let expected_inner_w = i64::from(MIN_WIDTH)
        .min(work_w - (state["outer"]["w"].as_i64().unwrap() - inner["w"].as_i64().unwrap()));
    let expected_inner_h = i64::from(MIN_HEIGHT)
        .min(work_h - (state["outer"]["h"].as_i64().unwrap() - inner["h"].as_i64().unwrap()));
    ensure!(
        inner["w"].as_i64() == Some(expected_inner_w),
        "inner width did not clamp to configured minimum/work area: {state}"
    );
    ensure!(
        inner["h"].as_i64() == Some(expected_inner_h),
        "inner height did not clamp to configured minimum/work area: {state}"
    );
    println!("WINDOW_RUNTIME_CASE_A_BOUNDS={state}");
    app.shutdown().await
}

/// A saved maximized window stays OS-maximized after a native focus event.
#[tokio::test]
#[ignore = "Layer-2 real-UI runtime check: needs tauri-webdriver CLI + desktop_shell --features e2e + served frontend; run via dedicated window runtime workflow"]
async fn restored_maximized_window_stays_maximized_after_focus_event() -> anyhow::Result<()> {
    let app = seed_and_launch(40, 40, 800, 500, true).await?;
    let before = wait_for_settled_probe(&app).await?;
    ensure!(before["maximized"] == true, "saved maximized state was not restored: {before}");
    let _: Value = invoke_native(&app, "e2e_window_focus", json!({})).await?;
    tokio::time::sleep(SETTLE).await;
    let after_focus = probe(&app).await?;
    ensure!(
        after_focus["maximized"] == true,
        "maximized state was lost after focus event: {after_focus}"
    );
    println!("WINDOW_RUNTIME_CASE_B_BOUNDS={after_focus}");
    app.shutdown().await
}

/// After the main window shows, a real user move is not refitted.
///
/// Linux uses xdotool under the dedicated Openbox/Xvfb job, so the drag is a
/// real X11 input sequence. Windows uses the e2e-only native positioning
/// command as a labelled proxy: hosted Windows runner sessions do not expose
/// an interactive desktop input path to this WebDriver test.
#[tokio::test]
#[ignore = "Layer-2 real-UI runtime check: needs tauri-webdriver CLI + desktop_shell --features e2e + served frontend; run via dedicated window runtime workflow"]
async fn first_move_after_show_is_not_refitted() -> anyhow::Result<()> {
    let app = seed_and_launch(80, 80, 1360, 800, false).await?;
    let before = wait_for_settled_probe(&app).await?;
    ensure!(before["visible"] == true, "main window did not become visible before move: {before}");
    #[cfg(target_os = "linux")]
    let (work_x, work_y, work_w) = {
        let (x, y, w, _) = work_bounds(&before)?;
        (x, y, w)
    };
    #[cfg(target_os = "linux")]
    let outer_w = before["outer"]["w"].as_i64().context("outer width missing")?;
    #[cfg(target_os = "linux")]
    {
        let source_x = before["outer"]["x"].as_i64().context("outer x missing")? + 120;
        let source_y = before["outer"]["y"].as_i64().context("outer y missing")? + 12;
        let target_x = work_x + work_w - outer_w / 2;
        let target_y = work_y + 180;
        let pointer_x = target_x + 120;
        let pointer_y = target_y + 12;
        let pressed = Command::new("xdotool")
            .args([
                "mousemove",
                "--sync",
                &source_x.to_string(),
                &source_y.to_string(),
                "mousedown",
                "1",
            ])
            .status()
            .context("xdotool mouse press failed")?;
        ensure!(pressed.success(), "xdotool mouse press exited unsuccessfully");
        let moved = Command::new("xdotool")
            .args(["mousemove", "--sync", &pointer_x.to_string(), &pointer_y.to_string()])
            .status()
            .context("xdotool title-bar drag failed")?;
        let released = Command::new("xdotool").args(["mouseup", "1"]).status()?;
        ensure!(moved.success() && released.success(), "xdotool drag/release failed");
        tokio::time::sleep(SETTLE).await;
        let after = probe(&app).await?;
        ensure!(
            after["outer"]["x"].as_i64() == Some(target_x),
            "real X11 drag was refitted from x={target_x}: {after}"
        );
        ensure!(
            after["outer"]["x"].as_i64().unwrap() + outer_w > work_x + work_w,
            "drag did not leave window partly off-monitor: {after}"
        );
        println!("WINDOW_RUNTIME_CASE_C_X11_USER_DRAG={after}");
    }
    #[cfg(target_os = "windows")]
    {
        // This drives native positioning but is not OS input; report it as a
        // programmatic proxy, not as proof of a physical user drag.
        let (work_x, work_y, _, _) = work_bounds(&before)?;
        let move_x = work_x + 120;
        let move_y = work_y + 100;
        let _: Value =
            invoke_native(&app, "e2e_window_move", json!({ "x": move_x, "y": move_y })).await?;
        tokio::time::sleep(SETTLE).await;
        let after = probe(&app).await?;
        ensure!(
            after["outer"]["x"].as_i64() == Some(move_x)
                && after["outer"]["y"].as_i64() == Some(move_y),
            "programmatic native move was refitted: {after}"
        );
        println!("WINDOW_RUNTIME_CASE_C_WINDOWS_PROGRAMMATIC_PROXY={after}");
    }
    app.shutdown().await
}
