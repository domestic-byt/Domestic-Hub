import { AgentIntent } from './types';

const PATTERNS: Array<[AgentIntent, RegExp]> = [
  ['request_advance', /advance|fuel|telebirr|cbe\s*birr|ነዳጅ|ቅድመ\s*ክፍያ/i],
  ['track_shipment', /where|track|status|የት|ምን\s*ሁኔታ/i],
  ['create_invoice', /invoice|vat|ደረሰኝ/i],
  ['assign_truck', /assign|book|dispatch|ሹጥ|ቀጥር/i],
  ['find_matches', /match|truck|driver|carrier|available|መኪና|ሹፌር/i],
  ['post_load', /post|load|ship|cargo|ጫን|ላክ|ጭነት/i],
  ['help', /help|what can you|እርዳታ/i],
];

export function detectIntent(text: string): AgentIntent {
  for (const [intent, pattern] of PATTERNS) {
    if (pattern.test(text)) {
      return intent;
    }
  }
  return 'unknown';
}
