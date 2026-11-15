import {
  AdvanceChannel,
  PayoutAdapter,
  PayoutRequest,
  PayoutResult,
} from '@afro-link/shared';

export class SimulatedPayoutAdapter implements PayoutAdapter {
  constructor(
    private readonly channel: AdvanceChannel,
    private readonly failRate = 0,
  ) {}

  async disburse(request: PayoutRequest): Promise<PayoutResult> {
    return this.settle(request);
  }

  async recover(request: PayoutRequest): Promise<PayoutResult> {
    return this.settle(request);
  }

  private async settle(request: PayoutRequest): Promise<PayoutResult> {
    if (Math.random() < this.failRate) {
      return { success: false, error: `${this.channel} simulated outage` };
    }
    const prefix = this.channel === 'telebirr' ? 'TB' : 'CBE';
    return {
      success: true,
      reference: `${prefix}-SIM-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    };
  }
}

export function defaultPayoutAdapters(): Record<AdvanceChannel, PayoutAdapter> {
  return {
    telebirr: new SimulatedPayoutAdapter('telebirr'),
    cbe_birr: new SimulatedPayoutAdapter('cbe_birr'),
  };
}
