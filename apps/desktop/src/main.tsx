import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { MantineProvider, createTheme } from "@mantine/core";

import { AppProviders } from "./app/providers";
import { router } from "./app/router";
import "./styles.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Missing root element.");
}

const desktopTheme = createTheme({
  fontFamily: `Aptos, "Segoe UI Variable Text", "Segoe UI", Inter, "Noto Sans", system-ui, sans-serif`,
  fontFamilyMonospace: 'var(--font-mono)',
  defaultRadius: "sm",
  fontSizes: {
    xs: "11px",
    sm: "12px",
    md: "13px",
    lg: "14px",
    xl: "16px",
  },
  headings: {
    fontFamily: `Aptos, "Segoe UI Variable Text", "Segoe UI", Inter, "Noto Sans", system-ui, sans-serif`,
    sizes: {
      h1: { fontSize: "1.1rem", lineHeight: "1.35" },
      h2: { fontSize: "1rem", lineHeight: "1.32" },
      h3: { fontSize: "0.95rem", lineHeight: "1.3" },
      h4: { fontSize: "0.9rem", lineHeight: "1.28" },
      h5: { fontSize: "0.85rem", lineHeight: "1.26" },
      h6: { fontSize: "0.8rem", lineHeight: "1.24" },
    },
  },
  components: {
    Button: {
      defaultProps: {
        size: "xs",
        radius: "sm",
      },
    },
    ActionIcon: {
      defaultProps: {
        size: "xs",
        variant: "default",
        radius: "sm",
      },
    },
    TextInput: {
      defaultProps: {
        size: "xs",
      },
    },
    Select: {
      defaultProps: {
        size: "xs",
      },
    },
    MultiSelect: {
      defaultProps: {
        size: "xs",
      },
    },
    SegmentedControl: {
      defaultProps: {
        size: "xs",
      },
    },
    Tabs: {
      defaultProps: {
        size: "xs",
      },
    },
    Table: {
      defaultProps: {
        verticalSpacing: 2,
        horizontalSpacing: "xs",
      },
    },
    Modal: {
      defaultProps: {
        centered: true,
        radius: "sm",
      },
    },
    Menu: {
      defaultProps: {
        shadow: "sm",
        width: 180,
      },
    },
    Paper: {
      defaultProps: {
        withBorder: true,
        radius: "sm",
      },
    },
  },
});

createRoot(rootElement).render(
  <StrictMode>
    <MantineProvider theme={desktopTheme}>
      <AppProviders>
        <RouterProvider router={router} />
      </AppProviders>
    </MantineProvider>
  </StrictMode>,
);
