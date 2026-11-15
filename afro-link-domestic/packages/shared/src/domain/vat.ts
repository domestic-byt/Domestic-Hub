export const ETHIOPIAN_VAT_RATE = 0.15;

export interface VatBreakdown {
  subtotalEtb: number;
  vatEtb: number;
  totalEtb: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function computeVat(subtotalEtb: number): VatBreakdown {
  const vatEtb = round2(subtotalEtb * ETHIOPIAN_VAT_RATE);
  return {
    subtotalEtb: round2(subtotalEtb),
    vatEtb,
    totalEtb: round2(subtotalEtb + vatEtb),
  };
}
