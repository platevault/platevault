import type {
  ContractError,
  ErrorResponseEnvelope,
  OkResponseEnvelope,
  OperationEvent,
  OperationHandle,
  OperationId,
  OperationName,
  RequestEnvelope,
} from "./generated/envelope";

export type TypedRequestEnvelope<TPayload = unknown> = Omit<RequestEnvelope, "payload"> & {
  payload: TPayload;
};

export type TypedOkResponseEnvelope<TPayload = unknown> = Omit<
  OkResponseEnvelope,
  "payload"
> & {
  payload: TPayload;
};

export type ResponseEnvelope<TPayload = unknown> =
  | TypedOkResponseEnvelope<TPayload>
  | ErrorResponseEnvelope;

export interface AlmCancellationSignal {
  readonly aborted: boolean;
  readonly reason?: unknown;
}

export interface ExecuteOperationOptions {
  requestId?: string;
  signal?: AlmCancellationSignal;
}

export interface SubscribeOperationOptions {
  signal?: AlmCancellationSignal;
  afterSequence?: number;
}

export interface AlmClient {
  execute<TRequest = unknown, TResponse = unknown>(
    operation: OperationName,
    request: TRequest,
    options?: ExecuteOperationOptions,
  ): Promise<TResponse>;

  subscribe(
    operationId: OperationId,
    options?: SubscribeOperationOptions,
  ): AsyncIterable<OperationEvent>;
}

export interface AlmTransport {
  send<TRequest = unknown, TResponse = unknown>(
    envelope: TypedRequestEnvelope<TRequest>,
    options?: ExecuteOperationOptions,
  ): Promise<ResponseEnvelope<TResponse>>;

  subscribe(
    operationId: OperationId,
    options?: SubscribeOperationOptions,
  ): AsyncIterable<OperationEvent>;
}

export interface AlmClientOptions {
  contractVersion?: "1.0.0";
  createRequestId?: () => string;
}

export class AlmContractError extends Error {
  public readonly contractError: ContractError;
  public readonly requestId: string;

  public constructor(requestId: string, contractError: ContractError) {
    super(contractError.message);
    this.name = "AlmContractError";
    this.requestId = requestId;
    this.contractError = contractError;
  }
}

let requestCounter = 0;

export function createAlmClient(
  transport: AlmTransport,
  options: AlmClientOptions = {},
): AlmClient {
  const contractVersion = options.contractVersion ?? "1.0.0";
  const createRequestId = options.createRequestId ?? createDefaultRequestId;

  return {
    async execute<TRequest = unknown, TResponse = unknown>(
      operation: OperationName,
      request: TRequest,
      executeOptions: ExecuteOperationOptions = {},
    ): Promise<TResponse> {
      const requestId = executeOptions.requestId ?? createRequestId();
      const envelope: TypedRequestEnvelope<TRequest> = {
        contractVersion,
        operation,
        requestId,
        payload: request,
      };
      const response = await transport.send<TRequest, TResponse>(envelope, executeOptions);

      if (response.status === "error") {
        throw new AlmContractError(response.requestId, response.error);
      }

      return response.payload;
    },

    subscribe(
      operationId: OperationId,
      subscribeOptions?: SubscribeOperationOptions,
    ): AsyncIterable<OperationEvent> {
      return transport.subscribe(operationId, subscribeOptions);
    },
  };
}

function createDefaultRequestId(): string {
  requestCounter += 1;
  return `req_${Date.now().toString(36)}_${requestCounter.toString(36)}`;
}

export type { ContractError, OperationEvent, OperationHandle, OperationId, OperationName };
