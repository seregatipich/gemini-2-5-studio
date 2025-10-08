import { useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";

interface TopBarProps {
  model: string;
  setModel: (model: string) => void;
  temperature: number;
  setTemperature: (temperature: number) => void;
  jsonMode: boolean;
  setJsonMode: (jsonMode: boolean) => void;
  useWebSearch: boolean;
  setUseWebSearch: (useWebSearch: boolean) => void;
  systemInstruction: string;
  setSystemInstruction: (systemInstruction: string) => void;
  urlContext: string;
  setUrlContext: (urlContext: string) => void;
  thinkingBudget: number;
  setThinkingBudget: (thinkingBudget: number) => void;
  thinkingBudgetEnabled: boolean;
  setThinkingBudgetEnabled: (enabled: boolean) => void;
  thinkingBudgetRange: {
    min: number;
    max: number;
  };
  safetySettings: {
    harassment: string;
    hateSpeech: string;
    sexuallyExplicit: string;
    dangerousContent: string;
  };
  setSafetySettings: (settings: any) => void;
}

export function TopBar({ 
  model, 
  setModel, 
  temperature, 
  setTemperature, 
  jsonMode, 
  setJsonMode,
  useWebSearch,
  setUseWebSearch,
  systemInstruction,
  setSystemInstruction,
  urlContext,
  setUrlContext,
  thinkingBudget,
  setThinkingBudget,
  thinkingBudgetEnabled,
  setThinkingBudgetEnabled,
  thinkingBudgetRange,
  safetySettings,
  setSafetySettings
}: TopBarProps) {
  const sliderStep = Math.max(1, Math.round((thinkingBudgetRange.max - thinkingBudgetRange.min) / 100));

  const formattedThinkingBudget = thinkingBudgetEnabled
    ? `${thinkingBudget} tokens`
    : `${thinkingBudgetRange.max} tokens (max)`;

  return (
    <header className="sticky top-0 z-50 h-14 border-b border-border flex items-center justify-between px-4 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
      <div className="flex items-center gap-2">
        <SidebarTrigger />
      </div>

      <div className="flex items-center gap-2">
        <Select value={model} onValueChange={setModel}>
          <SelectTrigger className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="gemini-2.5-pro">Gemini 2.5 Pro</SelectItem>
            <SelectItem value="gemini-2.5-flash">Gemini 2.5 Flash</SelectItem>
            <SelectItem value="gemini-2.5-flash-lite">Gemini 2.5 Flash Lite</SelectItem>
          </SelectContent>
        </Select>

        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline" size="icon">
              <SlidersHorizontal className="h-4 w-4" />
            </Button>
          </SheetTrigger>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>Model Settings</SheetTitle>
              <SheetDescription>
                Configure parameters for your AI model
              </SheetDescription>
            </SheetHeader>
            <ScrollArea className="h-[calc(100vh-10rem)] pr-4">
            <div className="space-y-6 py-6">
              <div className="space-y-2">
                <Label>Temperature: {temperature.toFixed(2)}</Label>
                <Slider
                  value={[temperature]}
                  onValueChange={(value) => setTemperature(value[0])}
                  min={0}
                  max={2}
                  step={0.1}
                />
                <p className="text-xs text-muted-foreground">
                  Higher values make output more random, lower values more focused
                </p>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="systemInstruction">System Instructions</Label>
                <Textarea
                  id="systemInstruction"
                  placeholder="Define AI behavior and personality..."
                  value={systemInstruction}
                  onChange={(e) => setSystemInstruction(e.target.value)}
                  className="min-h-[120px] resize-none"
                />
                <p className="text-xs text-muted-foreground">
                  Custom instructions for the AI assistant
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="urlContext">URL Context</Label>
                <Textarea
                  id="urlContext"
                  placeholder="Enter URLs (one per line) for the model to reference..."
                  value={urlContext}
                  onChange={(e) => setUrlContext(e.target.value)}
                  className="min-h-[80px] resize-none"
                />
                <p className="text-xs text-muted-foreground">
                  Model will fetch and parse content from these URLs
                </p>
              </div>

              <div className="space-y-2">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="text-sm font-semibold">Set thinking budget</Label>
                      <p className="text-xs text-muted-foreground">
                        Range {thinkingBudgetRange.min.toLocaleString()} - {thinkingBudgetRange.max.toLocaleString()} tokens
                      </p>
                    </div>
                    <Switch
                      checked={thinkingBudgetEnabled}
                      onCheckedChange={setThinkingBudgetEnabled}
                      aria-label="Toggle custom thinking budget"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Thinking Budget: {formattedThinkingBudget}</Label>
                    <Slider
                      value={[thinkingBudget]}
                      onValueChange={(value) => setThinkingBudget(value[0])}
                      min={thinkingBudgetRange.min}
                      max={thinkingBudgetRange.max}
                      step={sliderStep}
                      disabled={!thinkingBudgetEnabled}
                    />
                    <p className="text-xs text-muted-foreground">
                      Tokens allocated for model reasoning (thinking models only)
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between p-4 border rounded-lg bg-accent/5">
                <div className="space-y-0.5">
                  <Label className="text-sm font-semibold">JSON Mode</Label>
                  <p className="text-xs text-muted-foreground">
                    Force structured JSON output
                  </p>
                </div>
                <Switch 
                  checked={jsonMode} 
                  onCheckedChange={setJsonMode}
                />
              </div>
              
              <div className="flex items-center justify-between p-4 border rounded-lg bg-accent/5">
                <div className="space-y-0.5">
                  <Label className="text-sm font-semibold">Web Search</Label>
                  <p className="text-xs text-muted-foreground">
                    Enable Google Search grounding
                  </p>
                </div>
                <Switch 
                  checked={useWebSearch} 
                  onCheckedChange={setUseWebSearch}
                />
              </div>

              <div className="space-y-4 p-4 border rounded-lg bg-accent/5">
                <Label className="text-sm font-semibold">Safety Filters</Label>
                <div className="space-y-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Harassment</Label>
                    <Select 
                      value={safetySettings.harassment} 
                      onValueChange={(value) => setSafetySettings({...safetySettings, harassment: value})}
                    >
                      <SelectTrigger className="h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="BLOCK_NONE">None</SelectItem>
                        <SelectItem value="BLOCK_ONLY_HIGH">Only High</SelectItem>
                        <SelectItem value="BLOCK_MEDIUM_AND_ABOVE">Medium+</SelectItem>
                        <SelectItem value="BLOCK_LOW_AND_ABOVE">Low+</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Hate Speech</Label>
                    <Select 
                      value={safetySettings.hateSpeech} 
                      onValueChange={(value) => setSafetySettings({...safetySettings, hateSpeech: value})}
                    >
                      <SelectTrigger className="h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="BLOCK_NONE">None</SelectItem>
                        <SelectItem value="BLOCK_ONLY_HIGH">Only High</SelectItem>
                        <SelectItem value="BLOCK_MEDIUM_AND_ABOVE">Medium+</SelectItem>
                        <SelectItem value="BLOCK_LOW_AND_ABOVE">Low+</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Sexually Explicit</Label>
                    <Select 
                      value={safetySettings.sexuallyExplicit} 
                      onValueChange={(value) => setSafetySettings({...safetySettings, sexuallyExplicit: value})}
                    >
                      <SelectTrigger className="h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="BLOCK_NONE">None</SelectItem>
                        <SelectItem value="BLOCK_ONLY_HIGH">Only High</SelectItem>
                        <SelectItem value="BLOCK_MEDIUM_AND_ABOVE">Medium+</SelectItem>
                        <SelectItem value="BLOCK_LOW_AND_ABOVE">Low+</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Dangerous Content</Label>
                    <Select 
                      value={safetySettings.dangerousContent} 
                      onValueChange={(value) => setSafetySettings({...safetySettings, dangerousContent: value})}
                    >
                      <SelectTrigger className="h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="BLOCK_NONE">None</SelectItem>
                        <SelectItem value="BLOCK_ONLY_HIGH">Only High</SelectItem>
                        <SelectItem value="BLOCK_MEDIUM_AND_ABOVE">Medium+</SelectItem>
                        <SelectItem value="BLOCK_LOW_AND_ABOVE">Low+</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </div>
            </ScrollArea>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
