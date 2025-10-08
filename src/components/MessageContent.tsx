import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Copy, Check, FileText } from "lucide-react";
import {
  memo,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type CSSProperties,
} from "react";
import { Button } from "@/components/ui/button";
import type { Components } from "react-markdown";

interface MessageContentProps {
  content: string;
  attachments?: string[];
}

type SyntaxHighlighterComponentProps = {
  children?: ReactNode;
  language?: string;
  style?: Record<string, unknown>;
  customStyle?: CSSProperties;
  PreTag?: ComponentType | string;
};

type SyntaxResources = {
  SyntaxHighlighter: ComponentType<SyntaxHighlighterComponentProps>;
  syntaxTheme: Record<string, unknown>;
};

let syntaxResourcesPromise: Promise<SyntaxResources> | null = null;

function loadSyntaxResources(): Promise<SyntaxResources> {
  if (!syntaxResourcesPromise) {
    syntaxResourcesPromise = Promise.all([
      import("react-syntax-highlighter").then((module) => module.Prism),
      import("react-syntax-highlighter/dist/esm/styles/prism").then(
        (module) => module.oneDark
      ),
    ]).then(([SyntaxHighlighter, syntaxTheme]) => ({
      SyntaxHighlighter: SyntaxHighlighter as ComponentType<SyntaxHighlighterComponentProps>,
      syntaxTheme,
    }));
  }

  return syntaxResourcesPromise;
}

const MessageContentComponent = ({ content, attachments }: MessageContentProps) => {
  const components = useMemo<Components>(
    () => ({
      code({ className, children, ...props }) {
        const match = /language-(\w+)/.exec(className || "");
        const language = match ? match[1] : "";
        const code = String(children).replace(/\n$/, "");
        const isInline = !match;

        if (!isInline && match) {
          return <CodeBlock code={code} language={language} />;
        }

        return (
          <code className={className} {...props}>
            {children}
          </code>
        );
      },
    }),
    []
  );

  const attachmentsContent = useMemo(() => {
    if (!attachments || attachments.length === 0) {
      return null;
    }

    return (
      <div className="flex flex-wrap gap-2">
        {attachments.map((url, index) => {
          const isImage =
            /^data:image\//i.test(url) || /\.(jpg|jpeg|png|gif|webp)$/i.test(url);

          return isImage ? (
            <img
              key={index}
              src={url}
              alt={`Attachment ${index + 1}`}
              className="max-w-xs rounded-lg border"
            />
          ) : (
            <a
              key={index}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-2 bg-muted rounded-lg border hover:bg-muted/80 transition-colors"
            >
              <FileText className="h-4 w-4" />
              <span className="text-sm">Attachment {index + 1}</span>
            </a>
          );
        })}
      </div>
    );
  }, [attachments]);

  return (
    <div className="space-y-3">
      {attachmentsContent}
      <div className="prose prose-sm dark:prose-invert max-w-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
};

MessageContentComponent.displayName = "MessageContentComponent";

export const MessageContent = memo(MessageContentComponent);

type CodeBlockProps = {
  code: string;
  language: string;
};

function CodeBlock({ code, language }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const [syntaxResources, setSyntaxResources] = useState<SyntaxResources | null>(
    null
  );

  useEffect(() => {
    let cancelled = false;

    loadSyntaxResources()
      .then((resources) => {
        if (!cancelled) {
          setSyntaxResources(resources);
        }
      })
      .catch((error) => {
        console.error("Failed to load syntax highlighting resources", error);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const { SyntaxHighlighter, syntaxTheme } = syntaxResources ?? {};

  if (!SyntaxHighlighter || !syntaxTheme) {
    return (
      <div className="relative group my-4">
        <div className="absolute right-2 top-2 z-10">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity bg-background/80 hover:bg-background"
            onClick={handleCopy}
          >
            {copied ? (
              <Check className="h-4 w-4 text-green-500" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </Button>
        </div>
        <div className="flex items-center justify-between bg-muted/50 px-4 py-2 rounded-t-lg border border-b-0">
          <span className="text-xs font-mono text-muted-foreground">{language}</span>
        </div>
        <pre
          className="overflow-x-auto text-sm font-mono bg-muted/50 px-4 py-3 rounded-b-lg border border-t-0"
          style={{ margin: 0 } as CSSProperties}
        >
          {code}
        </pre>
      </div>
    );
  }

  return (
    <div className="relative group my-4">
      <div className="absolute right-2 top-2 z-10">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity bg-background/80 hover:bg-background"
          onClick={handleCopy}
        >
          {copied ? (
            <Check className="h-4 w-4 text-green-500" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </Button>
      </div>
      <div className="flex items-center justify-between bg-muted/50 px-4 py-2 rounded-t-lg border border-b-0">
        <span className="text-xs font-mono text-muted-foreground">{language}</span>
      </div>
      <SyntaxHighlighter
        language={language}
        style={syntaxTheme}
        customStyle={{
          margin: 0,
          borderTopLeftRadius: 0,
          borderTopRightRadius: 0,
          borderBottomLeftRadius: "0.5rem",
          borderBottomRightRadius: "0.5rem",
        } as CSSProperties}
        PreTag="div"
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}
