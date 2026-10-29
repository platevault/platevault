/**
 * The frontend's providers, outermost first: the library query cache
 * (api/query.ts), then the router, whose root route renders the shell
 * (app/shell.tsx) and its error surfaces. main.tsx mounts it with the hash
 * router and a fresh query client; tests mount it with a memory history.
 */
import { type QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider } from "@tanstack/react-router"
import type { AppRouter } from "@/routes"

export function AppRoot({ router, client }: { router: AppRouter; client: QueryClient }) {
  return (
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}
