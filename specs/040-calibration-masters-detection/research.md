# Research: calibration master detection

## How tools label a calibration master

### Siril (FITS)
- `IMAGETYP` stays the **base type**: `LIGHT` / `DARK` / `BIAS` / `OFFSET` (= bias) / `FLAT` — **never** "master".
- A master is identified by **`STACKCNT` > 1** (number of frames integrated; written/updated during stacking) and the **`_stacked.fit`** filename convention (`LIVETIME` is also updated).
- Sources: https://siril.org/tutorials/tuto-manual/ , https://siril.org/faq/

### PixInsight / WBPP (XISF, also FITS)
- WBPP-created masters carry `IMAGETYP` **containing "master"** (e.g. `Master Dark`).
- WBPP's own re-detection: `IMAGETYP` contains "master" → else fall back to **"master" in the path/filename** (e.g. `masterDarks/`, `masterDark.xisf`).
- Masters from raw `ImageIntegration` (not WBPP) may have neither and rely on the path/name fallback; `NCOMBINE` may be present.
- Sources: https://pixinsight.com/forum/index.php?threads/scrpt-wbp.16660/ , Landmann preprocessing guide.

### Conclusion
Master-ness is **tool-specific** and cannot be a single keyword check. It must be a set of per-tool detectors combined by OR. Base frame type comes from `IMAGETYP` regardless of master-ness; masters are distinguished from each other by **filter + exposure**.

## Architecture decision: a dedicated, extensible detector crate

**Decision**: a new narrow library crate `crates/calibration/master-detect` exposing a pluggable detector system so new tools are trivial to add.

```rust
/// Inputs a detector inspects (derived from extracted metadata + file location).
pub struct DetectInput<'a> {
    pub imagetyp: Option<&'a str>,     // raw IMAGETYP value
    pub stack_count: Option<u32>,      // STACKCNT or NCOMBINE
    pub file_name: &'a str,
    pub rel_path: &'a str,
}

pub struct MasterDetection {
    pub frame_type: FrameType,         // base type (Dark/Bias/Flat/Light/DarkFlat); OFFSET→Bias
    pub is_master: bool,
    pub detector: &'static str,        // provenance — which detector matched
}

pub trait MasterDetector: Send + Sync {
    fn id(&self) -> &'static str;
    /// Some(..) if this detector recognizes the file as a (master) calibration frame.
    fn detect(&self, input: &DetectInput) -> Option<MasterDetection>;
}

pub fn detectors() -> Vec<Box<dyn MasterDetector>>;          // registry (ordered)
pub fn detect_master(input: &DetectInput) -> Option<MasterDetection>; // first match wins
```

**Detectors (initial):**
- `SirilDetector` — base type from `IMAGETYP` (dark/bias/offset→bias/flat/light); `is_master` if `stack_count > 1` **||** `file_name`/`rel_path` contains `_stacked` **||** contains `master`.
- `PixInsightDetector` — base type from `IMAGETYP` (after stripping "master"); `is_master` if `imagetyp` contains `master` **||** path/name contains `master` **||** `_stacked`.

(Per the user's shorthand: `siril_detection -> STACKCNT & IMAGETYP=dark/bias/flat || _stacked || master`; `pixinsight_detection -> IMAGETYP="Master" & IMAGETYP=dark/flat/bias || master || _stacked`.)

Overlap between detectors is fine — `detect_master` returns the first match and records which detector fired (provenance, per constitution §II confidence/attribution). Adding a future tool = one new `impl MasterDetector` added to `detectors()`.

**Crate boundaries**: depends only on `metadata/core` (for `FrameType` + a base-type parser) — NOT on `domain/core` (calibration logic stays out of the domain crate) and NOT on persistence/UI. Pure, fast unit tests with table-driven fixtures per tool.

**`STACKCNT` threshold (decided)**: `> 1` (strict) — a single frame with STACKCNT=1 is not a master.
