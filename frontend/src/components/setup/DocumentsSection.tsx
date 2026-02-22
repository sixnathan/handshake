import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Upload, X, FileText, AlertTriangle } from "lucide-react";
import { SettingsCard, SectionLabel } from "./shared";

const MAX_DOCS = 5;
const MAX_CHARS = 5120;
const ACCEPTED_TYPES = [".txt", ".md"];

interface DocumentsSectionProps {
  documents: string[];
  onAdd: (text: string) => void;
  onRemove: (index: number) => void;
}

export function DocumentsSection({
  documents,
  onAdd,
  onRemove,
}: DocumentsSectionProps) {
  const [pasteText, setPasteText] = useState("");
  const [dragging, setDragging] = useState(false);
  const dragCounter = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isFull = documents.length >= MAX_DOCS;

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files) return;
      Array.from(files).forEach((file) => {
        if (documents.length >= MAX_DOCS) return;
        const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
        if (!ACCEPTED_TYPES.includes(ext)) return;
        const reader = new FileReader();
        reader.onload = () => {
          const text = reader.result as string;
          if (text.trim()) onAdd(text);
        };
        reader.readAsText(file);
      });
    },
    [documents.length, onAdd],
  );

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current += 1;
    setDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current -= 1;
    if (dragCounter.current === 0) setDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter.current = 0;
      setDragging(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles],
  );

  const handlePasteAdd = useCallback(() => {
    const trimmed = pasteText.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setPasteText("");
  }, [pasteText, onAdd]);

  return (
    <SettingsCard
      icon={<FileText className="size-4" />}
      title="Documents"
      description="Add documents to give your agent background context — contracts, specs, notes, or any reference material."
    >
      {/* Drop zone */}
      {!isFull && (
        <div
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          className={`flex flex-col items-center gap-2 rounded-lg border-2 border-dashed p-6 transition-colors ${
            dragging
              ? "border-accent-blue bg-accent-blue/10"
              : "border-separator hover:border-text-tertiary"
          }`}
        >
          <Upload className="size-6 text-text-tertiary" />
          <p className="text-sm text-text-secondary">
            Drag & drop <span className="font-medium">.txt</span> or{" "}
            <span className="font-medium">.md</span> files
          </p>
          <Button
            variant="outline"
            size="sm"
            className="border-separator text-text-secondary"
            onClick={() => fileInputRef.current?.click()}
          >
            Browse files
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.md"
            multiple
            className="hidden"
            onChange={(e) => {
              handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
      )}

      {/* Text paste */}
      {!isFull && (
        <div className="flex flex-col gap-2">
          <SectionLabel>Or paste text</SectionLabel>
          <Textarea
            placeholder="Paste document content here..."
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            className="min-h-[60px] border-separator bg-surface-tertiary text-text-primary"
          />
          <Button
            variant="outline"
            size="sm"
            disabled={!pasteText.trim()}
            className="self-end border-separator text-text-secondary"
            onClick={handlePasteAdd}
          >
            Add
          </Button>
        </div>
      )}

      {/* Counter */}
      <p className="text-xs text-text-tertiary">
        {documents.length}/{MAX_DOCS} documents
      </p>

      {/* Document cards */}
      {documents.map((doc, i) => {
        const overLimit = doc.length > MAX_CHARS;
        return (
          <div
            key={i}
            className="flex items-start gap-3 rounded-lg border border-separator bg-surface-tertiary p-3"
          >
            <FileText className="mt-0.5 size-4 shrink-0 text-text-tertiary" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-text-primary">
                {doc.slice(0, 120)}
                {doc.length > 120 && "..."}
              </p>
              <div className="mt-1 flex items-center gap-2">
                <span
                  className={`text-xs ${overLimit ? "text-red-400" : "text-text-tertiary"}`}
                >
                  {doc.length.toLocaleString()} chars
                </span>
                {overLimit && (
                  <span className="flex items-center gap-1 text-xs text-red-400">
                    <AlertTriangle className="size-3" />
                    exceeds {MAX_CHARS.toLocaleString()} limit
                  </span>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onRemove(i)}
              className="shrink-0 rounded p-1 text-text-tertiary transition-colors hover:bg-surface-primary hover:text-text-primary"
            >
              <X className="size-4" />
            </button>
          </div>
        );
      })}
    </SettingsCard>
  );
}
