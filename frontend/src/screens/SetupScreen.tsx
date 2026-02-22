import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { JoinForm } from "@/components/setup/JoinForm";
import {
  SettingsPanel,
  type SettingsValues,
} from "@/components/setup/SettingsPanel";
import {
  loadProfile,
  loadContracts,
  type ProfileData,
} from "@/hooks/use-profile";
import { useSessionStore } from "@/stores/session-store";
import { Settings, FileText } from "lucide-react";

const MAX_DOCS = 5;

export function SetupScreen() {
  const showContracts = useSessionStore((s) => s.showContracts);
  const [contractCount] = useState(() => loadContracts().length);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<SettingsValues>(() => {
    const p = loadProfile();
    return {
      role: p.role ?? "",
      negStyle: p.preferences?.negotiationStyle ?? "balanced",
      currency: p.preferences?.preferredCurrency ?? "gbp",
      maxApprove: String((p.preferences?.maxAutoApproveAmount ?? 5000) / 100),
      escrowPref: p.preferences?.escrowPreference ?? "above_threshold",
      escrowThreshold: String((p.preferences?.escrowThreshold ?? 10000) / 100),
      trade: p.trade ?? "",
      experienceYears:
        p.experienceYears != null ? String(p.experienceYears) : "",
      certifications: Array.isArray(p.certifications)
        ? p.certifications.join(", ")
        : "",
      rateMin: p.typicalRateRange
        ? String((p.typicalRateRange.min ?? 0) / 100)
        : "",
      rateMax: p.typicalRateRange
        ? String((p.typicalRateRange.max ?? 0) / 100)
        : "",
      rateUnit: p.typicalRateRange?.unit ?? "hour",
      serviceArea: p.serviceArea ?? "",
      customInstructions: p.customInstructions ?? "",
      stripeId: p.stripeAccountId ?? "",
      monzoToken: "",
    };
  });

  const [contextDocuments, setContextDocuments] = useState<string[]>(
    () => loadProfile().contextDocuments ?? [],
  );

  const handleSettingChange = useCallback(
    (field: keyof SettingsValues, value: string) => {
      setSettings((prev) => ({ ...prev, [field]: value }));
    },
    [],
  );

  const handleAddDocument = useCallback((text: string) => {
    setContextDocuments((prev) =>
      prev.length < MAX_DOCS ? [...prev, text] : prev,
    );
  }, []);

  const handleRemoveDocument = useCallback((index: number) => {
    setContextDocuments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const buildProfile = useCallback((): ProfileData => {
    const trade = settings.trade.trim() || undefined;
    const expVal = settings.experienceYears;
    const experienceYears = expVal !== "" ? Number(expVal) : undefined;
    const certsRaw = settings.certifications.trim();
    const certifications = certsRaw
      ? certsRaw
          .split(",")
          .map((c) => c.trim())
          .filter(Boolean)
      : undefined;
    const rateMin = Number(settings.rateMin) || 0;
    const rateMax = Number(settings.rateMax) || 0;
    const typicalRateRange =
      rateMax > 0
        ? {
            min: Math.round(rateMin * 100),
            max: Math.round(rateMax * 100),
            unit: settings.rateUnit,
          }
        : undefined;
    const serviceArea = settings.serviceArea.trim() || undefined;

    return {
      displayName: "", // filled by JoinForm
      role: settings.role.trim() || "participant",
      customInstructions: settings.customInstructions.trim(),
      preferences: {
        maxAutoApproveAmount: Math.round(Number(settings.maxApprove) * 100),
        preferredCurrency: settings.currency,
        escrowPreference: settings.escrowPref,
        escrowThreshold: Math.round(Number(settings.escrowThreshold) * 100),
        negotiationStyle: settings.negStyle,
      },
      stripeAccountId: settings.stripeId.trim() || undefined,
      monzoAccessToken: settings.monzoToken.trim() || undefined,
      trade,
      experienceYears,
      certifications,
      typicalRateRange,
      serviceArea,
      contextDocuments:
        contextDocuments.length > 0 ? contextDocuments : undefined,
    };
  }, [settings, contextDocuments]);

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center px-6">
      {/* Gear button */}
      <Button
        variant="outline"
        size="icon"
        className="absolute right-5 top-5 border-separator text-text-secondary"
        onClick={() => setSettingsOpen(true)}
      >
        <Settings className="size-5" />
      </Button>

      {/* Header */}
      <h1 className="mb-1 bg-gradient-to-r from-accent-blue to-accent-green bg-clip-text text-4xl font-extrabold text-transparent">
        Handshake
      </h1>
      <p className="mb-8 text-sm text-text-secondary">
        Speak it. Agree it. Pay it.
      </p>

      {/* Join form */}
      <JoinForm buildProfile={buildProfile} />

      {/* My Contracts */}
      <Button
        variant="outline"
        className="mt-4 border-separator text-text-secondary"
        onClick={showContracts}
      >
        <FileText className="mr-2 size-4" />
        My Contracts
        {contractCount > 0 && (
          <span className="ml-2 inline-flex size-5 items-center justify-center rounded-full bg-accent-blue text-[10px] font-bold text-white">
            {contractCount}
          </span>
        )}
      </Button>

      {/* Settings */}
      <SettingsPanel
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        values={settings}
        onChange={handleSettingChange}
        contextDocuments={contextDocuments}
        onAddDocument={handleAddDocument}
        onRemoveDocument={handleRemoveDocument}
      />
    </div>
  );
}
