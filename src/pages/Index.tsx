import { Layout } from "@/components/Layout";
import { ChatInterface } from "@/components/ChatInterface";

const Index = () => {
  return (
    <Layout>
      {({ model, temperature, jsonMode, onNewSession }) => (
        <ChatInterface 
          model={model} 
          temperature={temperature} 
          jsonMode={jsonMode}
          onNewSession={onNewSession}
        />
      )}
    </Layout>
  );
};

export default Index;
