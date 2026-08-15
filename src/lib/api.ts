import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

export interface Settings {
  api_key: string;
  model: string;
  launch_at_login: boolean;
  show_dock: boolean;
  last_prompt: string;
}

export interface OpenRouterModel {
  id: string;
  name: string;
  pricing: {
    prompt?: string | null;
    completion?: string | null;
    request?: string | null;
  } | null;
}

export interface SavedPrompt {
  id: string;
  title: string;
  text: string;
  created_at: number;
}

export function getSettings(): Promise<Settings> {
  return invoke("get_settings");
}

export function saveSettings(settings: Settings): Promise<void> {
  return invoke("save_settings", { settings });
}

export function saveLastPrompt(prompt: string): Promise<void> {
  return invoke("save_last_prompt", { prompt });
}

export function listSavedPrompts(): Promise<SavedPrompt[]> {
  return invoke("list_saved_prompts");
}

export function savePrompt(title: string, text: string): Promise<SavedPrompt> {
  return invoke("save_prompt", { title, text });
}

export function deletePrompt(id: string): Promise<void> {
  return invoke("delete_prompt", { id });
}

export function renamePrompt(id: string, title: string): Promise<void> {
  return invoke("rename_prompt", { id, title });
}

export function verifyApiKey(apiKey: string): Promise<void> {
  return invoke("verify_api_key", { apiKey });
}

export function fetchFreeModels(apiKey: string): Promise<OpenRouterModel[]> {
  return invoke("fetch_free_models", { apiKey });
}

export function onOpenSettings(cb: () => void): Promise<() => void> {
  return listen("open-settings", cb);
}

/**
 * Write text to the clipboard. navigator.clipboard.writeText can be blocked or
 * unavailable inside a Tauri webview, so fall back to a hidden textarea +
 * execCommand("copy"). Returns true on success.
 */
export async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the execCommand fallback
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** Port of DexTop's `optimizePrompt` meta-prompt (frontend/src/lib/augment.ts). */
export function optimizePrompt(text: string): string {
  return [
    "You are a prompt optimizer. Rewrite the user's prompt below so it is",
    "specific, unambiguous, and context-rich, letting an AI agent execute it",
    "with minimal assumptions on decision-driven tasks. Preserve the user's",
    "original intent, scope, and any constraints they stated — do not invent",
    "new requirements. Do NOT answer or perform the task. Do NOT add preamble,",
    "commentary, or explanation. Return ONLY the rewritten prompt as plain text.",
    "",
    "<user_prompt>",
    text,
    "</user_prompt>",
  ].join("\n");
}

/** Single-shot chat completion against OpenRouter (no tools, plain text out). */
export async function completePrompt(
  apiKey: string,
  model: string,
  prompt: string,
  signal?: AbortSignal,
  timeoutMs = 90_000,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://bard.local",
        "X-Title": "Bard",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.4,
        max_tokens: 4000,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`OpenRouter request failed (HTTP ${res.status})`);
    }
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim()) {
      throw new Error("Augment returned an empty result");
    }
    return text.trim();
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error("Augment was cancelled or timed out");
    }
    throw err;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}
