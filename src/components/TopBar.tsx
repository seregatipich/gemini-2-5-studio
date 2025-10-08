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
  setSystemInstruction
}: TopBarProps) {
  return (
    <header className="h-14 border-b border-border flex items-center justify-between px-4 bg-card">
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
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
