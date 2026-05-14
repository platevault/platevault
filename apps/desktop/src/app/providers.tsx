import { createContext, useContext, useMemo, type ReactNode } from "react";

import type {
  AlmClient,
  AlmTransport,
  OperationEvent,
  OperationId,
  ResponseEnvelope,
  TypedRequestEnvelope,
} from "@astro-plan/contracts";
import { createAlmClient } from "@astro-plan/contracts";

interface FeatureServiceRegistry {
  readonly library: {
    readonly registerRootOperation: "library.root.register";
    readonly scanStartOperation: "library.scan.start";
    readonly inventoryQueryOperation: "library.inventory.query";
  };
  readonly ingest: {
    readonly metadataExtractOperation: "metadata.extract.start";
  };
  readonly projects: {
    readonly structurePlanOperation: "project.structure.plan_create";
  };
}

interface AppServices {
  readonly almClient: AlmClient;
  readonly connectionState: "placeholder";
  readonly features: FeatureServiceRegistry;
}

const AppServicesContext = createContext<AppServices | null>(null);

export function AppProviders({ children }: { children: ReactNode }) {
  const services = useMemo<AppServices>(() => {
    const transport = createPlaceholderTransport();

    return {
      almClient: createAlmClient(transport),
      connectionState: "placeholder",
      features: {
        library: {
          registerRootOperation: "library.root.register",
          scanStartOperation: "library.scan.start",
          inventoryQueryOperation: "library.inventory.query",
        },
        ingest: {
          metadataExtractOperation: "metadata.extract.start",
        },
        projects: {
          structurePlanOperation: "project.structure.plan_create",
        },
      },
    };
  }, []);

  return <AppServicesContext.Provider value={services}>{children}</AppServicesContext.Provider>;
}

export function useAppServices(): AppServices {
  const services = useContext(AppServicesContext);

  if (!services) {
    throw new Error("useAppServices must be used within AppProviders.");
  }

  return services;
}

function createPlaceholderTransport(): AlmTransport {
  return {
    async send<TRequest = unknown, TResponse = unknown>(
      envelope: TypedRequestEnvelope<TRequest>,
    ): Promise<ResponseEnvelope<TResponse>> {
      return {
        contractVersion: envelope.contractVersion,
        requestId: envelope.requestId,
        status: "error",
        error: {
          code: "transport.placeholder",
          message: "The Tauri operation transport is not connected yet.",
          severity: "blocking",
          retryable: false,
          details: {
            operation: envelope.operation,
          },
        },
      };
    },

    subscribe(_operationId: OperationId): AsyncIterable<OperationEvent> {
      return {
        async *[Symbol.asyncIterator](): AsyncIterator<OperationEvent> {
          return;
        },
      };
    },
  };
}
