import { createHmac } from 'node:crypto';
import { DomainError, Webhook, WebhookDelivery, WebhookEvent } from '@afro-link/shared';
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

  async retry(deliveryId: string): Promise<WebhookDelivery> {
    const previous = await this.repo.getDelivery(deliveryId);
    if (!previous) {
      throw new DomainError('not_found', 'Delivery not found.');
    }
    const hooks = await this.repo.listWebhooks();
    const hook = hooks.find((h) => h.id === previous.webhookId);
    if (!hook) {
      throw new DomainError('not_found', 'The webhook for this delivery no longer exists.');
    }
    const payload = previous.payload as WebhookPayload;
    const delivery = await this.post(hook, payload, previous.attemptCount + 1);
    delivery.id = previous.id;
    if (previous.ok && !delivery.ok) {
      delivery.deliveredAt = previous.deliveredAt;
    }
    await this.repo.saveDelivery(delivery);
    return delivery;
  }

  private async deliver(hook: Webhook, payload: WebhookPayload): Promise<void> {
    const delivery = await this.post(hook, payload, 1);
    await this.repo.saveDelivery(delivery);
  }

  private async post(
    hook: Webhook,
    payload: WebhookPayload,
    attemptCount: number,
  ): Promise<WebhookDelivery> {
    const body = JSON.stringify(payload);
    const attemptedAt = new Date().toISOString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(hook.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-afro-link-event': payload.event,
          'x-afro-link-signature': signWebhook(hook.secret, body),
        },
        body,
        signal: controller.signal,
      });
      return {
        id: crypto.randomUUID(),
        webhookId: hook.id,
        event: payload.event,
        url: hook.url,
        ok: response.ok,
        statusCode: response.status,
        attemptCount,
        attemptedAt,
        deliveredAt: response.ok ? new Date().toISOString() : undefined,
        payload,
      };
    } catch (err) {
      return {
        id: crypto.randomUUID(),
        webhookId: hook.id,
        event: payload.event,
        url: hook.url,
        ok: false,
        error: controller.signal.aborted
          ? `timeout after ${this.timeoutMs}ms`
          : err instanceof Error
            ? err.message
            : String(err),
        attemptCount,
        attemptedAt,
        payload,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
