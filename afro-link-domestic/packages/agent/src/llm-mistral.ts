import type { ChatMessage, LlmAdapter } from './types';

export interface MistralLlmOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

export class MistralLlmAdapter implements LlmAdapter {
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(private readonly options: MistralLlmOptions) {
    this.model = options.model ?? 'mistral-small-latest';
    this.baseUrl = options.baseUrl ?? 'https://api.mistral.ai/v1';
  }

  async complete(input: { system: string; messages: ChatMessage[] }): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 15000);
    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.options.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0.3,
          messages: [{ role: 'system', content: input.system }, ...input.messages],
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`Mistral API error ${res.status}`);
      }
      const data = (await res.json()) as ChatCompletionResponse;
      const content = data.choices?.[0]?.message?.content?.trim();
      if (!content) {
        throw new Error('Mistral API returned an empty completion');
      }
      return content;
    } finally {
      clearTimeout(timer);
    }
  }
}
