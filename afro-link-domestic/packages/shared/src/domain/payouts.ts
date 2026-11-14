import { AdvanceChannel } from './types';

export interface PayoutRequest {
  advanceId: string;
  operatorId: string;
  amountEtb: number;
  phone: string;
  channel: AdvanceChannel;
}

export interface PayoutResult {
  success: boolean;
  reference?: string;
  error?: string;
}

export interface PayoutAdapter {
  disburse(request: PayoutRequest): Promise<PayoutResult>;
  recover(request: PayoutRequest): Promise<PayoutResult>;
}
