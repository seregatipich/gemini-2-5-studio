import { ReactNode, useState } from "react";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { TopBar } from "@/components/TopBar";

interface LayoutProps {
  children: (props: {
    model: string;
    temperature: number;
    jsonMode: boolean;
    onNewSession: () => void;
  }) => ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const [model, setModel] = useState("gemini-2.5-flash");
  const [temperature, setTemperature] = useState(0.7);
  const [jsonMode, setJsonMode] = useState(false);
  const [sessionKey, setSessionKey] = useState(0);

  const handleNewSession = () => {
    setSessionKey(prev => prev + 1);
  };

  return (
    <SidebarProvider defaultOpen={true}>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar onNewSession={handleNewSession} />
        <div className="flex-1 flex flex-col">
          <TopBar
            model={model}
            setModel={setModel}
            temperature={temperature}
            setTemperature={setTemperature}
            jsonMode={jsonMode}
            setJsonMode={setJsonMode}
          />
          <main className="flex-1 overflow-hidden" key={sessionKey}>
            {children({ model, temperature, jsonMode, onNewSession: handleNewSession })}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
