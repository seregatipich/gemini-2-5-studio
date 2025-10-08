export type SafetyLevel = "BLOCK_NONE" | "BLOCK_ONLY_HIGH" | "BLOCK_MEDIUM_AND_ABOVE" | "BLOCK_LOW_AND_ABOVE";

export interface Message {
  role: "user" | "assistant";
  content: string;
  attachments?: string[];
}

export interface TokenMetadata {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface SafetySettings {
  harassment: SafetyLevel;
  hateSpeech: SafetyLevel;
  sexuallyExplicit: SafetyLevel;
  dangerousContent: SafetyLevel;
}

export interface GeminiStreamOptions {
  messages: Message[];
  model?: string;
  temperature?: number;
  jsonMode?: boolean;
  useWebSearch?: boolean;
  systemInstruction?: string;
  urlContext?: string;
  safetySettings?: SafetySettings;
  thinkingBudget?: number;
  onToken: (token: string) => void;
  onComplete: () => void;
  onError: (error: Error) => void;
  onMetadata?: (metadata: TokenMetadata) => void;
  onThinking?: (isThinking: boolean) => void;
  onThoughtSummary?: (summary: string) => void;
  signal?: AbortSignal;
}

export async function streamGeminiChat(options: GeminiStreamOptions) {
  const {
    messages,
    model = "gemini-2.5-flash",
    temperature = 0.7,
    jsonMode = false,
    useWebSearch = false,
    systemInstruction,
    urlContext,
    safetySettings,
    thinkingBudget,
    onToken,
    onComplete,
    onError,
    onMetadata,
    onThinking,
    onThoughtSummary,
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
        body: JSON.stringify({
          messages,
          model,
          temperature,
          jsonMode,
          useWebSearch,
          thinkingBudget,
          systemInstruction,
          urlContext,
          safetySettings,
        }),
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
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) {
          continue;
        }

        const jsonStr = line.slice(6);
        if (!jsonStr) {
          continue;
        }

        try {
          const data = JSON.parse(jsonStr);
          if (data.text) {
            onToken(data.text);
          }
          if (data.metadata && onMetadata) {
            onMetadata(data.metadata);
          }
          if (typeof data.thinking === "boolean" && onThinking) {
            onThinking(data.thinking);
          }
          if (data.thoughtSummary && onThoughtSummary) {
            onThoughtSummary(data.thoughtSummary);
          }
        } catch (e) {
          console.error("Error parsing SSE data:", e);
        }
      }
    }
  } catch (error) {
    if (error instanceof Error) {
      onError(error);
      return;
    }

    onError(new Error("Unknown error occurred"));
  }
}
