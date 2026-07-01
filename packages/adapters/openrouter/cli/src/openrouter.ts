import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { streamText, type CoreMessage } from 'ai';
import type { Tool } from './tools/index.js';

export interface OpenRouterConfig {
  apiKey: string;
  model: string;
  maxTokens?: number;
}

export async function* streamResponse(
  config: OpenRouterConfig,
  messages: CoreMessage[],
  _tools: Record<string, any>
) {
  const openrouter = createOpenRouter({ apiKey: config.apiKey });

  const result = await streamText({
    model: openrouter(config.model),
    messages,
    maxTokens: config.maxTokens || 4096,
  });

  let streamedText = "";

  for await (const chunk of result.textStream) {
    streamedText += chunk;
    yield { type: 'text', content: chunk };
  }

  // Some OpenRouter model/provider routes do not emit textStream chunks,
  // but may still resolve result.text. Use it as a bounded fallback.
  if (streamedText.trim().length === 0) {
    const fallbackText = await Promise.race([
      result.text,
      new Promise<string>((resolve) => setTimeout(() => resolve(""), 15000)),
    ]);

    if (fallbackText.trim().length > 0) {
      yield { type: 'text', content: fallbackText };
    }
  }

  // Do not await result.response here.
  // Some OpenRouter model/provider routes leave the AI SDK response promise
  // unsettled after text streaming, causing Node to exit with code 13.
  // The Paperclip adapter only needs streamed/final text for now.
}
