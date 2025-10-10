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
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const streamingAssistantRef = useRef<HTMLDivElement | null>(null);
  const lastAssistantRef = useRef<HTMLDivElement | null>(null);
  const isUserNearBottomRef = useRef(true);
  const shouldFocusAssistantRef = useRef(false);
  const userWasNearBottomOnSendRef = useRef(true);
  const prevAssistantLengthRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isStreamingRef = useRef(false);
  const autoScrollDisabledRef = useRef(false);
  const rafQueuedRef = useRef(false);
  const anchorEpsilonPx = 1; // tighter tolerance for top alignment
  const anchoredRef = useRef(false);
  const anchorTopOffsetRef = useRef(0);
  const alignFramesRemainingRef = useRef(0);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  const bottomThreshold = 120;

  const updateNearBottom = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const { scrollTop, scrollHeight, clientHeight } = viewport;
    const distance = scrollHeight - (scrollTop + clientHeight);
    const threshold = Math.max(bottomThreshold, clientHeight * 0.25);
    const wasNearBottom = isUserNearBottomRef.current;
    isUserNearBottomRef.current = distance <= threshold;
    if (isStreamingRef.current && distance > bottomThreshold && wasNearBottom) {
      autoScrollDisabledRef.current = true;
    }
    if (isStreamingRef.current && distance > bottomThreshold) {
      anchoredRef.current = false;
    }
  }, []);

  const scrollAssistantIntoView = useCallback(
    (behavior: ScrollBehavior = "auto") => {
      if (rafQueuedRef.current) return;
      rafQueuedRef.current = true;
      requestAnimationFrame(() => {
        rafQueuedRef.current = false;
        const viewport = viewportRef.current;
        const target = streamingAssistantRef.current ?? lastAssistantRef.current;
        if (!viewport || !target) return;

        const viewportRect = viewport.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        const offset = targetRect.top - viewportRect.top;

        if (Math.abs(offset) > anchorEpsilonPx) {
          if (behavior === "smooth") {
            viewport.scrollTo({ top: viewport.scrollTop + offset, behavior: "smooth" });
          } else {
            viewport.scrollTop = viewport.scrollTop + offset;
          }
        }
        updateNearBottom();
      });
    },
    [updateNearBottom, anchorEpsilonPx],
  );

  const ensureAlignedNow = useCallback(() => {
    const viewport = viewportRef.current;
    const target = streamingAssistantRef.current ?? lastAssistantRef.current;
    if (!viewport || !target) return true;
    const vRect = viewport.getBoundingClientRect();
    const tRect = target.getBoundingClientRect();
    const offset = tRect.top - vRect.top;
    if (Math.abs(offset) > anchorEpsilonPx) {
      viewport.scrollTop = viewport.scrollTop + offset;
      return false;
    }
    return true;
  }, [anchorEpsilonPx]);

  const startAlignmentLoop = useCallback(() => {
    alignFramesRemainingRef.current = 24; // ~400ms @60fps
    const step = () => {
      if (alignFramesRemainingRef.current <= 0) return;
      const done = ensureAlignedNow();
      alignFramesRemainingRef.current -= 1;
      if (!done) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [ensureAlignedNow]);

  // Load session messages on mount
  useEffect(() => {
    if (initialSessionId) {
      loadSession(initialSessionId);
    }
  }, [initialSessionId]);

  useEffect(() => {
    const viewport = scrollAreaRef.current?.querySelector(
      "[data-radix-scroll-area-viewport]"
    ) as HTMLDivElement | null;

    if (!viewport) return;

    viewportRef.current = viewport;
    updateNearBottom();

    viewport.addEventListener("scroll", updateNearBottom);
    return () => viewport.removeEventListener("scroll", updateNearBottom);
  }, [updateNearBottom]);

  useEffect(() => {
    updateNearBottom();
  }, [messages.length, currentAssistantMessage.length, updateNearBottom]);

  useEffect(() => {
    isStreamingRef.current = isStreaming;
  }, [isStreaming]);

  useLayoutEffect(() => {
    const prevLength = prevAssistantLengthRef.current;
    const currentLength = currentAssistantMessage.length;

    if (currentLength > 0 && prevLength === 0) {
      // When assistant starts responding, scroll to position it at the top
      updateNearBottom();
      if (shouldFocusAssistantRef.current) {
        // Always scroll to AI response when user sends a message
        scrollAssistantIntoView("smooth");
        // Capture top offset anchor relative to viewport
        requestAnimationFrame(() => {
          const viewport = viewportRef.current;
          const target = streamingAssistantRef.current ?? lastAssistantRef.current;
          if (!viewport || !target) return;
          const vRect = viewport.getBoundingClientRect();
          const tRect = target.getBoundingClientRect();
          anchorTopOffsetRef.current = tRect.top - vRect.top;
          anchoredRef.current = true;
        });
        // Kick a short alignment loop to guarantee snap
        startAlignmentLoop();
      } else if (isUserNearBottomRef.current && !autoScrollDisabledRef.current) {
        // Re-lock only if user is near bottom when new assistant message starts
        scrollAssistantIntoView("auto");
        requestAnimationFrame(() => {
          const viewport = viewportRef.current;
          const target = streamingAssistantRef.current ?? lastAssistantRef.current;
          if (!viewport || !target) return;
          const vRect = viewport.getBoundingClientRect();
          const tRect = target.getBoundingClientRect();
          anchorTopOffsetRef.current = tRect.top - vRect.top;
          anchoredRef.current = true;
        });
        startAlignmentLoop();
      } else {
        anchoredRef.current = false;
      }
      shouldFocusAssistantRef.current = false;
      autoScrollDisabledRef.current = false;
    }

    prevAssistantLengthRef.current = currentLength;
  }, [currentAssistantMessage, scrollAssistantIntoView, updateNearBottom, startAlignmentLoop]);

  // Scroll as soon as streaming begins (before first token) to position placeholder at top and capture anchor
  useLayoutEffect(() => {
    if (isStreaming && shouldFocusAssistantRef.current) {
      scrollAssistantIntoView("auto");
      const viewport = viewportRef.current;
      const target = streamingAssistantRef.current;
      if (viewport && target) {
        const vRect = viewport.getBoundingClientRect();
        const tRect = target.getBoundingClientRect();
        anchorTopOffsetRef.current = tRect.top - vRect.top;
        anchoredRef.current = true;
        startAlignmentLoop();
      }
      // We will allow near-bottom logic to disable scrolling if user scrolls away later
      autoScrollDisabledRef.current = false;
    }
  }, [isStreaming, scrollAssistantIntoView, startAlignmentLoop]);

  // Follow growth with ResizeObserver while streaming
  useEffect(() => {
    const viewport = viewportRef.current;
    const el = streamingAssistantRef.current;
    if (!viewport || !el) return;

    if (resizeObserverRef.current) {
      resizeObserverRef.current.disconnect();
      resizeObserverRef.current = null;
    }

    const ro = new ResizeObserver(() => {
      if (!anchoredRef.current || autoScrollDisabledRef.current) return;
      const vRect = viewport.getBoundingClientRect();
      const tRect = el.getBoundingClientRect();
      const diff = (tRect.top - vRect.top) - anchorTopOffsetRef.current;
      if (Math.abs(diff) > 0.5) {
        viewport.scrollTop += diff;
      }
    });
    ro.observe(el);
    resizeObserverRef.current = ro;

    return () => {
      ro.disconnect();
      if (resizeObserverRef.current === ro) resizeObserverRef.current = null;
    };
  }, [currentAssistantMessage]);

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

    // Mark that we should focus on assistant response regardless of scroll position
    updateNearBottom();
    userWasNearBottomOnSendRef.current = isUserNearBottomRef.current;
    shouldFocusAssistantRef.current = true; // Always scroll to AI response when sending
    autoScrollDisabledRef.current = false;

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
        const viewport = viewportRef.current;
        const target = streamingAssistantRef.current ?? lastAssistantRef.current;
        
        // Maintain anchor position during streaming if anchored
        if (
          anchoredRef.current &&
          viewport &&
          target &&
          !autoScrollDisabledRef.current
        ) {
          const vRect = viewport.getBoundingClientRect();
          const tRect = target.getBoundingClientRect();
          const diff = (tRect.top - vRect.top) - anchorTopOffsetRef.current;
          if (Math.abs(diff) > 0.5) {
            viewport.scrollTop += diff;
          }
        }
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
        shouldFocusAssistantRef.current = false;
        autoScrollDisabledRef.current = false;
        anchoredRef.current = false;
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
        autoScrollDisabledRef.current = false;
        anchoredRef.current = false;
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
    setAttachedFiles([]);
    setSessionId(null);
    shouldFocusAssistantRef.current = false;
    isUserNearBottomRef.current = true;
    autoScrollDisabledRef.current = false;
    anchoredRef.current = false;
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
      <div className="flex-1 overflow-hidden relative">
        {/* Animated background */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl animate-pulse" />
          <div className="absolute bottom-1/3 right-1/4 w-[500px] h-[500px] bg-accent/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: "1s" }} />
        </div>

        <ScrollArea ref={scrollAreaRef} className="h-full">
          <div className="max-w-4xl mx-auto space-y-6 py-6 px-6">
            {messages.length === 0 && !currentAssistantMessage && (
              <div className="flex min-h-[60vh] items-center justify-center py-20">
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
                    ref={message.role === "assistant" ? lastAssistantRef : undefined}
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
                  <Card ref={streamingAssistantRef} className="border px-5 py-4 rounded-2xl shadow-sm bg-card/90 border-border">
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
                  {/* Placeholder card for streaming, attach ref so we can scroll immediately */}
                  <Card ref={streamingAssistantRef} className="border px-5 py-4 rounded-2xl shadow-sm bg-card/90 border-border">
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
        </ScrollArea>
      </div>

      {/* Sticky input area */}
      <div className="sticky bottom-0 left-0 right-0 pointer-events-none">
        <div className="max-w-4xl mx-auto w-full space-y-3 pointer-events-auto px-6 py-4">
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
