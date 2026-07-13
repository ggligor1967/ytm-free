import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

type ImportMetaWithMode = ImportMeta & {
  readonly env?: {
    readonly MODE?: string;
  };
};

async function bootstrap(): Promise<void> {
  if ((import.meta as ImportMetaWithMode).env?.MODE === "wdio") {
    await import("@wdio/tauri-plugin");
  }

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void bootstrap().catch((error: unknown) => {
  console.error("YTM-Free bootstrap failed", error);
});
