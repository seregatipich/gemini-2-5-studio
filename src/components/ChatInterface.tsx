import { useState, useRef, useEffect } from "react";
import { Send, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { streamGeminiChat, Message } from "@/lib/gemini";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { MessageContent } from "@/components/MessageContent";

interface ChatInterfaceProps {
  model?: string;
  temperature?: number;
  jsonMode?: boolean;
  sessionId?: string | null;
  onSessionCreated?: (sessionId: string) => void;
}

export function ChatInterface({ 
  model = "gemini-2.5-flash", 
  temperature = 0.7, 
  jsonMode = false, 
  sessionId: initialSessionId,
  onSessionCreated,
  onNewSession 
}: ChatInterfaceProps & { onNewSession?: () => void }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentAssistantMessage, setCurrentAssistantMessage] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId || null);
  const [isLoadingSession, setIsLoadingSession] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load session messages on mount
  useEffect(() => {
    if (initialSessionId) {
      loadSession(initialSessionId);
    }
  }, [initialSessionId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, currentAssistantMessage]);

  const loadSession = async (id: string) => {
    setIsLoadingSession(true);
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('session_id', id)
        .order('created_at', { ascending: true });

      if (error) throw error;
      
      if (data) {
        setMessages(data.map(msg => ({
          role: msg.role as 'user' | 'assistant',
          content: msg.content
        })));
      }
    } catch (error) {
      console.error('Error loading session:', error);
      toast.error('Failed to load session');
    } finally {
      setIsLoadingSession(false);
    }
  };

  const createSession = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error('Please sign in to save sessions');
        return null;
      }

      const { data, error } = await supabase
        .from('sessions')
        .insert({
          user_id: user.id,
          model,
          temperature,
          json_mode: jsonMode,
        })
        .select()
        .single();

      if (error) throw error;
      return data.id;
    } catch (error) {
      console.error('Error creating session:', error);
      toast.error('Failed to create session');
      return null;
    }
  };

  const saveMessage = async (sessionId: string, role: 'user' | 'assistant', content: string) => {
    try {
      const { error } = await supabase
        .from('messages')
        .insert({
          session_id: sessionId,
          role,
          content,
        });

      if (error) throw error;
    } catch (error) {
      console.error('Error saving message:', error);
    }
  };

  const generateChatName = async (userMessage: string, assistantResponse: string, sessionId: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('name-chat', {
        body: { userMessage, assistantResponse }
      });

      if (error) throw error;

      if (data?.chatName) {
        await supabase
          .from('sessions')
          .update({ name: data.chatName })
          .eq('id', sessionId);
      }
    } catch (error) {
      console.error('Error generating chat name:', error);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || isStreaming) return;

    // Create session if this is the first message
    let currentSessionId = sessionId;
    if (!currentSessionId) {
      currentSessionId = await createSession();
      if (!currentSessionId) return;
      setSessionId(currentSessionId);
      onSessionCreated?.(currentSessionId);
    }

    const userMessage: Message = { role: "user", content: input };
    const userContent = input;
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsStreaming(true);
    setCurrentAssistantMessage("");

    // Save user message
    await saveMessage(currentSessionId, "user", userContent);

    abortControllerRef.current = new AbortController();

    let assistantResponse = "";
    const isFirstMessage = messages.length === 0;

    await streamGeminiChat({
      messages: [...messages, userMessage],
      model,
      temperature,
      jsonMode,
      signal: abortControllerRef.current.signal,
      onToken: (token) => {
        assistantResponse += token;
        setCurrentAssistantMessage(assistantResponse);
      },
      onComplete: async () => {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: assistantResponse },
        ]);
        setCurrentAssistantMessage("");
        setIsStreaming(false);
        abortControllerRef.current = null;

        // Save assistant message
        if (currentSessionId) {
          await saveMessage(currentSessionId, "assistant", assistantResponse);
          
          // Generate chat name if this is the first exchange
          if (isFirstMessage) {
            await generateChatName(userContent, assistantResponse, currentSessionId);
          }
        }
      },
      onError: (error) => {
        console.error("Stream error:", error);
        toast.error("Failed to get response from Gemini");
        setIsStreaming(false);
        setCurrentAssistantMessage("");
        abortControllerRef.current = null;
      },
    });
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  };

  const handleNewSession = () => {
    setMessages([]);
    setCurrentAssistantMessage("");
    setInput("");
    setSessionId(null);
    onNewSession?.();
  };

  return (
    <div className="flex flex-col h-full">
      <ScrollArea className="flex-1 p-6" ref={scrollRef}>
        <div className="max-w-4xl mx-auto space-y-6">
          {messages.length === 0 && !currentAssistantMessage && (
            <div className="flex items-center justify-center h-full py-20">
              <div className="text-center space-y-4 animate-fade-in">
                <div className="w-16 h-16 rounded-2xl bg-gradient-primary mx-auto flex items-center justify-center shadow-glow">
                  <svg
                    className="w-8 h-8 text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13 10V3L4 14h7v7l9-11h-7z"
                    />
                  </svg>
                </div>
                <h2 className="text-2xl font-semibold">Welcome to Gemini 2.5 Studio</h2>
                <p className="text-muted-foreground max-w-md">
                  Start a conversation with Google's most advanced AI models. Ask anything, explore ideas, or build something amazing.
                </p>
              </div>
            </div>
          )}

          {messages.map((message, index) => (
            <Card
              key={index}
              className={cn(
                "p-4 animate-fade-in",
                message.role === "user"
                  ? "bg-primary/5 border-primary/20 ml-12"
                  : "bg-card mr-12"
              )}
            >
              <div className="flex gap-3">
                <div
                  className={cn(
                    "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                    message.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-gradient-accent text-white"
                  )}
                >
                  {message.role === "user" ? "U" : "AI"}
                </div>
                <div className="flex-1">
                  <MessageContent content={message.content} />
                </div>
              </div>
            </Card>
          ))}

          {currentAssistantMessage && (
            <Card className="p-4 animate-fade-in mr-12">
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-lg bg-gradient-accent flex items-center justify-center text-white">
                  AI
                </div>
                <div className="flex-1">
                  <MessageContent content={currentAssistantMessage} />
                </div>
              </div>
            </Card>
          )}

          {isStreaming && !currentAssistantMessage && (
            <Card className="p-4 animate-fade-in mr-12">
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-lg bg-gradient-accent flex items-center justify-center animate-pulse-glow">
                  <span className="text-white text-sm">AI</span>
                </div>
                <div className="flex-1">
                  <div className="flex gap-1">
                    <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                    <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                    <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                </div>
              </div>
            </Card>
          )}
        </div>
      </ScrollArea>

      <div className="border-t border-border p-4 bg-card">
        <div className="max-w-4xl mx-auto flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Ask anything..."
            className="min-h-[60px] max-h-[200px] resize-none"
            disabled={isStreaming}
          />
          {isStreaming ? (
            <Button
              onClick={handleStop}
              size="icon"
              variant="destructive"
              className="h-[60px] w-[60px] shrink-0"
            >
              <Square className="h-5 w-5" />
            </Button>
          ) : (
            <Button
              onClick={handleSend}
              size="icon"
              className="h-[60px] w-[60px] shrink-0 bg-gradient-primary hover:opacity-90"
              disabled={!input.trim()}
            >
              <Send className="h-5 w-5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
