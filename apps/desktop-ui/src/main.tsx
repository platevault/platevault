import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { createQueryClient } from "@/api/query"
import "@/app/preferences"
import { AppRoot } from "@/app/root"
import { createAppRouter } from "@/routes"
import "./index.css"

const root = document.getElementById("root")
if (!root) throw new Error("Missing frontend root element")

createRoot(root).render(
  <StrictMode>
    <AppRoot router={createAppRouter()} client={createQueryClient()} />
  </StrictMode>,
)
