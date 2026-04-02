import { useCallback, useState } from "react";

export type UxActionState = "idle" | "working" | "success" | "error";

export function useUxState() {
  const [state, setState] = useState<UxActionState>("idle");
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(() => {
    setState("working");
    setError(null);
  }, []);

  const succeed = useCallback(() => {
    setState("success");
    setError(null);
  }, []);

  const fail = useCallback((message: string) => {
    setState("error");
    setError(message);
  }, []);

  const reset = useCallback(() => {
    setState("idle");
    setError(null);
  }, []);

  return {
    state,
    error,
    isIdle: state === "idle",
    isWorking: state === "working",
    isSuccess: state === "success",
    isError: state === "error",
    start,
    succeed,
    fail,
    reset,
  };
}
