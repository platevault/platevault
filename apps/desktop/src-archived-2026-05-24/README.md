# Desktop Frontend Source Layout

The desktop UI lives here once the React/Vite scaffold is installed.

Planned layout:

```text
src/
├── app/
│   ├── App.tsx
│   ├── routes.tsx
│   └── providers.tsx
├── components/
│   ├── layout/
│   ├── navigation/
│   ├── feedback/
│   └── forms/
├── features/
│   ├── library/
│   ├── ingest/
│   ├── projects/
│   ├── source-views/
│   ├── lifecycle/
│   ├── targets/
│   └── settings/
├── routes/
└── services/
    └── alm-client/
```

Rules:

- React components call feature services or hooks, not Tauri commands directly.
- All backend communication goes through the `AlmClient` contract boundary.
- Product UI work must run the `$impeccable` product-UI preflight and shape gate
  before implementing screens or design-sensitive components.
- Tool surfaces should be dense, readable, and safe for repeated operational
  use. Avoid marketing-style hero layouts inside the application.
