import { useState, useRef, useEffect, useLayoutEffect, lazy, Suspense, useCallback } from "react";
import { Send, Square, Paperclip, X, FileText, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { streamGeminiChat, Message, type SafetySettings } from "@/lib/gemini";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { commandParser } from "@/lib/commands";

const MessageContent = lazy(() =>
  import("@/components/MessageContent").then((module) => ({
    default: module.MessageContent,
  }))
);

const MessageContentFallback = () => (
  <div className="space-y-3">
    <div className="h-3 w-32 rounded bg-muted animate-pulse" />
    <div className="h-3 w-48 rounded bg-muted/70 animate-pulse" />
    <div className="h-3 w-40 rounded bg-muted/60 animate-pulse" />
  </div>
);

interface ChatInterfaceProps {
  model?: string;
  temperature?: number;
  jsonMode?: boolean;
  useWebSearch?: boolean;
  systemInstruction?: string;
  urlContext?: string;
  thinkingBudget?: number;
  safetySettings?: SafetySettings;
  sessionId?: string | null;
  onSessionCreated?: (sessionId: string) => void;
}

export function ChatInterface({ 
  model = "gemini-2.5-flash", 
  temperature = 0.7, 
  jsonMode = false,
  useWebSearch = false,
  systemInstruction,
  urlContext,
  thinkingBudget = 2000,
  safetySettings,
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
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [tokenMetadata, setTokenMetadata] = useState<{ promptTokens: number; completionTokens: number; totalTokens: number } | null>(null);
  const [isThinking, setIsThinking] = useState(false);
  const [thoughtSummaries, setThoughtSummaries] = useState<string[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputContainerRef = useRef<HTMLDivElement | null>(null);
  const [inputHeight, setInputHeight] = useState(0);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const viewport = viewportRef.current;
    if (viewport) {
      if (behavior === "smooth") {
        viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
      } else {
        viewport.scrollTop = viewport.scrollHeight;
      }
    }
  }, []);

  // Load session messages on mount
  useEffect(() => {
    if (initialSessionId) {
      loadSession(initialSessionId);
    }
  }, [initialSessionId]);

  // Scroll to bottom when viewport is ready
  useEffect(() => {
    // Check if viewport is ready and scroll
    const checkAndScroll = () => {
      if (viewportRef.current) {
        scrollToBottom();
      }
    };
    
    // Try immediately
    checkAndScroll();
    
    // Also try after a short delay for initial mount
    const timer = setTimeout(checkAndScroll, 150);
    
    return () => clearTimeout(timer);
  }, [scrollToBottom, messages.length]);

  // Track sticky input height and create bottom padding so content isn't hidden
  useEffect(() => {
    const el = inputContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setInputHeight(el.offsetHeight || 0);
    });
    ro.observe(el);
    // initialize
    setInputHeight(el.offsetHeight || 0);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    // Scroll on new messages or while streaming
    if (messages.length > 0 || currentAssistantMessage) {
      scrollToBottom(isStreaming && currentAssistantMessage ? "auto" : "smooth");
    }
  }, [messages.length, currentAssistantMessage, isStreaming, scrollToBottom]);

  useEffect(() => {
    if (isStreaming) {
      // Initial scroll when streaming starts
      scrollToBottom("smooth");
      
      // Continuous scroll during streaming to handle fast token generation
      const scrollInterval = setInterval(() => {
        scrollToBottom("auto");
      }, 100);
      
      return () => clearInterval(scrollInterval);
    }
  }, [isStreaming, scrollToBottom]);

  // If the input grows/shrinks (attachments, multi-line), keep the bottom visible while streaming
  useEffect(() => {
    if (isStreaming) {
      requestAnimationFrame(() => scrollToBottom("auto"));
    }
  }, [inputHeight, isStreaming, scrollToBottom]);

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
        const messagesWithAttachments = await Promise.all(
          data.map(async (msg) => {
            const { data: attachments } = await supabase
              .from('message_attachments')
              .select('file_path, mime_type')
              .eq('message_id', msg.id);
            
            const attachmentUrls: string[] = [];
            if (attachments && attachments.length > 0) {
              for (const att of attachments) {
                try {
                  // Download file from storage
                  const { data: fileData, error: downloadError } = await supabase.storage
                    .from('chat-attachments')
                    .download(att.file_path);
                  
                  if (downloadError) {
                    console.error('Error downloading file:', downloadError);
                    continue;
                  }
                  
                  // Convert blob to base64 data URL
                  const base64Promise = new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result as string);
                    reader.onerror = reject;
                    reader.readAsDataURL(fileData);
                  });
                  const base64Data = await base64Promise;
                  attachmentUrls.push(base64Data);
                } catch (error) {
                  console.error('Error processing attachment:', error);
                }
              }
            }
            
            return {
              role: msg.role as 'user' | 'assistant',
              content: msg.content,
              attachments: attachmentUrls.length > 0 ? attachmentUrls : undefined
            };
          })
        );
        setMessages(messagesWithAttachments);
        // Scroll to bottom after loading messages
        setTimeout(() => scrollToBottom("auto"), 150);
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
    if ((!input.trim() && attachedFiles.length === 0) || isStreaming) return;

    // Parse commands from input
    const { cleanedPrompt, options } = commandParser.parse(input);
    const useWebSearch = options.useWebSearch || false;

    // Create session if this is the first message
    let currentSessionId = sessionId;
    if (!currentSessionId) {
      currentSessionId = await createSession();
      if (!currentSessionId) return;
      setSessionId(currentSessionId);
      onSessionCreated?.(currentSessionId);
    }

    // Convert files to base64 and upload to storage
    const attachmentUrls: string[] = [];
    const filePaths: string[] = [];
    const fileNames: string[] = [];
    if (attachedFiles.length > 0) {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("User not authenticated");

        for (const file of attachedFiles) {
          // Convert to base64 for sending to LLM
          const reader = new FileReader();
          const base64Promise = new Promise<string>((resolve) => {
            reader.onloadend = () => {
              const base64 = reader.result as string;
              resolve(base64);
            };
            reader.readAsDataURL(file);
          });
          const base64Data = await base64Promise;
          attachmentUrls.push(base64Data);

          // Generate safe filename (ASCII only) for storage
          const timestamp = Date.now();
          const fileExt = file.name.split('.').pop() || '';
          const safePath = `${user.id}/${timestamp}.${fileExt}`;
          
          filePaths.push(safePath);
          fileNames.push(file.name); // Store original name
          
          const { error: uploadError } = await supabase.storage
            .from('chat-attachments')
            .upload(safePath, file);

          if (uploadError) throw uploadError;
        }
      } catch (error) {
        console.error("File upload error:", error);
        toast.error("Failed to upload files");
        return;
      }
    }

    const userMessage: Message = { 
      role: "user", 
      content: cleanedPrompt || "Analyze the attached files",
      attachments: attachmentUrls 
    };
    const userContent = cleanedPrompt || "Analyze the attached files";
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setAttachedFiles([]);
    setIsStreaming(true);
    setCurrentAssistantMessage("");

    // Ensure scroll happens after state update and DOM render
    setTimeout(() => {
      scrollToBottom("smooth");
    }, 50);

    // Save user message with ID returned
    const { data: savedMessage, error: saveError } = await supabase
      .from("messages")
      .insert({
        session_id: currentSessionId,
        role: "user",
        content: userContent,
      })
      .select()
      .single();

    if (saveError) {
      console.error("Error saving message:", saveError);
    }

    // Save attachments metadata with file paths
    if (filePaths.length > 0 && savedMessage) {
      const attachmentsData = filePaths.map((filePath, index) => ({
        message_id: savedMessage.id,
        file_name: fileNames[index], // Use original filename
        file_path: filePath,
        file_size: attachedFiles[index].size,
        mime_type: attachedFiles[index].type,
      }));

      const { error: attachError } = await supabase
        .from("message_attachments")
        .insert(attachmentsData);

      if (attachError) console.error("Failed to save attachments:", attachError);
    }

    abortControllerRef.current = new AbortController();

    let assistantResponse = "";
    const isFirstMessage = messages.length === 0;

    await streamGeminiChat({
      messages: [...messages, userMessage],
      model,
      temperature,
      jsonMode,
      useWebSearch,
      systemInstruction,
      urlContext,
      thinkingBudget,
      safetySettings,
      signal: abortControllerRef.current.signal,
      onToken: (token) => {
        assistantResponse += token;
        setCurrentAssistantMessage(assistantResponse);
        // Scrolling is handled by the continuous interval during streaming
      },
      onMetadata: (metadata) => {
        setTokenMetadata(metadata);
      },
      onThinking: (thinking) => {
        setIsThinking(thinking);
      },
      onThoughtSummary: (summary) => {
        setThoughtSummaries((prev) => [...prev, summary]);
      },
      onComplete: async () => {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: assistantResponse },
        ]);
        setCurrentAssistantMessage("");
        setIsStreaming(false);
        abortControllerRef.current = null;
        // Final smooth scroll after completion
        setTimeout(() => scrollToBottom("smooth"), 100);

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
        setTimeout(() => scrollToBottom("smooth"), 100);
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
    setAttachedFiles([]);
    setSessionId(null);
    onNewSession?.();
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const validFiles = files.filter(file => {
      const maxSize = 20 * 1024 * 1024; // 20MB
      if (file.size > maxSize) {
        toast.error(`${file.name} exceeds 20MB limit`);
        return false;
      }
      return true;
    });

    if (attachedFiles.length + validFiles.length > 10) {
      toast.error("Maximum 10 files allowed");
      return;
    }

    setAttachedFiles(prev => [...prev, ...validFiles]);
  };

  const removeFile = (index: number) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="flex flex-col h-full">
      {/* Messages area - scrollable */}
      <div className="flex-1 overflow-hidden relative scroll-none">
        {/* Animated background */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl animate-pulse" />
          <div className="absolute bottom-1/3 right-1/4 w-[500px] h-[500px] bg-accent/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: "1s" }} />
        </div>

          <div
            ref={viewportRef}
            className="max-w-4xl mx-auto space-y-6 py-6 px-6 min-h-full flex flex-col scroll-y-auto"
            style={{ paddingBottom: inputHeight }}
          >
            {messages.length === 0 && !currentAssistantMessage && (
              <div className="flex-1 flex items-start justify-center pt-20">
                <div className="flex flex-col items-center text-center gap-5">
                  <div className="w-20 h-20 rounded-2xl bg-gradient-primary flex items-center justify-center shadow-glow animate-float">
                    <svg
                      className="w-9 h-9 text-white animate-pulse"
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
                  <div className="space-y-3 animate-chat-rise">
                    <h2 className="text-3xl font-semibold">Welcome to Gemini 2.5 Studio</h2>
                    <p className="text-muted-foreground max-w-md mx-auto">
                      Start a conversation with Google's most advanced AI models. Ask anything, explore ideas, or build something amazing.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {messages.map((message, index) => (
              <div
                key={index}
                className={cn(
                  "flex w-full animate-scale-in",
                  message.role === "user" ? "justify-end" : "justify-start"
                )}
              >
                <div
                  className={cn(
                    "flex items-start gap-3 max-w-[min(85%,620px)]",
                    message.role === "user" && "flex-row-reverse"
                  )}
                >
                  <div
                    className={cn(
                      "w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-sm font-medium",
                      message.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-gradient-accent text-white"
                    )}
                  >
                    {message.role === "user" ? "U" : "AI"}
                  </div>
                  <Card
                    className={cn(
                      "border px-5 py-4 rounded-2xl shadow-sm",
                      message.role === "user"
                        ? "bg-primary text-primary-foreground border-transparent"
                        : "bg-card/90 border-border"
                    )}
                  >
                    <Suspense fallback={<MessageContentFallback />}>
                      <MessageContent content={message.content} attachments={message.attachments} />
                    </Suspense>
                  </Card>
                </div>
              </div>
            ))}

            {currentAssistantMessage && (
              <div className="flex w-full justify-start animate-scale-in">
                <div className="flex items-start gap-3 max-w-[min(85%,620px)]">
                  <div className="w-8 h-8 rounded-full bg-gradient-accent flex items-center justify-center text-white text-sm font-medium">
                    AI
                  </div>
                  <Card className="border px-5 py-4 rounded-2xl shadow-sm bg-card/90 border-border">
                    <Suspense fallback={<MessageContentFallback />}>
                      <MessageContent content={currentAssistantMessage} />
                    </Suspense>
                  </Card>
                </div>
              </div>
            )}

            {isStreaming && !currentAssistantMessage && (
              <div className="flex w-full justify-start animate-fade-in">
                <div className="flex items-start gap-3 max-w-[min(85%,620px)]">
                  <div className="w-8 h-8 rounded-full bg-gradient-accent flex items-center justify-center animate-pulse-glow">
                    <span className="text-white text-sm">AI</span>
                  </div>
                  <Card className="border px-5 py-4 rounded-2xl shadow-sm bg-card/90 border-border">
                    {isThinking ? (
                      <div className="flex items-center gap-2">
                        <div className="flex gap-1">
                          <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                          <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                          <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                        </div>
                        <span className="text-sm text-muted-foreground italic">Thinking...</span>
                      </div>
                    ) : (
                      <div className="flex gap-1">
                        <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                        <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                        <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                      </div>
                    )}
                  </Card>
                </div>
              </div>
            )}

            {thoughtSummaries.length > 0 && (
              <div className="flex w-full justify-start animate-fade-in">
                <div className="flex items-start gap-3 max-w-[min(85%,620px)]">
                  <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
                    <span className="text-primary text-sm">💭</span>
                  </div>
                  <Card className="border px-5 py-4 rounded-2xl shadow-sm bg-primary/5 border-primary/20">
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-primary">Thought Summaries</p>
                      {thoughtSummaries.map((summary, i) => (
                        <p key={i} className="text-xs text-muted-foreground">{summary}</p>
                      ))}
                    </div>
                  </Card>
                </div>
              </div>
            )}

          </div>
      </div>

      {/* Sticky input area */}
      <div className="sticky bottom-0 left-0 right-0 pointer-events-none">
        <div
          ref={inputContainerRef}
          className="max-w-4xl mx-auto w-full space-y-3 pointer-events-auto px-6 py-4"
        >
          {/* Usage counters hidden to avoid a visible lower bar */}
          {false && tokenMetadata && (
            <div className="flex justify-center gap-4 text-xs text-muted-foreground">
              <span>Prompt: {tokenMetadata.promptTokens} tokens</span>
              <span>Response: {tokenMetadata.completionTokens} tokens</span>
              <span>Total: {tokenMetadata.totalTokens} tokens</span>
            </div>
          )}
          {attachedFiles.length > 0 && (
            <div className="flex flex-wrap justify-center gap-2">
              {attachedFiles.map((file, index) => (
                <div key={index} className="flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 backdrop-blur">
                  {file.type.startsWith('image/') ? (
                    <ImageIcon className="h-4 w-4 text-primary" />
                  ) : (
                    <FileText className="h-4 w-4 text-primary" />
                  )}
                  <span className="text-sm truncate max-w-[150px] text-primary-foreground/80">
                    {file.name}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 rounded-full text-primary hover:bg-primary/20"
                    onClick={() => removeFile(index)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}
          <div className="relative">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,.pdf,.txt,.md,.json,.csv"
              onChange={handleFileSelect}
              className="hidden"
            />
            <div className="flex items-center gap-2 rounded-full border border-primary/30 bg-card/95 px-3 py-1.5 shadow-glow backdrop-blur supports-[backdrop-filter]:backdrop-blur-md">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => fileInputRef.current?.click()}
                disabled={isStreaming}
                className="h-10 w-10 shrink-0 rounded-full bg-primary/10 text-primary hover:bg-primary/20 transition-smooth"
              >
                <Paperclip className="h-5 w-5" />
              </Button>
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
                className="min-h-[36px] max-h-[180px] flex-1 resize-none border-0 bg-transparent px-0 py-1 text-base shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                disabled={isStreaming}
              />
              {isStreaming ? (
                <Button
                  onClick={handleStop}
                  size="icon"
                  variant="destructive"
                  className="h-10 w-10 shrink-0 rounded-full transition-smooth"
                >
                  <Square className="h-5 w-5" />
                </Button>
              ) : (
                <Button
                  onClick={handleSend}
                  size="icon"
                  className="h-10 w-10 shrink-0 rounded-full bg-gradient-primary text-primary-foreground shadow-glow transition-smooth hover:opacity-90"
                  disabled={!input.trim() && attachedFiles.length === 0}
                >
                  <Send className="h-5 w-5" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
