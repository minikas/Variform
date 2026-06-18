import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "figma-kit/styles.css";
import "./ui.css";
import { PluginCommands, MessageTypes, PluginMessage } from "./types.d";
import { ExportView } from "./views/ExportView";
import { ExportJSON } from "./views/ExportJSON";
import { ExportCSV } from "./views/ExportCSV";
import { ExportCSS } from "./views/ExportCSS";
import { ExportJS } from "./views/ExportJS";
import { SelectionProvider } from "./contexts/SelectionContext";
import { InspectProvider } from "./contexts/InspectContext";
import { InspectDialog } from "./components/InspectDialog";

/**
 * Main App component that routes to format-specific views based on command
 */
const App: React.FC = () => {
    const [command, setCommand] = useState<PluginCommands>(PluginCommands.EXPORT_GENERIC);
    const [editorType, setEditorType] = useState<string>("");

    useEffect(() => {
        // Listen for command from plugin code
        const handleMessage = ({ data: { pluginMessage } }: { data: { pluginMessage: PluginMessage } }) => {
            if (pluginMessage.type === MessageTypes.BASIC_INFO && pluginMessage.command) {
                setCommand(pluginMessage.command);
                setEditorType(pluginMessage.editorType || "");
            }
            // Don't prevent other messages from reaching child components
        };
        
        window.addEventListener('message', handleMessage);
        
        return () => {
            window.removeEventListener('message', handleMessage);
        };
    }, []);

    // Render appropriate view based on command
    switch (command) {
        case PluginCommands.EXPORT_JSON:
            return <ExportJSON editorType={editorType} />;
        case PluginCommands.EXPORT_CSV:
            return <ExportCSV editorType={editorType} />;
        case PluginCommands.EXPORT_CSS:
            return <ExportCSS editorType={editorType} />;
        case PluginCommands.EXPORT_JS:
            return <ExportJS editorType={editorType} />;
        case PluginCommands.EXPORT_GENERIC:
        default:
            return <ExportView editorType={editorType} />;
    }
};

// Module-scope singleton — created once, never re-created on render.
// Conservative defaults: GitHub REST is rate-limited and the plugin iframe
// gains/loses focus constantly, so auto-refetching is disabled and writes
// (push/connect/unlock) never auto-retry.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchOnMount: false,
    },
    mutations: {
      retry: 0,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <SelectionProvider>
        <InspectProvider>
          <App />
          <InspectDialog />
        </InspectProvider>
      </SelectionProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
