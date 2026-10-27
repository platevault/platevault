// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Hosted runtime checks for the restored main-window geometry contract.
//!
//! These tests read the native outer bounds from e2e-only Tauri commands. The
//! window-state file is seeded in the per-test app-data directory so startup
//! restores the actual persisted record before the production clamp runs.

mod common;

#[cfg(any(target_os = "linux", target_os = "windows"))]
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
        let min_inner_w =
            u64::from(MIN_WIDTH).min(work_w.saturating_sub(outer_w.saturating_sub(inner_w)));
        let min_inner_h =
            u64::from(MIN_HEIGHT).min(work_h.saturating_sub(outer_h.saturating_sub(inner_h)));
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
    // The right edge starts beyond the 1600px Xvfb monitor. A monitor narrower
    // than the configured minimum bounds the attainable geometry by its work
    // area; a run that sets PV_E2E_REQUIRE_FULL_MINIMUM has arranged a monitor
    // large enough, so there the full 1280x640 client size is required.
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
    if std::env::var_os("PV_E2E_REQUIRE_FULL_MINIMUM").is_some() {
        ensure!(
            expected_inner_w == i64::from(MIN_WIDTH) && expected_inner_h == i64::from(MIN_HEIGHT),
            "the monitor work area cannot hold the {MIN_WIDTH}x{MIN_HEIGHT} minimum client size: {state}"
        );
    }
    println!("WINDOW_RUNTIME_CASE_A_BOUNDS={state}");
    app.shutdown().await
}

/// A saved maximized window is shown maximized, filling the monitor's work
/// area, and stays so after a native focus event.
#[tokio::test]
#[ignore = "Layer-2 real-UI runtime check: needs tauri-webdriver CLI + desktop_shell --features e2e + served frontend; run via dedicated window runtime workflow"]
async fn restored_maximized_window_stays_maximized_after_focus_event() -> anyhow::Result<()> {
    let app = seed_and_launch(40, 40, 800, 500, true).await?;
    let before = wait_for_settled_probe(&app).await?;
    let before = wait_until_visible(&app, before).await?;
    ensure!(before["maximized"] == true, "saved maximized state was not restored: {before}");
    ensure_fills_work_area(&before, "before the focus event")?;
    let _: Value = invoke_native(&app, "e2e_window_focus", json!({})).await?;
    tokio::time::sleep(SETTLE).await;
    let after_focus = probe(&app).await?;
    ensure!(
        after_focus["maximized"] == true && after_focus["visible"] == true,
        "maximized state was lost after focus event: {after_focus}"
    );
    ensure_fills_work_area(&after_focus, "after the focus event")?;
    println!("WINDOW_RUNTIME_CASE_B_BOUNDS={after_focus}");
    app.shutdown().await
}

/// The probe once the window is shown; a maximized flag on a hidden window
/// proves nothing about what the user sees.
async fn wait_until_visible(app: &E2eApp, mut last: Value) -> anyhow::Result<Value> {
    let deadline = tokio::time::Instant::now() + RESTORE_TIMEOUT;
    while last["visible"] != true {
        ensure!(tokio::time::Instant::now() < deadline, "main window never became visible: {last}");
        tokio::time::sleep(Duration::from_millis(100)).await;
        last = probe(app).await?;
    }
    Ok(last)
}

/// A maximized window's outer bounds cover the monitor's work area.
fn ensure_fills_work_area(state: &Value, when: &str) -> anyhow::Result<()> {
    let (work_x, work_y, work_w, work_h) = work_bounds(state)?;
    let outer = &state["outer"];
    let (x, y) = (outer["x"].as_i64(), outer["y"].as_i64());
    let (w, h) = (outer["w"].as_i64(), outer["h"].as_i64());
    ensure!(
        x.zip(y).zip(w).zip(h).is_some_and(|(((x, y), w), h)| {
            x <= work_x && y <= work_y && x + w >= work_x + work_w && y + h >= work_y + work_h
        }),
        "maximized window does not cover the work area {when}: {state}"
    );
    Ok(())
}

/// After the main window shows, a real user move is not refitted.
///
/// Linux uses xdotool under the dedicated Openbox/Xvfb job, and Windows
/// injects mouse input through `user32` in the runner's desktop session, so
/// on both the drag is real OS input on the native title bar.
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
        let window_id = app_x11_window(&before).await?;
        let activated = Command::new("xdotool")
            .args(["windowactivate", "--sync", &window_id])
            .status()
            .context("xdotool could not activate the app window")?;
        ensure!(activated.success(), "xdotool windowactivate failed for {window_id}");
        let geometry_before = Command::new("xdotool")
            .args(["getwindowgeometry", "--shell", &window_id])
            .output()
            .context("xdotool could not read window geometry before drag")?;
        ensure!(geometry_before.status.success(), "xdotool getwindowgeometry failed before drag");
        println!(
            "WINDOW_RUNTIME_CASE_C_X11_BEFORE window_id={window_id} geometry={}",
            String::from_utf8_lossy(&geometry_before.stdout).replace('\n', ";")
        );
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
        let drag_steps = 16;
        for step in 1..=drag_steps {
            let x = source_x + (pointer_x - source_x) * step / drag_steps;
            let y = source_y + (pointer_y - source_y) * step / drag_steps;
            let moved = Command::new("xdotool")
                .args(["mousemove", "--sync", &x.to_string(), &y.to_string()])
                .status()
                .context("xdotool title-bar drag failed")?;
            ensure!(moved.success(), "xdotool title-bar drag exited unsuccessfully");
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        let released = Command::new("xdotool").args(["mouseup", "1"]).status()?;
        ensure!(released.success(), "xdotool drag release failed");
        let active_after = Command::new("xdotool")
            .args(["getactivewindow"])
            .output()
            .context("xdotool could not read the active window after drag")?;
        ensure!(active_after.status.success(), "xdotool getactivewindow failed after drag");
        let active_after = String::from_utf8_lossy(&active_after.stdout).trim().to_owned();
        let geometry_after = Command::new("xdotool")
            .args(["getwindowgeometry", "--shell", &window_id])
            .output()
            .context("xdotool could not read window geometry after drag")?;
        ensure!(geometry_after.status.success(), "xdotool getwindowgeometry failed after drag");
        let immediately_after = probe(&app).await?;
        println!(
            "WINDOW_RUNTIME_CASE_C_X11_IMMEDIATE window_id={active_after} geometry={} probe={immediately_after}",
            String::from_utf8_lossy(&geometry_after.stdout).replace('\n', ";")
        );
        ensure!(
            active_after == window_id,
            "X11 drag changed active window from {window_id} to {active_after}"
        );
        ensure!(
            immediately_after["outer"]["x"].as_i64() == Some(target_x),
            "Openbox did not move the active window to x={target_x} immediately after the drag: {immediately_after}"
        );
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
        // Bring the app forward so no other window covers the grab point.
        let _: Value = invoke_native(&app, "e2e_window_focus", json!({})).await?;
        tokio::time::sleep(SETTLE).await;
        let before = probe(&app).await?;
        let (work_x, work_y, work_w, _) = work_bounds(&before)?;
        let outer = &before["outer"];
        let outer_x = outer["x"].as_i64().context("outer x missing")?;
        let outer_y = outer["y"].as_i64().context("outer y missing")?;
        let outer_w = outer["w"].as_i64().context("outer width missing")?;
        let outer_h = outer["h"].as_i64().context("outer height missing")?;
        let inner_w = before["inner"]["w"].as_i64().context("inner width missing")?;
        let inner_h = before["inner"]["h"].as_i64().context("inner height missing")?;
        // The outer frame adds equal invisible side and bottom borders; the
        // rest of the height difference is the title bar, grabbed at its
        // middle and a third of the way across, clear of the caption buttons.
        let border = (outer_w - inner_w) / 2;
        let title_h = outer_h - inner_h - border;
        ensure!(title_h > 0, "no native title bar above the client area: {before}");
        let source_x = outer_x + outer_w / 3;
        let source_y = outer_y + title_h / 2;
        // As on X11, the drag leaves the window partly off the monitor, where
        // a refit would visibly pull it back.
        let target_x = work_x + work_w - outer_w / 2;
        let target_y = work_y + 100;
        let pointer_x = source_x + (target_x - outer_x);
        let pointer_y = source_y + (target_y - outer_y);
        windows_title_bar_drag(source_x, source_y, pointer_x, pointer_y)?;
        let immediately_after = probe(&app).await?;
        println!("WINDOW_RUNTIME_CASE_C_WINDOWS_IMMEDIATE={immediately_after}");
        ensure!(
            immediately_after["outer"]["x"].as_i64() == Some(target_x)
                && immediately_after["outer"]["y"].as_i64() == Some(target_y),
            "the title-bar drag did not move the window to ({target_x},{target_y}): {immediately_after}"
        );
        tokio::time::sleep(SETTLE).await;
        let after = probe(&app).await?;
        ensure!(
            after["outer"]["x"].as_i64() == Some(target_x)
                && after["outer"]["y"].as_i64() == Some(target_y),
            "real Windows drag was refitted from ({target_x},{target_y}): {after}"
        );
        ensure!(
            target_x + outer_w > work_x + work_w,
            "drag did not leave window partly off-monitor: {after}"
        );
        println!("WINDOW_RUNTIME_CASE_C_WINDOWS_USER_DRAG={after}");
    }
    app.shutdown().await
}

/// Press the left button at the source point, move to the target in steps and
/// release, as injected OS mouse input. The cursor moves through
/// `SetCursorPos` and the button through `mouse_event`, so Windows runs its own
/// title-bar move loop exactly as it does for a user's drag.
#[cfg(target_os = "windows")]
fn windows_title_bar_drag(
    source_x: i64,
    source_y: i64,
    target_x: i64,
    target_y: i64,
) -> anyhow::Result<()> {
    let script = format!(
        r#"$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class PvDrag {{
    [DllImport("user32.dll", SetLastError = true)] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
}}
'@
function Move-To([int]$x, [int]$y) {{
    if (-not [PvDrag]::SetCursorPos($x, $y)) {{ throw "SetCursorPos($x, $y) failed" }}
}}
Move-To {source_x} {source_y}
Start-Sleep -Milliseconds 150
[PvDrag]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 150
$steps = 16
for ($i = 1; $i -le $steps; $i++) {{
    Move-To ([int]({source_x} + ({target_x} - {source_x}) * $i / $steps)) ([int]({source_y} + ({target_y} - {source_y}) * $i / $steps))
    Start-Sleep -Milliseconds 20
}}
Start-Sleep -Milliseconds 150
[PvDrag]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 300
"#
    );
    let path = std::env::temp_dir().join(format!("pv-e2e-drag-{}.ps1", std::process::id()));
    std::fs::write(&path, script).with_context(|| format!("failed to write {}", path.display()))?;
    let output = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"])
        .arg(&path)
        .output()
        .context("could not start PowerShell for the title-bar drag")?;
    let _ = std::fs::remove_file(&path);
    ensure!(
        output.status.success(),
        "the title-bar drag failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    Ok(())
}

/// The X11 window of the app's main window: the one visible, named window
/// whose client area has the probed inner size. GTK's unnamed child windows
/// share that size, so only titled windows count. The active window is no
/// proof: a window of the previous test can still be on top while it closes.
#[cfg(target_os = "linux")]
async fn app_x11_window(probe: &Value) -> anyhow::Result<String> {
    let width = probe["inner"]["w"].as_i64().context("inner width missing")?;
    let height = probe["inner"]["h"].as_i64().context("inner height missing")?;
    let deadline = tokio::time::Instant::now() + RESTORE_TIMEOUT;
    loop {
        let listed = Command::new("xdotool")
            .args(["search", "--onlyvisible", "--name", "."])
            .output()
            .context("xdotool could not list visible windows")?;
        let ids = String::from_utf8_lossy(&listed.stdout).into_owned();
        let mut matching = Vec::new();
        for id in ids.split_whitespace() {
            let geometry =
                Command::new("xdotool").args(["getwindowgeometry", "--shell", id]).output()?;
            let shell = String::from_utf8_lossy(&geometry.stdout);
            let field = |name: &str| {
                shell.lines().find_map(|line| line.strip_prefix(name)?.parse::<i64>().ok())
            };
            // GTK's child windows share the client size but carry no
            // _NET_WM_PID; only the toplevel the app mapped does.
            let toplevel = Command::new("xdotool")
                .args(["getwindowpid", id])
                .output()
                .is_ok_and(|pid| pid.status.success());
            if field("WIDTH=") == Some(width) && field("HEIGHT=") == Some(height) && toplevel {
                let name = Command::new("xdotool").args(["getwindowname", id]).output()?;
                matching
                    .push((id.to_owned(), String::from_utf8_lossy(&name.stdout).trim().to_owned()));
            }
        }
        match matching.as_slice() {
            [(one, _)] => return Ok(one.clone()),
            _ if tokio::time::Instant::now() >= deadline => anyhow::bail!(
                "expected one visible {width}x{height} X11 window for the app, found {matching:?}"
            ),
            _ => tokio::time::sleep(Duration::from_millis(200)).await,
        }
    }
}
