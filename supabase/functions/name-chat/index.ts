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
    const { userMessage, assistantResponse } = await req.json();
    
    if (!userMessage || !assistantResponse) {
      return new Response(
        JSON.stringify({ error: 'Missing userMessage or assistantResponse' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
    if (!GEMINI_API_KEY) {
      console.error('GEMINI_API_KEY not configured');
      return new Response(
        JSON.stringify({ error: 'API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const prompt = `Chat Naming Instruction

Task:
You are an assistant that assigns concise, descriptive names to chat sessions.

Input fields:
- User Message: ${userMessage}
- LLM Response: ${assistantResponse}

Instructions:
1. Read the user's first message and the LLM's first response.
2. Identify the main topic, goal, or activity discussed.
3. Generate a short name (2–5 words) that:
   - Clearly summarizes the chat's subject or intent.
   - Is suitable as a chat title in a chat list.
   - Avoids generic words like "Chat," "Conversation," or "Discussion."
   - Uses Title Case (e.g., "Trip Budget Planner," "Python Bug Fix," "Healthy Meal Ideas").

Output format:
Chat Name: <short descriptive title>`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 50,
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Gemini API error:', response.status, errorText);
      return new Response(
        JSON.stringify({ error: 'Failed to generate chat name' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
    let chatName = data.candidates?.[0]?.content?.parts?.[0]?.text || 'New Chat';
    
    // Extract the name from "Chat Name: <title>" format
    const match = chatName.match(/Chat Name:\s*(.+)/i);
    if (match) {
      chatName = match[1].trim();
    }
    
    // Remove any quotes
    chatName = chatName.replace(/['"]/g, '').trim();

    return new Response(
      JSON.stringify({ chatName }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in name-chat function:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});