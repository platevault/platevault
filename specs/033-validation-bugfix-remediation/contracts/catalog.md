# Contract: Catalog Integrity (FR-026, FR-027, FR-028, FR-029)

Decisions **D3** (slug enum), **D5** (minisign). Fixes spec 014/013.

## Signature verification
- A catalog manifest's minisign `signature` MUST be cryptographically verified against the embedded
  trusted public key before any catalog data is accepted (FR-026). Invalid/tampered ⇒ `ManifestSignatureInvalid`.
- SHA-256 checksum remains as a complementary check.

## License
- License codes are validated against a recognized closed set. An unrecognized code ⇒ **hard-fail**
  (FR-027). No silent fallback to `PublicDomain`.

## Slugs
- Canonical catalog slug enum (D3): `common | openngc | abell_pn`.
- The licensing layer's strings are corrected to this enum (`opengc`→`openngc`). Unknown slug ⇒ reject
  (no silent `Unknown` skip) (FR-029).

## Atomicity
- Catalog upsert + attribution are written in a single transaction; interruption leaves neither (FR-028).

## Origin guard
- The `origin.not_implemented` guard becomes reachable (an `origin` field exists on the request so the
  error code can actually fire) — FR-009 of spec 014.

## Conformance / tests (on fixtures; real downloads externally blocked)
- Test: valid signature accepted; tampered signature rejected.
- Test: unknown license code rejected (not downgraded).
- Test: unknown slug rejected; known slugs resolve.
- Test: interrupted upsert leaves no partial catalog/attribution.
