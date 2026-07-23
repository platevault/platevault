# Astro Library Manager

Astro Library Manager is a local-first desktop application for astrophotography
library organization, acquisition/calibration metadata, target/session/project
mapping, processing-tool preparation, project lifecycle tracking, and safe
cleanup/archive planning.

Use SpecKit for product and implementation workflow. The active feature lives
under `specs/001-astro-library-manager/`.

Do not implement product behavior before the relevant SpecKit `plan.md`,
`research.md`, `data-model.md`, `contracts/`, and `tasks.md` exist.

Preserve the product boundary: processing tools such as PixInsight/WBPP,
planetary/lunar tools, and future Siril profiles process images/video; this app
organizes, maps, prepares, observes, documents, and plans filesystem work.

Keep dependencies deliberate. Add heavy parser, database, Tauri, and UI
dependencies only when the SpecKit plan/tasks call for them.

Prefer small Rust crates with narrow responsibility. This keeps unit tests fast
and avoids rebuilding parser, UI, or database dependencies for pure-domain
changes.

See `PRODUCT.md` for product intent, users, design principles, and accessibility
requirements.
