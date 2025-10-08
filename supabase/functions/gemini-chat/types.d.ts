declare module "https://deno.land/std@0.168.0/http/server.ts" {
  export type ServeHandler = (request: Request) => Response | Promise<Response>;
  export function serve(handler: ServeHandler, options?: Record<string, unknown>): void;
}

declare module "https://esm.sh/@google/generative-ai@0.24.1?target=deno" {
  export class GoogleGenerativeAI {
    constructor(apiKey: string);
    getGenerativeModel(options: Record<string, unknown>): {
      startChat(config: Record<string, unknown>): {
        sendMessageStream(parts: unknown[]): AsyncIterable<{ text(): string } & { response: Promise<{ usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number } }> }>;
      };
    };
  }

  export enum HarmCategory {
    HARM_CATEGORY_HARASSMENT,
    HARM_CATEGORY_HATE_SPEECH,
    HARM_CATEGORY_SEXUALLY_EXPLICIT,
    HARM_CATEGORY_DANGEROUS_CONTENT,
  }

  export enum HarmBlockThreshold {
    BLOCK_NONE,
    BLOCK_ONLY_HIGH,
    BLOCK_MEDIUM_AND_ABOVE,
    BLOCK_LOW_AND_ABOVE,
  }
}

declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
};
