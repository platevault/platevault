# Contract Schema Layout

Canonical operation contracts live here as JSON Schema Draft 2020-12 documents.

Planned layout:

```text
schemas/
├── envelope.schema.json
├── errors.schema.json
├── domain/
│   ├── library-root.schema.json
│   ├── file-record.schema.json
│   ├── target.schema.json
│   ├── session.schema.json
│   ├── project.schema.json
│   ├── source-view.schema.json
│   ├── cleanup.schema.json
│   └── plan.schema.json
└── operations/
    ├── library.schema.json
    ├── ingest.schema.json
    ├── projects.schema.json
    ├── source-views.schema.json
    ├── lifecycle-cleanup.schema.json
    ├── targets.schema.json
    └── settings-rules.schema.json
```

Rules:

- JSON Schema is the contract source of truth.
- TypeScript declarations are generated from these schemas.
- Rust DTOs must be generated from or tested against these schemas.
- Tauri commands are transport adapters, not canonical contracts.
- OpenAPI can be generated later as an HTTP projection.
