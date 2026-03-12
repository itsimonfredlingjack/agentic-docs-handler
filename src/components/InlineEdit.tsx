import { useEffect, useRef, useState } from "react";

type InlineEditProps = {
  value: string;
  onSave: (newValue: string) => void;
  className?: string;
};

export function InlineEdit({ value, onSave, className }: InlineEditProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  if (!editing) {
    return (
      <span
        className={`inline-edit ${className ?? ""}`}
        onClick={() => { setDraft(value); setEditing(true); }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter") { setDraft(value); setEditing(true); } }}
      >
        {value}
      </span>
    );
  }

  return (
    <input
      ref={inputRef}
      className={`inline-edit inline-edit--active ${className ?? ""}`}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          onSave(draft);
          setEditing(false);
        }
        if (e.key === "Escape") {
          setEditing(false);
        }
      }}
      onBlur={() => setEditing(false)}
    />
  );
}
