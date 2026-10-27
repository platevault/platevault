// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! E2E-only native window controls for hosted restore and post-show geometry checks.
//!
//! The commands are not part of either host's Specta registry: [`with_e2e_commands`]
//! routes them ahead of the production handler, so the generated clients never
//! name them and a build without `e2e` does not compile them.

use serde::Serialize;
use tauri::ipc::Invoke;
use tauri::utils::config::WindowConfig;
use tauri::{AppHandle, Manager, Runtime, WebviewWindow, Wry};

/// The four edges of a physical-pixel rectangle.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ProbeRect {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
}

/// Client-area size in physical pixels.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ProbeSize {
    pub w: u32,
    pub h: u32,
}

/// Native state of the shell's configured primary webview window.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct WindowProbe {
    /// The label resolved from the host's first configured window.
    pub label: String,
    pub outer: ProbeRect,
    pub inner: ProbeSize,
    pub scale: f64,
    pub maximized: bool,
    pub fullscreen: bool,
    pub visible: bool,
    /// The work area, in physical pixels, of the monitor containing the window centre.
    pub monitor_work_area: ProbeRect,
}

/// Return the first window label in the host's Tauri configuration.
fn configured_primary_label(windows: &[WindowConfig]) -> Result<&str, String> {
    windows
        .first()
        .map(|window| window.label.as_str())
        .ok_or_else(|| "Tauri configuration declares no primary window".to_owned())
}

fn configured_window<R: Runtime>(app: &AppHandle<R>) -> Result<(String, WebviewWindow<R>), String> {
    let label = configured_primary_label(&app.config().app.windows)?.to_owned();
    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| format!("configured primary window `{label}` is not available"))?;
    Ok((label, window))
}

fn probe(app: &AppHandle) -> Result<WindowProbe, String> {
    let (label, window) = configured_window(app)?;
    let position = window.outer_position().map_err(|error| error.to_string())?;
    let outer = window.outer_size().map_err(|error| error.to_string())?;
    let inner = window.inner_size().map_err(|error| error.to_string())?;
    let centre = (
        f64::from(position.x) + f64::from(outer.width) / 2.0,
        f64::from(position.y) + f64::from(outer.height) / 2.0,
    );
    let monitors = window.available_monitors().map_err(|error| error.to_string())?;
    let monitor = monitors
        .into_iter()
        .find(|monitor| {
            let position = monitor.position();
            let size = monitor.size();
            centre.0 >= f64::from(position.x)
                && centre.0 < f64::from(position.x) + f64::from(size.width)
                && centre.1 >= f64::from(position.y)
                && centre.1 < f64::from(position.y) + f64::from(size.height)
        })
        .or(window.primary_monitor().map_err(|error| error.to_string())?)
        .ok_or_else(|| "no monitor is available for the configured primary window".to_owned())?;
    let work_area = monitor.work_area();

    Ok(WindowProbe {
        label,
        outer: ProbeRect { x: position.x, y: position.y, w: outer.width, h: outer.height },
        inner: ProbeSize { w: inner.width, h: inner.height },
        scale: window.scale_factor().map_err(|error| error.to_string())?,
        maximized: window.is_maximized().map_err(|error| error.to_string())?,
        fullscreen: window.is_fullscreen().map_err(|error| error.to_string())?,
        visible: window.is_visible().map_err(|error| error.to_string())?,
        monitor_work_area: ProbeRect {
            x: work_area.position.x,
            y: work_area.position.y,
            w: work_area.size.width,
            h: work_area.size.height,
        },
    })
}

/// Inspect the host-configured primary window.
///
/// # Errors
/// The host has no configured window, the window is not open, or the
/// platform refuses a geometry or state read.
#[tauri::command]
#[allow(clippy::needless_pass_by_value)] // Tauri injects the app handle by value
pub fn e2e_window_probe(app: AppHandle) -> Result<WindowProbe, String> {
    probe(&app)
}

/// Focus the host-configured primary window to generate a native focus event.
///
/// # Errors
/// The primary window is missing or the platform refuses focus.
#[tauri::command]
#[allow(clippy::needless_pass_by_value)] // Tauri injects the app handle by value
pub fn e2e_window_focus(app: AppHandle) -> Result<(), String> {
    let (_, window) = configured_window(&app)?;
    window.set_focus().map_err(|error| error.to_string())
}

/// Wrap a host's production invoke handler so the two window commands are
/// served first and every other command reaches `production` unchanged.
pub fn with_e2e_commands(
    production: impl Fn(Invoke<Wry>) -> bool + Send + Sync + 'static,
) -> impl Fn(Invoke<Wry>) -> bool + Send + Sync + 'static {
    let e2e: fn(Invoke<Wry>) -> bool = tauri::generate_handler![e2e_window_probe, e2e_window_focus];
    move |invoke| match invoke.message.command() {
        "e2e_window_probe" | "e2e_window_focus" => e2e(invoke),
        _ => production(invoke),
    }
}

#[cfg(test)]
mod tests {
    use super::{configured_primary_label, configured_window};
    use tauri::utils::config::WindowConfig;

    fn config_window(label: &str) -> WindowConfig {
        WindowConfig { label: label.to_owned(), ..WindowConfig::default() }
    }

    #[test]
    fn each_host_selects_its_configured_primary_window_label() {
        assert_eq!(
            configured_primary_label(&[config_window("main"), config_window("splash")]),
            Ok("main")
        );
        assert_eq!(configured_primary_label(&[config_window("library")]), Ok("library"));
    }

    #[test]
    fn missing_primary_window_returns_a_clear_error() {
        let mut context = tauri::test::mock_context(tauri::test::noop_assets());
        context.config_mut().app.windows.clear();
        let app = tauri::test::mock_builder().build(context).expect("mock app");
        assert!(
            configured_window(app.handle()).is_err(),
            "a host with no configured window has no primary window"
        );
    }
}
