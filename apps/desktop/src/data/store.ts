import { useSyncExternalStore, useCallback } from 'react';

type Listener = () => void;

export interface QueryState<T> {
  data: T | undefined;
  loading: boolean;
  error: Error | undefined;
}

export interface QueryStore<T> {
  subscribe: (listener: Listener) => () => void;
  getSnapshot: () => QueryState<T>;
  fetch: () => Promise<void>;
  invalidate: () => void;
}

/**
 * Creates a reactive query store backed by useSyncExternalStore.
 * Fetches data via the provided async fetcher and notifies subscribers
 * on state changes (loading, data, error).
 */
export function createQueryStore<T>(fetcher: () => Promise<T>): QueryStore<T> {
  let state: QueryState<T> = {
    data: undefined,
    loading: false,
    error: undefined,
  };
  const listeners = new Set<Listener>();

  function notify() {
    for (const listener of listeners) {
      listener();
    }
  }

  function subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function getSnapshot(): QueryState<T> {
    return state;
  }

  async function fetch(): Promise<void> {
    if (state.loading) return;
    state = { ...state, loading: true, error: undefined };
    notify();
    try {
      const data = await fetcher();
      state = { data, loading: false, error: undefined };
    } catch (err) {
      state = {
        ...state,
        loading: false,
        error: err instanceof Error ? err : new Error(String(err)),
      };
    }
    notify();
  }

  function invalidate(): void {
    state = { data: undefined, loading: false, error: undefined };
    notify();
    void fetch();
  }

  return { subscribe, getSnapshot, fetch, invalidate };
}

/**
 * Hook that subscribes a component to a QueryStore. Triggers initial fetch
 * if data is not yet loaded.
 */
export function useQuery<T>(store: QueryStore<T>): QueryState<T> {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);

  // Trigger initial fetch if no data and not loading
  if (snapshot.data === undefined && !snapshot.loading && !snapshot.error) {
    void store.fetch();
  }

  return snapshot;
}

/**
 * Invalidates one or more stores. Useful after mutations to trigger
 * dependent queries to re-fetch.
 */
export function invalidateStores(...stores: QueryStore<unknown>[]): void {
  for (const store of stores) {
    store.invalidate();
  }
}

/**
 * Creates a parameterized query store factory. Each unique key gets its own
 * store instance, enabling per-entity caching (e.g., getSession(id)).
 */
export function createParameterizedStore<TArgs extends string | number, T>(
  fetcher: (args: TArgs) => Promise<T>,
): {
  get: (args: TArgs) => QueryStore<T>;
  invalidate: (args: TArgs) => void;
  invalidateAll: () => void;
} {
  const stores = new Map<TArgs, QueryStore<T>>();

  function get(args: TArgs): QueryStore<T> {
    let store = stores.get(args);
    if (!store) {
      store = createQueryStore(() => fetcher(args));
      stores.set(args, store);
    }
    return store;
  }

  function invalidate(args: TArgs): void {
    const store = stores.get(args);
    if (store) {
      store.invalidate();
    }
  }

  function invalidateAll(): void {
    for (const store of stores.values()) {
      store.invalidate();
    }
  }

  return { get, invalidate, invalidateAll };
}

/**
 * Hook for parameterized stores. Returns the query state for the given key.
 */
export function useParameterizedQuery<TArgs extends string | number, T>(
  factory: ReturnType<typeof createParameterizedStore<TArgs, T>>,
  args: TArgs,
): QueryState<T> {
  const store = factory.get(args);
  return useQuery(store);
}

/**
 * Creates a mutation helper that calls an async function, then invalidates
 * related stores on success. Returns a hook-compatible callable.
 */
export function createMutation<TArgs, TResult>(
  mutationFn: (args: TArgs) => Promise<TResult>,
  onSuccess?: (result: TResult) => void,
): (args: TArgs) => Promise<TResult> {
  return async (args: TArgs) => {
    const result = await mutationFn(args);
    onSuccess?.(result);
    return result;
  };
}
