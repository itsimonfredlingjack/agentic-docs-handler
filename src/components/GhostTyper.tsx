import { useEffect, useRef, useState } from "react";

type GhostTyperProps = {
  text: string;
  speed?: number; // ms per character
  className?: string;
  onDone?: () => void;
};

export function GhostTyper({ text, speed = 25, className, onDone }: GhostTyperProps) {
  const [charIndex, setCharIndex] = useState(0);
  const previousTextRef = useRef(text);
  const isDone = charIndex >= text.length;

  useEffect(() => {
    if (!text || isDone) return;
    const timer = setInterval(() => {
      setCharIndex((prev) => {
        const next = prev + 1;
        if (next >= text.length) {
          clearInterval(timer);
          onDone?.();
        }
        return next;
      });
    }, speed);
    return () => clearInterval(timer);
  }, [text, speed, isDone, onDone]);

  // Reset when text changes
  useEffect(() => {
    if (previousTextRef.current === text) {
      return;
    }
    previousTextRef.current = text;
    setCharIndex(0);
  }, [text]);

  return (
    <span className={className} data-testid="ghost-typer">
      {text.slice(0, charIndex)}
      {!isDone && text.length > 0 && (
        <span className="ghost-cursor" data-testid="ghost-cursor" />
      )}
    </span>
  );
}
