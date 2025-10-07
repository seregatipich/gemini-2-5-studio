export interface Message {
  role: "user" | "assistant";
  content: string;
}

export interface GeminiStreamOptions {
  messages: Message[];
  model?: string;
  temperature?: number;
  jsonMode?: boolean;
  useWebSearch?: boolean;
  onToken: (token: string) => void;
  onComplete: () => void;
  onError: (error: Error) => void;
  signal?: AbortSignal;
}

export async function streamGeminiChat(options: GeminiStreamOptions) {
  const {
    messages,
    model = "gemini-2.5-flash",
    temperature = 0.7,
    jsonMode = false,
    useWebSearch = false,
    onToken,
    onComplete,
    onError,
    signal,
  } = options;

  try {
    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/gemini-chat`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ messages, model, temperature, jsonMode, useWebSearch }),
        signal,
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("No response body");
    }

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        onComplete();
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const jsonStr = line.slice(6);
          try {
            const data = JSON.parse(jsonStr);
            if (data.text) {
              onToken(data.text);
            }
          } catch (e) {
            console.error("Error parsing SSE data:", e);
          }
        }
      }
    }
  } catch (error) {
    if (error instanceof Error) {
      onError(error);
    } else {
      onError(new Error("Unknown error occurred"));
    }
  }
}
