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
    const { 
      messages, 
      model = "gemini-2.5-flash", 
      temperature = 0.7, 
      jsonMode = false, 
      useWebSearch = false, 
      systemInstruction,
      urlContext,
      thinkingBudget = 2000,
      safetySettings = {
        harassment: "BLOCK_MEDIUM_AND_ABOVE",
        hateSpeech: "BLOCK_MEDIUM_AND_ABOVE",
        sexuallyExplicit: "BLOCK_MEDIUM_AND_ABOVE",
        dangerousContent: "BLOCK_MEDIUM_AND_ABOVE"
      }
    } = await req.json();
    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');

    if (!GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY is not configured');
    }

    console.log(`Starting chat with model: ${model}, temperature: ${temperature}, jsonMode: ${jsonMode}, useWebSearch: ${useWebSearch}, thinkingBudget: ${thinkingBudget}`);

    // Fetch and parse URL context if provided
    let urlContextText = '';
    if (urlContext && urlContext.trim()) {
      const urls = urlContext.split('\n').map((u: string) => u.trim()).filter((u: string) => u);
      console.log(`Fetching ${urls.length} URLs for context...`);
      
      for (const url of urls) {
        try {
          const response = await fetch(url);
          const html = await response.text();
          // Basic HTML parsing - extract text content
          const textContent = html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          
          urlContextText += `\n\n[Source: ${url}]\n${textContent.slice(0, 5000)}\n`;
        } catch (error) {
          console.error(`Failed to fetch ${url}:`, error);
          urlContextText += `\n\n[Source: ${url}]\n(Failed to fetch)\n`;
        }
      }
    }

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

    // Note: thinkingTokens is not yet supported in Gemini API
    // Keeping thinkingBudget for future use
    
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

    // Map safety setting strings to thresholds
    const thresholdMap: Record<string, any> = {
      'BLOCK_NONE': HarmBlockThreshold.BLOCK_NONE,
      'BLOCK_ONLY_HIGH': HarmBlockThreshold.BLOCK_ONLY_HIGH,
      'BLOCK_MEDIUM_AND_ABOVE': HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
      'BLOCK_LOW_AND_ABOVE': HarmBlockThreshold.BLOCK_LOW_AND_ABOVE,
    };

    const geminiModel = genAI.getGenerativeModel({ 
      model: apiModel,
      generationConfig,
      systemInstruction: systemInstruction || undefined,
      tools: tools.length > 0 ? tools : undefined,
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: thresholdMap[safetySettings.harassment] || HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE
        },
        {
          category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
          threshold: thresholdMap[safetySettings.hateSpeech] || HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE
        },
        {
          category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
          threshold: thresholdMap[safetySettings.sexuallyExplicit] || HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE
        },
        {
          category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
          threshold: thresholdMap[safetySettings.dangerousContent] || HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE
        }
      ]
    });

    // Transform messages to Gemini format
    const contents = messages.map((msg: any, index: number) => {
      const parts = [];
      
      // Add URL context to first user message if available
      if (index === 0 && msg.role === 'user' && urlContextText) {
        parts.push({ text: `[URL Context Information]${urlContextText}\n\n[User Message]\n${msg.content}` });
      } else if (msg.content) {
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
    // Ensure history starts with user message (Gemini requirement)
    const history = contents.slice(0, -1);
    const validHistory = history.length > 0 && history[0].role === 'user' 
      ? history 
      : [];
    
    const chat = geminiModel.startChat({
      history: validHistory,
      generationConfig,
    });

    const lastMessage = contents[contents.length - 1];
    const result = await chat.sendMessageStream(lastMessage.parts);

    // Stream the response back to the client
    const stream = new ReadableStream({
      async start(controller) {
        try {
          let isThinking = false;
          for await (const chunk of result.stream) {
            const text = chunk.text();
            
            // Check if model is in thinking mode (basic heuristic)
            // Real implementation would need model-specific thinking detection
            if (text && text.includes('...')) {
              if (!isThinking) {
                isThinking = true;
                const thinkingEvent = `data: ${JSON.stringify({ thinking: true })}\n\n`;
                controller.enqueue(new TextEncoder().encode(thinkingEvent));
              }
            }
            
            if (text) {
              const sseData = `data: ${JSON.stringify({ text })}\n\n`;
              controller.enqueue(new TextEncoder().encode(sseData));
            }
          }
          
          // Signal end of thinking if it was active
          if (isThinking) {
            const thinkingEndEvent = `data: ${JSON.stringify({ thinking: false })}\n\n`;
            controller.enqueue(new TextEncoder().encode(thinkingEndEvent));
          }
          
          // Get usage metadata after stream completes
          const response = await result.response;
          const usageMetadata = response.usageMetadata;
          
          if (usageMetadata) {
            const metadataEvent = `data: ${JSON.stringify({ 
              metadata: {
                promptTokens: usageMetadata.promptTokenCount,
                completionTokens: usageMetadata.candidatesTokenCount,
                totalTokens: usageMetadata.totalTokenCount
              }
            })}\n\n`;
            controller.enqueue(new TextEncoder().encode(metadataEvent));
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
