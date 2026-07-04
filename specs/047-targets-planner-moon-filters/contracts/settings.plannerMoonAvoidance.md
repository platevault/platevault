# Contract delta: spec-018 settings surface — `plannerMoonAvoidance` (spec 047)

**No new IPC commands.** Track A compute is frontend-only (ADR-0001);
`target.list` already carries `raDeg`/`decDeg`/`magnitude`/`constellation`.
The only contract change is extending the existing spec-018 settings
operations with one new key.

## Affected contracts (spec-018 owned; extended, not versioned-breaking)

| Contract | Change |
| --- | --- |
| `specs/018-settings-configuration-model/contracts/settings.get.json` | response `settings` object gains `plannerMoonAvoidance` |
| `specs/018-settings-configuration-model/contracts/settings.update.json` | `key` enum gains `"plannerMoonAvoidance"`; value branch below |
| `specs/018-settings-configuration-model/contracts/settings.restore-defaults.json` | key list gains `"plannerMoonAvoidance"` |
| `crates/contracts/core` `SettingsState` DTO | new field `plannerMoonAvoidance` (serde default = shipped defaults) |
| Generated TS (`packages/contracts` / `@/bindings`) | regenerated from the above |

Additive key with a serde default → existing persisted stores and older
payloads hydrate cleanly; contract version unchanged (same policy as prior
key additions, e.g. per-frame-type patterns).

## Value schema

```jsonc
// settings.update request value for key = "plannerMoonAvoidance"
{
  "type": "object",
  "required": ["L", "R", "G", "B", "Ha", "SII", "OIII"],
  "additionalProperties": false,
  "patternProperties-note": "exactly the seven fixed band keys",
  "bandValue": {
    "type": "object",
    "required": ["distanceDeg", "widthDays"],
    "additionalProperties": false,
    "properties": {
      "distanceDeg": { "type": "number", "minimum": 0, "maximum": 180 },
      "widthDays": { "type": "number", "minimum": 0.5, "maximum": 30 }
    }
  }
}
```

Validation errors use the established `value.invalid` error code with a
band-specific message (e.g. `plannerMoonAvoidance.OIII.distanceDeg must be in
[0, 180]`), registered in the spec-046 error-code registry if a new code is
needed (expected: reuse `value.invalid`).

## Default value

```json
{
  "L":    { "distanceDeg": 120, "widthDays": 14 },
  "R":    { "distanceDeg": 120, "widthDays": 14 },
  "G":    { "distanceDeg": 120, "widthDays": 14 },
  "B":    { "distanceDeg": 120, "widthDays": 14 },
  "Ha":   { "distanceDeg": 60,  "widthDays": 7 },
  "SII":  { "distanceDeg": 60,  "widthDays": 7 },
  "OIII": { "distanceDeg": 110, "widthDays": 10 }
}
```

## Cross-track note

Track B (spec 044) consumes this key for its per-band moon-free-time
integration. It MUST NOT define a second parameter store or a
`min_lunar_separation_deg`-style scalar (that knob is dead per the Track B
handover). Ownership of the key, defaults, and validation is spec 047.
