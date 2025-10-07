import { Layout } from "@/components/Layout";
import { ChatInterface } from "@/components/ChatInterface";

const Index = () => {
  return (
    <Layout>
      {({ model, temperature, jsonMode, sessionId, onSessionCreated, onNewSession }) => (
        <ChatInterface 
          model={model} 
          temperature={temperature} 
          jsonMode={jsonMode}
          sessionId={sessionId}
          onSessionCreated={onSessionCreated}
          onNewSession={onNewSession}
        />
      )}
    </Layout>
  );
};

export default Index;
