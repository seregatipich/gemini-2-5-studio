import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "https://esm.sh/@google/generative-ai@0.21.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages, model = "gemini-2.5-flash", temperature = 0.7, jsonMode = false, useWebSearch = false } = await req.json();
    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');

    if (!GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY is not configured');
    }

    console.log(`Starting chat with model: ${model}, temperature: ${temperature}, jsonMode: ${jsonMode}, useWebSearch: ${useWebSearch}`);

    // Map model names to Gemini API model identifiers
    const modelMap: Record<string, string> = {
      'gemini-2.5-pro': 'gemini-2.0-flash-exp',
      'gemini-2.5-flash': 'gemini-2.0-flash-exp',
      'gemini-2.5-flash-lite': 'gemini-2.0-flash-exp',
    };

    const apiModel = modelMap[model] || 'gemini-2.0-flash-exp';

    // Initialize Gemini AI
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    
    // Build generation config
    const generationConfig: any = {
      temperature,
      maxOutputTokens: 8192,
    };

    if (jsonMode) {
      generationConfig.responseMimeType = "application/json";
    }

    // Build tools config
    const tools: any[] = [];
    if (useWebSearch) {
      tools.push({
        googleSearch: {}
      });
    }

    const geminiModel = genAI.getGenerativeModel({ 
      model: apiModel,
      generationConfig,
      tools: tools.length > 0 ? tools : undefined,
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.BLOCK_NONE
        },
        {
          category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
          threshold: HarmBlockThreshold.BLOCK_NONE
        },
        {
          category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
          threshold: HarmBlockThreshold.BLOCK_NONE
        },
        {
          category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
          threshold: HarmBlockThreshold.BLOCK_NONE
        }
      ]
    });

    // Transform messages to Gemini format
    const contents = messages.map((msg: any) => {
      const parts = [];
      
      // Add text content
      if (msg.content) {
        parts.push({ text: msg.content });
      }

      // Add attachments if present (base64 data URLs)
      if (msg.attachments && msg.attachments.length > 0) {
        for (const dataUrl of msg.attachments) {
          try {
            const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
            if (matches && matches[1].startsWith('image/')) {
              const mimeType = matches[1];
              const base64Data = matches[2];
              
              parts.push({
                inlineData: {
                  mimeType,
                  data: base64Data
                }
              });
            }
          } catch (error) {
            console.error('Error processing attachment:', error);
          }
        }
      }

      return {
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts
      };
    });

    // Start streaming chat
    const chat = geminiModel.startChat({
      history: contents.slice(0, -1),
      generationConfig,
    });

    const lastMessage = contents[contents.length - 1];
    const result = await chat.sendMessageStream(lastMessage.parts);

    // Stream the response back to the client
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of result.stream) {
            const text = chunk.text();
            if (text) {
              const sseData = `data: ${JSON.stringify({ text })}\n\n`;
              controller.enqueue(new TextEncoder().encode(sseData));
            }
          }
          controller.close();
        } catch (error) {
          console.error('Stream error:', error);
          controller.error(error);
        }
      },
    });

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (error) {
    console.error('Error in gemini-chat function:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), 
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
