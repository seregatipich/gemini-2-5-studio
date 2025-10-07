import { Layout } from "@/components/Layout";
import { ChatInterface } from "@/components/ChatInterface";
import { AuthWrapper } from "@/components/AuthWrapper";

const Index = () => {
  return (
    <AuthWrapper>
      <Layout>
        {({ model, temperature, jsonMode, useWebSearch, sessionId, onSessionCreated, onNewSession }) => (
          <ChatInterface 
            model={model} 
            temperature={temperature} 
            jsonMode={jsonMode}
            useWebSearch={useWebSearch}
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
