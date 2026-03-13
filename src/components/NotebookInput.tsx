import { useState, useRef, useCallback } from "react";

type Props = {
  placeholder: string;
  disabled: boolean;
  onSubmit: (message: string) => void;
};

export function NotebookInput({ placeholder, disabled, onSubmit }: Props) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSubmit(trimmed);
    setValue("");
  }, [value, disabled, onSubmit]);

  return (
    <div className="notebook-input">
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
          }
        }}
        placeholder={placeholder}
        disabled={disabled}
        className="notebook-input__field"
      />
      <button
        onClick={handleSubmit}
        disabled={disabled || !value.trim()}
        className="notebook-input__submit"
      >
        {"\u21B5"}
      </button>
    </div>
  );
}
