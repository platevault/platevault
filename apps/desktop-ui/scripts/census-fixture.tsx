import { createElement } from "react"
import { createRoot } from "react-dom/client"
function Button({ children, variant = "default", size = "default" }: { children?: React.ReactNode; variant?: string; size?: string }) {
  return createElement("button", { "data-slot": "button", "data-variant": variant, "data-size": size }, children)
}

function CensusFixture() {
  return createElement(
    "main",
    { id: "main", "aria-label": "Census fixture" },
    createElement("header", null, createElement(Button, { variant: "default", size: "sm" }, "Open library")),
    createElement("section", { "data-component": "DataTable" },
      createElement("table", { "data-census-datatable": "true" },
        createElement("thead", null,
          createElement("tr", null,
            createElement("th", { "aria-sort": "ascending" }, "Name"),
            createElement("th", { "data-column-kind": "selection" }, "Select"),
            createElement("th", { "data-column-kind": "action" }, "Actions"),
            createElement("th", { "data-column-kind": "static" }, "Preview"),
          ),
        ),
      ),
    ),
    createElement("p", null, "Fixture page for exercising the rendered census before app routes exist."),
  )
}

createRoot(document.getElementById("root")!).render(createElement(CensusFixture))

