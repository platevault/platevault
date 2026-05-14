//! Tauri command adapter boundary for operation envelopes.

use contracts_core::{ContractError, ErrorSeverity, RequestEnvelope, RequestId, ResponseEnvelope};
use serde_json::{json, Value};

pub trait OperationCommandDispatcher {
    fn dispatch(&self, request: RequestEnvelope<Value>) -> ResponseEnvelope<Value>;
}

#[derive(Clone, Debug)]
pub struct TauriCommandAdapter<D> {
    dispatcher: D,
}

impl<D> TauriCommandAdapter<D>
where
    D: OperationCommandDispatcher,
{
    #[must_use]
    pub const fn new(dispatcher: D) -> Self {
        Self { dispatcher }
    }

    #[must_use]
    pub fn execute_envelope(&self, envelope: Value) -> ResponseEnvelope<Value> {
        let fallback_request_id = extract_request_id(&envelope);

        match serde_json::from_value::<RequestEnvelope<Value>>(envelope) {
            Ok(request) => self.dispatcher.dispatch(request),
            Err(error) => ResponseEnvelope::error(
                fallback_request_id,
                ContractError::new(
                    "validation.request_envelope_invalid",
                    "Request envelope is invalid.",
                    ErrorSeverity::Blocking,
                    false,
                )
                .with_details(json!({ "error": error.to_string() })),
            ),
        }
    }
}

fn extract_request_id(envelope: &Value) -> RequestId {
    RequestId(envelope.get("requestId").and_then(Value::as_str).unwrap_or("unknown").to_owned())
}

#[cfg(test)]
mod tests {
    use contracts_core::{OperationName, ResponseStatus};
    use serde_json::json;

    use super::{
        OperationCommandDispatcher, RequestEnvelope, ResponseEnvelope, TauriCommandAdapter,
    };

    struct EchoDispatcher;

    impl OperationCommandDispatcher for EchoDispatcher {
        fn dispatch(
            &self,
            request: RequestEnvelope<serde_json::Value>,
        ) -> ResponseEnvelope<serde_json::Value> {
            ResponseEnvelope::ok(
                request.request_id,
                json!({
                    "operation": request.operation,
                    "payload": request.payload
                }),
            )
        }
    }

    #[test]
    fn dispatches_valid_operation_envelope() {
        let adapter = TauriCommandAdapter::new(EchoDispatcher);
        let response = adapter.execute_envelope(json!({
            "contractVersion": "1.0.0",
            "operation": "library.scan.start",
            "requestId": "req-1",
            "payload": { "rootIds": ["root-1"] }
        }));

        assert_eq!(response.status, ResponseStatus::Ok);
        assert_eq!(
            response.payload.unwrap(),
            json!({
                "operation": OperationName("library.scan.start".to_owned()),
                "payload": { "rootIds": ["root-1"] }
            })
        );
    }

    #[test]
    fn converts_invalid_envelope_to_contract_error_response() {
        let adapter = TauriCommandAdapter::new(EchoDispatcher);
        let response = adapter.execute_envelope(json!({
            "requestId": "req-1",
            "payload": {}
        }));

        assert_eq!(response.status, ResponseStatus::Error);
        assert_eq!(response.error.unwrap().code, "validation.request_envelope_invalid");
    }
}
