import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { MessageSquare } from "lucide-react";
import { NegotiationSection } from "./NegotiationSection";
import { ProfileSection } from "./ProfileSection";
import { DocumentsSection } from "./DocumentsSection";
import { PaymentSection } from "./PaymentSection";
import { SettingsCard, type SettingsValues } from "./shared";

export { type SettingsValues } from "./shared";

interface SettingsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  values: SettingsValues;
  onChange: (field: keyof SettingsValues, value: string) => void;
  contextDocuments: string[];
  onAddDocument: (text: string) => void;
  onRemoveDocument: (index: number) => void;
}

export function SettingsPanel({
  open,
  onOpenChange,
  values,
  onChange,
  contextDocuments,
  onAddDocument,
  onRemoveDocument,
}: SettingsPanelProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full border-separator bg-surface-primary sm:w-[560px] sm:max-w-[60vw]"
      >
        <SheetHeader className="px-6 pt-6">
          <SheetTitle className="text-lg text-text-primary">
            Settings
          </SheetTitle>
          <SheetDescription className="text-text-tertiary">
            Configure your agent, profile, and payment details.
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-100px)]">
          <div className="space-y-4 px-6 pb-8">
            <NegotiationSection values={values} onChange={onChange} />
            <ProfileSection values={values} onChange={onChange} />

            <SettingsCard
              icon={<MessageSquare className="size-4" />}
              title="Instructions"
              description="Custom instructions for your agent's behaviour during negotiation."
            >
              <Textarea
                placeholder="Tell your agent how to negotiate for you..."
                value={values.customInstructions}
                onChange={(e) => onChange("customInstructions", e.target.value)}
                className="min-h-[80px] border-separator bg-surface-tertiary text-text-primary"
              />
            </SettingsCard>

            <DocumentsSection
              documents={contextDocuments}
              onAdd={onAddDocument}
              onRemove={onRemoveDocument}
            />
            <PaymentSection values={values} onChange={onChange} />
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
