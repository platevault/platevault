# Research: scientific computation and selective reuse

Date: 2026-10-03
Scope: rebuild planning evidence; no product dependencies or implementation changed
Source baseline: `94a3dc958c13e297baf501aa2721efa2c2628622`

## Computation placement

**Decision**: Scientific decoding, measurements, and stretch calculations execute in Rust; the frontend owns presentation and controls. Platform and representative-pipeline checks qualify implementations and dependencies, not this execution boundary. No required WASM deployment is proposed.

**Rationale**: The user selected Rust where it fits better and frontend presentation only. Native decoding and batch analysis avoid transferring full-resolution frames solely for computation. The tested Rust fitting path exposes convergence and passes masked, noisy, and refusal controls. Browser numerical computation remains viable, but the surveyed browser packages do not supply a qualified complete analyzer.

**Alternatives considered**:

- JavaScript worker science: viable binary64 arithmetic and simple debugging; the evaluated weighted optimizer is incorrect as published.
- Shared Rust/WASM science: reusable numerical code; compilation, memory budgets, and production-origin webview behavior remain unverified.
- Browser GPU science: WebGL2/WGSL do not provide the required general binary64 path. GPU rendering remains appropriate for display; native GPU capability is a separate, unqualified option.

**Consequences**: Rust owns metric definitions, validation, and display-stretch results. Presentation can cache Rust-produced previews and coalesce control requests without computing scientific values from rendered bytes. A future WASM adapter needs a demonstrated capability benefit and parity evidence.

## Evidence from executed probes

The fixtures are disposable and synthetic. These observations do not establish production performance, complete format coverage, or Windows/Linux behavior.

| Candidate | Observed result | Adoption implication |
|---|---|---|
| fitsio-pure 0.13.4 | Physical BZERO u16, negative/out-of-unit f32, precise f64, and an image extension preserved; malformed/truncated inputs refused | Pure-Rust candidate; compressed-format coverage and platform checks remain |
| fitsio 0.21.10 | Bundled CFITSIO build succeeded; typed/scaled inputs, extension selection, ROI, and malformed-input refusal passed | Conditional native candidate; Windows build and literal-path handling need proof |
| fitsrs 0.4.1 | Stored sample types preserved; caller scaling worked; truncated input returned only 2 of 6 samples without an error | Reject as the primary reader without fixing short-read integrity |
| seiza-fits 0.2.4 | Native u16/f32/f64 preserved on supported primary images; signed-i16 negatives were clamped; extension-only images refused | Narrow reader, not the general scientific input contract |
| astro-io 0.6.1 FITS | f64 converted to f32; empty-primary input panicked | Reject the lossy pixel wrapper |
| xisf 0.5.1 | Big/little-endian u16, f32/f64 bits, invalid values, RGB layout, and multiple images preserved | Primary XISF candidate; real compressed corpus and platform checks remain |
| seiza-xisf 0.3.0 | Big-endian u16, f32/f64, and RGB layout preserved | Differential candidate; verify codec and sample-format limits |
| astro-io 0.6.1 XISF | Big-endian u16 was byte-swapped incorrectly; float formats were unsupported | Reject for the required XISF contract |
| xisf-rs 0.0.4 | Build stopped because pkg-config/libxml2 prerequisites were unavailable | Native dependency limitation; no decode result claimed |
| seiza 0.19.2 | Original f32 buffer unchanged; isolated star centroid within about 5e-6 pixels of synthetic truth | Detection primitive only; no fitted PSF or true HFR supplied |
| seiza-stars 0.2.0 | Native-u16 Gaussian fit recovered width about 2.3% high; float input unavailable | Reject as the sole analyzer; provenance and metric semantics also need review |
| Rust levenberg-marquardt 0.15.0, nalgebra 0.34.2 | Jacobian check, rotated Gaussian, masked saturation, noise, and flat-input refusal controls passed | Fitting primitive; not a complete analyzer |
| ml-levenberg-marquardt 5.1.0 | Unweighted browser fit passed; noisy weighted fit stayed near initialization after 300 iterations | Reject as-is for weighted scientific fitting |

The JavaScript optimizer's published weight conventions disagree. It builds inverse-square weights, divides the objective by those weights, and applies incompatible scaling to the gradient and normal matrix. This is a defect in the evaluated package, not a limitation of frontend floating-point arithmetic.

## Display evidence

A Chromium WebGL2 probe used an R32F texture and an explicit invalid-pixel mask. Midtones transfer at `m=0.25` matched the float64 reference bytes exactly. The source samples remained unchanged.

A separate macOS Tauri dev-origin probe reported WebGL2, WebAssembly, workers, and OffscreenCanvas support. It did not prove production-origin worker loading, WebGPU adapter availability, large-frame transfer performance, or other platforms. A native worker result could not be verified because the automation bridge timed out.

The display probes are capability evidence, not authorization to move computation into the frontend. Render Rust-produced previews while retaining source-type samples in Rust. Pixel readout and scientific statistics must never read back stretched display bytes.

## Metric contracts to establish

- HFR means the radius enclosing 50% of background-subtracted flux. Specify aperture, interpolation, background, and negative-sample treatment.
- Flux-weighted mean radius and Kron radius are distinct metrics.
- Label fitted FWHM separately from moment-derived Gaussian-equivalent width.
- Specify invalid samples, masks, saturation, channel/CFA interpretation, and point-sampled versus pixel-integrated models.
- A converged optimizer is not sufficient evidence of a valid star. Preserve failure, bound, residual, and uncertainty diagnostics.
- Preserve input identity, measurement method/version, units, and source with durable measurements.

## Frontend baseline

React 19, Vite 7, TanStack Query/Router/Virtual, vanilla-extract, Paraglide, React Hook Form/Zod, Visx, and direct Leaflet remain proposed presentation choices. The user's frontend-presentation-only direction supersedes the original astronomy ADR's permission for frontend-derived planner calculations; planning science executes in Rust through shared skymath contracts.

The rebuild must evaluate stable `@base-ui/react` instead of carrying the old `@base-ui-components/react` release-candidate pin. TanStack Table and React Aria Table are alternatives for the new review grids; neither is installed in the audited frontend. No package upgrade or addition is authorized by this research file.

## Primary sources

- [Tauri raw binary responses](https://v2.tauri.app/develop/calling-rust/#returning-array-buffers)
- [Tauri webview engines](https://v2.tauri.app/reference/webview-versions/)
- [fitsio-pure 0.13.4](https://docs.rs/fitsio-pure/0.13.4/fitsio_pure/)
- [fitsio 0.21.10](https://docs.rs/fitsio/0.21.10/fitsio/)
- [xisf 0.5.1](https://docs.rs/xisf/0.5.1/xisf/)
- [Rust fitting primitive](https://docs.rs/levenberg-marquardt/0.15.0/levenberg_marquardt/)
- [Published JavaScript objective](https://unpkg.com/ml-levenberg-marquardt@5.1.0/lib/error_calculation.js)
- [Published JavaScript options](https://unpkg.com/ml-levenberg-marquardt@5.1.0/lib/check_options.js)
- [Published JavaScript step](https://unpkg.com/ml-levenberg-marquardt@5.1.0/lib/step.js)
- [Base UI package rename](https://base-ui.com/react/overview/releases/v1-0-0)
