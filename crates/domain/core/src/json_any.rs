//! `JsonAny` — wire-equivalent to `serde_json::Value`, opaque in TypeScript.
//!
//! Used in contract fields whose JSON shape is intentionally free-form
//! (provenance `value`/`current`, error `details`). `serde_json::Value`
//! itself is impl'd by specta as a recursive inline enum, which makes the
//! generated TS infinite. `JsonAny` keeps the wire format identical (via
//! `serde(transparent)`) while emitting as `unknown` in TS through
//! `specta_typescript::Unknown`'s opaque-reference machinery.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::datatype::{DataType, Reference};
use specta::Type;

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(transparent)]
pub struct JsonAny(pub serde_json::Value);

impl JsonAny {
    #[must_use]
    pub const fn new(value: serde_json::Value) -> Self {
        Self(value)
    }
}

impl From<serde_json::Value> for JsonAny {
    fn from(value: serde_json::Value) -> Self {
        Self(value)
    }
}

impl From<JsonAny> for serde_json::Value {
    fn from(value: JsonAny) -> serde_json::Value {
        value.0
    }
}

impl Type for JsonAny {
    fn definition(types: &mut specta::Types) -> DataType {
        // `specta_typescript::Unknown` is a public marker whose Type impl
        // emits `Reference::opaque(opaque::Unknown)`. Specta-typescript
        // exporters render this as the TS keyword `unknown`. Delegating
        // here keeps the contract crate from depending on the private
        // `opaque::Unknown` marker directly.
        <specta_typescript::Unknown as Type>::definition(types)
    }
}

// Keep the `Reference` import alive — it documents the DataType variant
// `specta_typescript::Unknown` produces. (No direct construction here.)
#[allow(dead_code)]
const _REF: std::marker::PhantomData<Reference> = std::marker::PhantomData;
