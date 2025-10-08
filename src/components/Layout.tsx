import { ReactNode, useState, useEffect } from "react";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { TopBar } from "@/components/TopBar";

type ThinkingBudgetRange = {
  min: number;
  max: number;
};

const DEFAULT_MODEL = "gemini-2.5-flash";
const DEFAULT_THINKING_BUDGET_RANGE: ThinkingBudgetRange = { min: 0, max: 10000 };
const GOOGLE_THINKING_BUDGET_RANGE: ThinkingBudgetRange = { min: 128, max: 32768 };

const getThinkingBudgetRange = (model: string): ThinkingBudgetRange =>
  model.toLowerCase().includes("gemini")
    ? GOOGLE_THINKING_BUDGET_RANGE
    : DEFAULT_THINKING_BUDGET_RANGE;

interface LayoutProps {
  children: (props: {
    model: string;
    temperature: number;
    jsonMode: boolean;
    useWebSearch: boolean;
    systemInstruction: string;
    urlContext: string;
    thinkingBudget: number;
    safetySettings: {
      harassment: string;
      hateSpeech: string;
      sexuallyExplicit: string;
      dangerousContent: string;
    };
    sessionId: string | null;
    onSessionCreated: (sessionId: string) => void;
    onNewSession: () => void;
  }) => ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [temperature, setTemperature] = useState(1);
  const [jsonMode, setJsonMode] = useState(false);
  const [useWebSearch, setUseWebSearch] = useState(false);
  const [systemInstruction, setSystemInstruction] = useState("");
  const [urlContext, setUrlContext] = useState("");
  const [thinkingBudgetEnabled, setThinkingBudgetEnabled] = useState(false);
  const [thinkingBudget, setThinkingBudget] = useState(
    () => getThinkingBudgetRange(DEFAULT_MODEL).max
  );
  const [safetySettings, setSafetySettings] = useState({
    harassment: "BLOCK_NONE",
    hateSpeech: "BLOCK_NONE",
    sexuallyExplicit: "BLOCK_NONE",
    dangerousContent: "BLOCK_NONE"
  });
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionKey, setSessionKey] = useState(0);

  const currentThinkingBudgetRange = getThinkingBudgetRange(model);

  // Set dark theme by default
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  useEffect(() => {
    const { min, max } = getThinkingBudgetRange(model);
    setThinkingBudget((previous) => {
      if (!thinkingBudgetEnabled) {
        return max;
      }
      if (previous < min) {
        return min;
      }
      if (previous > max) {
        return max;
      }
      return previous;
    });
  }, [model, thinkingBudgetEnabled]);

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

  const effectiveThinkingBudget = thinkingBudgetEnabled
    ? thinkingBudget
    : currentThinkingBudgetRange.max;

  return (
    <SidebarProvider defaultOpen={true}>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar 
          onNewSession={handleNewSession}
          activeSessionId={sessionId}
          onSessionSelect={handleSessionSelect}
        />
        <div className="flex-1 flex flex-col min-h-0">
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
          urlContext={urlContext}
          setUrlContext={setUrlContext}
          thinkingBudget={thinkingBudget}
          setThinkingBudget={setThinkingBudget}
          thinkingBudgetEnabled={thinkingBudgetEnabled}
          setThinkingBudgetEnabled={setThinkingBudgetEnabled}
          thinkingBudgetRange={currentThinkingBudgetRange}
          safetySettings={safetySettings}
          setSafetySettings={setSafetySettings}
        />
          <main className="flex-1 min-h-0" key={sessionKey}>
        {children({ 
          model, 
          temperature, 
          jsonMode,
          useWebSearch,
          systemInstruction,
          urlContext,
          thinkingBudget: effectiveThinkingBudget,
          safetySettings,
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
