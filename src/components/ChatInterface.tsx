import { useState, useRef, useEffect } from "react";
import { Send, Square, Paperclip, X, FileText, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { streamGeminiChat, Message } from "@/lib/gemini";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { MessageContent } from "@/components/MessageContent";
import { commandParser } from "@/lib/commands";

interface ChatInterfaceProps {
  model?: string;
  temperature?: number;
  jsonMode?: boolean;
  useWebSearch?: boolean;
  systemInstruction?: string;
  urlContext?: string;
  thinkingBudget?: number;
  safetySettings?: {
    harassment: string;
    hateSpeech: string;
    sexuallyExplicit: string;
    dangerousContent: string;
  };
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load session messages on mount
  useEffect(() => {
    if (initialSessionId) {
      loadSession(initialSessionId);
    }
  }, [initialSessionId]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, currentAssistantMessage]);

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
    let attachmentUrls: string[] = [];
    let filePaths: string[] = [];
    let fileNames: string[] = [];
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
    <div className="flex flex-col h-full relative overflow-hidden">
      {/* Animated background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/3 right-1/4 w-[500px] h-[500px] bg-accent/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: "1s" }} />
      </div>

      <ScrollArea className="flex-1 p-6 relative z-10" ref={scrollRef}>
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
                  <MessageContent content={message.content} attachments={message.attachments} />
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
                </div>
              </div>
            </Card>
          )}

          {thoughtSummaries.length > 0 && (
            <Card className="p-4 animate-fade-in mr-12 bg-primary/5 border-primary/20">
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
                  <span className="text-primary text-sm">💭</span>
                </div>
                <div className="flex-1 space-y-2">
                  <p className="text-sm font-medium text-primary">Thought Summaries</p>
                  {thoughtSummaries.map((summary, i) => (
                    <p key={i} className="text-xs text-muted-foreground">{summary}</p>
                  ))}
                </div>
              </div>
            </Card>
          )}
        </div>
      </ScrollArea>

      <div className="border-t border-border bg-card/80 backdrop-blur-sm relative z-10">
        {tokenMetadata && (
          <div className="max-w-4xl mx-auto px-4 pt-2">
            <div className="flex gap-4 text-xs text-muted-foreground">
              <span>Prompt: {tokenMetadata.promptTokens} tokens</span>
              <span>Response: {tokenMetadata.completionTokens} tokens</span>
              <span>Total: {tokenMetadata.totalTokens} tokens</span>
            </div>
          </div>
        )}
        {attachedFiles.length > 0 && (
          <div className="max-w-4xl mx-auto px-4 pt-3">
            <div className="flex flex-wrap gap-2">
              {attachedFiles.map((file, index) => (
                <div key={index} className="flex items-center gap-2 bg-muted/50 rounded-lg px-3 py-2 border">
                  {file.type.startsWith('image/') ? (
                    <ImageIcon className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <FileText className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span className="text-sm truncate max-w-[150px]">{file.name}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5"
                    onClick={() => removeFile(index)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="max-w-4xl mx-auto p-4 flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,.pdf,.txt,.md,.json,.csv"
            onChange={handleFileSelect}
            className="hidden"
          />
          <Button
            variant="outline"
            size="icon"
            onClick={() => fileInputRef.current?.click()}
            disabled={isStreaming}
            className="h-[60px] w-[60px] shrink-0"
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
              disabled={!input.trim() && attachedFiles.length === 0}
            >
              <Send className="h-5 w-5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
