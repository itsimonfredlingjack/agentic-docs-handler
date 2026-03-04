import type { SourceModality } from "../types/documents";

const imagePrefixes = ["image/"];
const audioPrefixes = ["audio/"];

export function inferSourceModality(mimeType: string): SourceModality {
  if (imagePrefixes.some((prefix) => mimeType.startsWith(prefix))) {
    return "image";
  }
  if (audioPrefixes.some((prefix) => mimeType.startsWith(prefix))) {
    return "audio";
  }
  return "text";
}

export function basename(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const segments = normalized.split("/");
  return segments[segments.length - 1] ?? path;
}
