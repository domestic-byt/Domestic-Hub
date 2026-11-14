import { createHmac } from 'node:crypto';
import { Webhook, WebhookEvent } from '@afro-link/shared';
import type { MarketplaceRepo } from './repo';

export interface WebhookPayload {
  event: WebhookEvent;
  at: string;
  data: unknown;
}

export function signWebhook(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

export class WebhookDispatcher {
  constructor(
    private readonly repo: MarketplaceRepo,
    private readonly timeoutMs = 5000,
  ) {}

  async dispatch(event: WebhookEvent, data: unknown): Promise<void> {
    const hooks = await this.repo.listWebhooks();
    const payload: WebhookPayload = { event, at: new Date().toISOString(), data };
    const targets = hooks.filter((h) => h.events.length === 0 || h.events.includes(event));
    await Promise.allSettled(targets.map((hook) => this.deliver(hook, payload)));
  }

  private async deliver(hook: Webhook, payload: WebhookPayload): Promise<void> {
    const body = JSON.stringify(payload);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      await fetch(hook.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-afro-link-event': payload.event,
          'x-afro-link-signature': signWebhook(hook.secret, body),
        },
        body,
        signal: controller.signal,
      });
    } catch {
      return;
    } finally {
      clearTimeout(timer);
    }
  }
}
