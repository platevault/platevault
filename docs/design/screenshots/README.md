# App screenshots

Full-window captures of the Astro Library Manager desktop app, taken from the
real Windows build (`desktop_shell.exe`) via the MCP bridge at 2660×1194.

Two sets:
- **Page catalogue** (`NN-*.png`) — every page in its empty/default state.
- **Data + flow series** (`data-NN-*.png`) — the app populated with a generated
  demo library (100 FITS: 39 lights across M 31 / NGC 7000 / M 42, 41
  calibration darks/flats/bias, 3 masters, 17 inbox files), captured through the
  ingestion → classification → plan → apply flow. Each filename states the order
  and what the frame shows.

## Data + flow series (ordered)
| File | State |
|------|-------|
| `data-01-inbox-overview-populated.png` | Inbox with 7 classified detection groups (3 masters, 97 images) |
| `data-02-inbox-light-frames-IC1396-selected.png` | Light-frame group selected — breakdown + destination preview + file metadata |
| `data-03-inbox-dark-frames-selected.png` | Dark-frame group selected |
| `data-04-inbox-master-dark-selected.png` | Master-dark detection selected |
| `data-05-inbox-master-bias-selected.png` | Master-bias detection selected |
| `data-06-inbox-calibration-root-multitype-selected.png` | Mixed calibration root (multiple frame types) selected |
| `data-07-inbox-grouped-by-frametype-then-filter.png` | Multi-level grouping: Frame type → Filter |
| `data-08-inbox-mixed-folder-split-plan-generated.png` | Mixed folder → reviewable split plan (catalogue actions) |
| `data-09-inbox-after-calibration-applied-6-remaining.png` | Calibration plan applied; 6 groups remain |
| `data-10-inbox-lights-plan-open-catalogue.png` | Lights group → Confirm to inventory → open catalogue plan |
| `data-11-inbox-empty-after-confirm.png` | All groups confirmed; inbox empty |
| `data-12-calibration-populated-3-masters.png` | Calibration page: 3 masters · 1 dark · 1 flat · 1 bias |
| `data-13-calibration-dark-master-detail-selected.png` | Dark master selected — detail/suggestions |
| `data-14-sessions-empty-pending-ingestion.png` | Sessions empty — cataloguing indexes files; session-grouping pending |
| `data-15-targets-search-ngc7000.png` | Targets filtered to NGC 7000 |
| `data-16-target-ngc7000-detail-aliases.png` | Target detail — identity, SIMBAD OID, 7 aliases |

## Page catalogue — setup wizard
| File | Page |
|------|------|
| `18-wizard-1-source-folders.png` | Step 1 — Source folders |
| `19-wizard-2-processing-tools.png` | Step 2 — Processing tools |
| `20-wizard-3-configuration.png` | Step 3 — Configuration |
| `21-wizard-4-confirm.png` | Step 4 — Confirm |
| `22-wizard-5-scan.png` | Step 5 — Scan |

## Page catalogue — main app
| File | Page |
|------|------|
| `01-inbox.png` | Inbox |
| `02-sessions.png` | Sessions |
| `03-calibration.png` | Calibration |
| `04-targets.png` | Targets |
| `05-projects.png` | Projects |
| `06-archive.png` | Archive |

## Page catalogue — settings
| File | Page |
|------|------|
| `07-settings-data-sources.png` | Data Sources |
| `08-settings-equipment.png` | Equipment |
| `09-settings-ingestion.png` | Ingestion |
| `10-settings-naming-structure.png` | Naming & Structure (incl. per-type destination patterns) |
| `11-settings-processing-tools.png` | Processing Tools |
| `12-settings-calibration-matching.png` | Calibration Matching |
| `13-settings-target-resolution.png` | Target Resolution |
| `14-settings-cleanup.png` | Cleanup |
| `15-settings-general.png` | General |
| `16-settings-advanced.png` | Advanced |
| `17-settings-audit-log.png` | Audit Log |
