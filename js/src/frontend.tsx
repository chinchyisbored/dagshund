import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.tsx";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element not found — check index.html has a div#root");
}

const app = (
  <StrictMode>
    <App />
  </StrictMode>
);

if (import.meta.hot) {
  if (!import.meta.hot.data.root) {
    import.meta.hot.data.root = createRoot(rootElement);
  }
  const root = import.meta.hot.data.root;
  root.render(app);
} else {
  createRoot(rootElement).render(app);
}
