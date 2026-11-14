import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DomesticAgent, MistralLlmAdapter } from '../src/index';
import type { AgentStore, LlmAdapter } from '../src/index';

const OK_RESPONSE = {
  choices: [{ message: { content: '  ጭነትዎ በተሳካ ሁኔታ ተመዝግቧል!  ' } }],
};

function fetchOk(body: unknown = OK_RESPONSE) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

describe('MistralLlmAdapter', () => {
  it('posts a chat completion and returns the trimmed content', async () => {
    const fetchMock = fetchOk();
    vi.stubGlobal('fetch', fetchMock);
    try {
      const adapter = new MistralLlmAdapter({ apiKey: 'test-key' });
      const reply = await adapter.complete({
        system: 'You are the Domestic AI Agent.',
        messages: [{ role: 'user', content: 'hello' }],
      });
      expect(reply).toBe('ጭነትዎ በተሳካ ሁኔታ ተመዝግቧል!');
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.mistral.ai/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ authorization: 'Bearer test-key' }),
        }),
      );
      const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as {
        model: string;
        messages: Array<{ role: string; content: string }>;
      };
      expect(body.model).toBe('mistral-small-latest');
      expect(body.messages[0]).toEqual({
        role: 'system',
        content: 'You are the Domestic AI Agent.',
      });
      expect(body.messages[1]).toEqual({ role: 'user', content: 'hello' });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('throws on non-ok responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{"error":"rate limited"}', { status: 429 })),
    );
    try {
      const adapter = new MistralLlmAdapter({ apiKey: 'test-key' });
      await expect(adapter.complete({ system: 's', messages: [] })).rejects.toThrow(
        /Mistral API error 429/,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('throws on empty completions', async () => {
    vi.stubGlobal('fetch', fetchOk({ choices: [{ message: { content: '  ' } }] }));
    try {
      const adapter = new MistralLlmAdapter({ apiKey: 'test-key' });
      await expect(adapter.complete({ system: 's', messages: [] })).rejects.toThrow(
        /empty completion/,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('agent LLM fallback', () => {
  class EmptyStore implements AgentStore {
    async createLoad(): Promise<never> {
      throw new Error('not used');
    }
    async rankMatches(): Promise<never> {
      throw new Error('not used');
    }
    async rankReturnLoads(): Promise<never> {
      throw new Error('not used');
    }
    async assignShipment(): Promise<never> {
      throw new Error('not used');
    }
    async requestFuelAdvance(): Promise<never> {
      throw new Error('not used');
    }
    async getTracking(): Promise<never> {
      throw new Error('not used');
    }
    async createInvoice(): Promise<never> {
      throw new Error('not used');
    }
    async findShipment(): Promise<undefined> {
      return undefined;
    }
    async findLatestShipment(): Promise<undefined> {
      return undefined;
    }
    async findLatestLoad(): Promise<undefined> {
      return undefined;
    }
    async getMetrics(): Promise<never> {
      throw new Error('not used');
    }
  }

  it('falls back to the deterministic reply when the LLM fails', async () => {
    const failingLlm: LlmAdapter = {
      complete: vi.fn().mockRejectedValue(new Error('Mistral API error 500')),
    };
    const agent = new DomesticAgent(new EmptyStore(), failingLlm);
    const result = await agent.handle('help');
    expect(result.intent).toBe('help');
    expect(result.reply).toContain('Domestic AI Agent');
    expect(result.reply).not.toMatch(/Mistral/);
  });

  it('uses the Mistral adapter end-to-end when it succeeds', async () => {
    vi.stubGlobal('fetch', fetchOk());
    try {
      const agent = new DomesticAgent(
        new EmptyStore(),
        new MistralLlmAdapter({ apiKey: 'test-key' }),
      );
      const result = await agent.handle('help');
      expect(result.reply).toBe('ጭነትዎ በተሳካ ሁኔታ ተመዝግቧል!');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
