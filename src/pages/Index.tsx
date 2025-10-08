import { Layout } from "@/components/Layout";
import { ChatInterface } from "@/components/ChatInterface";
import { AuthWrapper } from "@/components/AuthWrapper";

const Index = () => {
  return (
    <AuthWrapper>
      <Layout>
        {({ model, temperature, jsonMode, useWebSearch, systemInstruction, sessionId, onSessionCreated, onNewSession }) => (
          <ChatInterface 
            model={model} 
            temperature={temperature} 
            jsonMode={jsonMode}
            useWebSearch={useWebSearch}
            systemInstruction={systemInstruction}
            sessionId={sessionId}
            onSessionCreated={onSessionCreated}
            onNewSession={onNewSession}
          />
        )}
      </Layout>
    </AuthWrapper>
  );
};

export default Index;
