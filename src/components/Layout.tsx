import { ReactNode, useState, useEffect } from "react";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { TopBar } from "@/components/TopBar";

interface LayoutProps {
  children: (props: {
    model: string;
    temperature: number;
    jsonMode: boolean;
    useWebSearch: boolean;
    systemInstruction: string;
    sessionId: string | null;
    onSessionCreated: (sessionId: string) => void;
    onNewSession: () => void;
  }) => ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const [model, setModel] = useState("gemini-2.5-flash");
  const [temperature, setTemperature] = useState(0.7);
  const [jsonMode, setJsonMode] = useState(false);
  const [useWebSearch, setUseWebSearch] = useState(false);
  const [systemInstruction, setSystemInstruction] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionKey, setSessionKey] = useState(0);

  // Set dark theme by default
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  const handleNewSession = () => {
    setSessionId(null);
    setSessionKey(prev => prev + 1);
  };

  const handleSessionCreated = (newSessionId: string) => {
    setSessionId(newSessionId);
  };

  const handleSessionSelect = (selectedSessionId: string) => {
    setSessionId(selectedSessionId);
    setSessionKey(prev => prev + 1);
  };

  return (
    <SidebarProvider defaultOpen={true}>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar 
          onNewSession={handleNewSession}
          activeSessionId={sessionId}
          onSessionSelect={handleSessionSelect}
        />
        <div className="flex-1 flex flex-col">
          <TopBar
            model={model}
            setModel={setModel}
            temperature={temperature}
            setTemperature={setTemperature}
            jsonMode={jsonMode}
            setJsonMode={setJsonMode}
            useWebSearch={useWebSearch}
            setUseWebSearch={setUseWebSearch}
            systemInstruction={systemInstruction}
            setSystemInstruction={setSystemInstruction}
          />
          <main className="flex-1 overflow-hidden" key={sessionKey}>
            {children({ 
              model, 
              temperature, 
              jsonMode,
              useWebSearch,
              systemInstruction,
              sessionId,
              onSessionCreated: handleSessionCreated,
              onNewSession: handleNewSession 
            })}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
