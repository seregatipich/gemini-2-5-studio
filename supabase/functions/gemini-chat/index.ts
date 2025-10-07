import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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
      'gemini-2.5-pro': 'gemini-2.5-pro',
      'gemini-2.5-flash': 'gemini-2.5-flash',
      'gemini-2.5-flash-lite': 'gemini-2.5-flash-lite',
    };

    const apiModel = modelMap[model] || 'gemini-2.5-flash';

    // Transform messages to Gemini format with attachment support
    const contents = await Promise.all(messages.map(async (msg: any) => {
      const parts = [];
      
      // Add text content
      if (msg.content) {
        parts.push({ text: msg.content });
      }

      // Add attachments if present
      if (msg.attachments && msg.attachments.length > 0) {
        for (const url of msg.attachments) {
          // Check if it's an image
          if (url.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
            try {
              // Fetch the image and convert to base64
              const imageResponse = await fetch(url);
              const imageBuffer = await imageResponse.arrayBuffer();
              const base64 = btoa(String.fromCharCode(...new Uint8Array(imageBuffer)));
              const mimeType = imageResponse.headers.get('content-type') || 'image/jpeg';
              
              parts.push({
                inlineData: {
                  mimeType,
                  data: base64
                }
              });
            } catch (error) {
              console.error('Error fetching image:', error);
            }
          }
        }
      }

      return {
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts
      };
    }));

    // Build request body
    const requestBody: any = {
      contents,
      generationConfig: {
        temperature,
        maxOutputTokens: 8192,
      },
      safetySettings: [
        {
          category: "HARM_CATEGORY_HARASSMENT",
          threshold: "BLOCK_NONE"
        },
        {
          category: "HARM_CATEGORY_HATE_SPEECH",
          threshold: "BLOCK_NONE"
        },
        {
          category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
          threshold: "BLOCK_NONE"
        },
        {
          category: "HARM_CATEGORY_DANGEROUS_CONTENT",
          threshold: "BLOCK_NONE"
        }
      ]
    };

    // Add JSON response schema if jsonMode is enabled
    if (jsonMode) {
      requestBody.generationConfig.responseMimeType = "application/json";
    }

    // Add Google Search grounding if web search is enabled
    if (useWebSearch) {
      requestBody.tools = [
        {
          googleSearch: {}
        }
      ];
    }

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${apiModel}:streamGenerateContent?key=${GEMINI_API_KEY}&alt=sse`;

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Gemini API error:', response.status, errorText);
      return new Response(
        JSON.stringify({ error: `Gemini API error: ${response.status}` }), 
        {
          status: response.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Stream the response back to the client
    const stream = new ReadableStream({
      async start(controller) {
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();

        if (!reader) {
          controller.close();
          return;
        }

        try {
          while (true) {
            const { done, value } = await reader.read();
            
            if (done) {
              controller.close();
              break;
            }

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const jsonStr = line.slice(6);
                if (jsonStr.trim() === '[DONE]') continue;
                
                try {
                  const data = JSON.parse(jsonStr);
                  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
                  
                  if (text) {
                    // Send SSE formatted response
                    const sseData = `data: ${JSON.stringify({ text })}\n\n`;
                    controller.enqueue(new TextEncoder().encode(sseData));
                  }
                } catch (e) {
                  console.error('Error parsing chunk:', e);
                }
              }
            }
          }
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
