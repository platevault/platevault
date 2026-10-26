/**
 * TanStack Query over the library IPC boundary (`./ipc`).
 *
 * The Rust catalog is the truth and the query cache only holds its last
 * reads. Every library read is a query keyed by `libraryKey`, so
 * invalidating `libraryKey(command)` reaches every read of that command
 * whatever its arguments. Invalidate after a write succeeds, never before.
 *
 * Local IPC needs no network: queries and mutations run with
 * `networkMode: "always"`, so a machine without internet never pauses a
 * library read or write. A failed read or write is not retried, because a
 * refusal does not change by asking again and the user sees it at once.
 */
import { QueryClient, queryOptions } from "@tanstack/react-query"
import { data, library, type LibraryArgs, type LibraryCommand } from "./ipc"

/** The query client of the library frontend, with its local-IPC defaults. */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        networkMode: "always",
        retry: false,
        // The library's own events and the writes' invalidations refresh it;
        // focus and connectivity say nothing about a local catalog.
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
      mutations: { networkMode: "always", retry: false },
    },
  })
}

/** The key of a library read: the command, then a prefix of its arguments. */
export function libraryKey<C extends LibraryCommand>(command: C, ...args: Partial<LibraryArgs<C>>) {
  return ["library", command, ...args] as const
}

/** The query that reads `command` with `args` from the library. */
export function libraryQuery<C extends LibraryCommand>(command: C, ...args: LibraryArgs<C>) {
  return queryOptions({
    queryKey: libraryKey(command, ...args),
    queryFn: () => data(library[command](...args)),
  })
}
