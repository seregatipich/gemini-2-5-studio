import { Layout } from "@/components/Layout";
import { ChatInterface } from "@/components/ChatInterface";

const Index = () => {
  return (
    <Layout>
      {({ model, temperature, jsonMode }) => (
        <ChatInterface model={model} temperature={temperature} jsonMode={jsonMode} />
      )}
    </Layout>
  );
};

export default Index;
