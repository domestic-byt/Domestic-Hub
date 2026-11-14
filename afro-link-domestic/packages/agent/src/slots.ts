import { AdvanceChannel, City, findCitiesInText } from '@afro-link/shared';

export interface Slots {
  cities: City[];
  weightTons?: number;
  moneyEtb?: number;
  channel?: AdvanceChannel;
  ids: string[];
}

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

export function extractSlots(text: string): Slots {
  const ids = [...text.matchAll(UUID_PATTERN)].map((m) => m[0]);

  const weightMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:tons?|tonnes?|\bt\b)/i);
  const weightTons = weightMatch ? Number(weightMatch[1]) : undefined;

  const moneyMatch = text.match(/([\d,]+)\s*(?:etb|birr|\bbr\b)/i);
  const moneyEtb = moneyMatch?.[1] ? Number(moneyMatch[1].replace(/,/g, '')) : undefined;

  let channel: AdvanceChannel | undefined;
  if (/telebirr/i.test(text)) {
    channel = 'telebirr';
  } else if (/cbe[\s-]*birr|\bcbe\b/i.test(text)) {
    channel = 'cbe_birr';
  }

  return { cities: findCitiesInText(text), weightTons, moneyEtb, channel, ids };
}
