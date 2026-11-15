import { FuelAdvance, Load } from './types';

export const MAX_ADVANCE_SHARE_OF_LOAD = 0.2;

export type AdvanceAction = 'approve' | 'reject' | 'disburse' | 'recover' | 'default';

const TRANSITIONS: Record<FuelAdvance['status'], Partial<Record<AdvanceAction, FuelAdvance['status']>>> = {
  requested: { approve: 'approved', reject: 'rejected' },
  approved: { disburse: 'disbursed', reject: 'rejected' },
  disbursed: { recover: 'recovered', default: 'defaulted' },
  recovered: {},
  rejected: {},
  defaulted: {},
};

export function nextAdvanceStatus(
  current: FuelAdvance['status'],
  action: AdvanceAction,
): FuelAdvance['status'] | null {
  return TRANSITIONS[current][action] ?? null;
}

export function validateAdvanceRequest(input: {
  amountEtb: number;
  load: Load;
  activeAdvances: FuelAdvance[];
}): string[] {
  const errors: string[] = [];
  if (input.amountEtb <= 0) {
    errors.push('Advance amount must be positive.');
  }
  const maxEtb = input.load.offeredPriceEtb * MAX_ADVANCE_SHARE_OF_LOAD;
  if (input.amountEtb > maxEtb) {
    errors.push(
      `Advance exceeds the ${Math.round(MAX_ADVANCE_SHARE_OF_LOAD * 100)}% cap of the load price (max ${round2(maxEtb)} ETB).`,
    );
  }
  if (input.load.status !== 'assigned' && input.load.status !== 'delivered') {
    errors.push('Fuel advances require an assigned or delivered load.');
  }
  if (input.activeAdvances.some((a) => a.status === 'requested' || a.status === 'approved' || a.status === 'disbursed')) {
    errors.push('Operator already has an active fuel advance.');
  }
  return errors;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
