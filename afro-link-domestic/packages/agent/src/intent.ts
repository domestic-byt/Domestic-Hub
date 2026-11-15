import { AgentIntent } from './types';

const PATTERNS: Array<[AgentIntent, RegExp]> = [
  [
    'get_metrics',
    /metrics|kpis?|dashboard|business\s*(?:report|overview)|report|ሪፖርት|ግምገማ|lakkoofsa|tirakoob|ሕበረታ|vipimo/i,
  ],
  [
    'submit_kyc_docs',
    /\bsubmit\b|\bdocuments?\b|\bdocs?\b|licen[cs]e|insurance|\u1230\u1266\u12f5|\u1348\u1245\u12eb\u12f5|galmee|gazexxee|dukumenti|dukhumentiyada|hati|leseni/i,
  ],
  [
    'review_kyc',
    /\bkyc\b|approv(?:e|al)|\breject(?:ed|ion)?\b|\bverify\b|verification\s*(?:queue|status)?|\u130d\u121d\u130c\u121b|\u12a0\u133d\u12f5\u1245|\u12cd\u12f5\u1245|qormata|hayyami|dib-u-eegis|ansaxi|\u121d\u122d\u1218\u122b|\u12a3\u1338\u12f5\u1245|ukaguzi|idhinisha/i,
  ],
  [
    'advance_status',
    /\badvances?\s+status\b|\bstatus\s+of\s+(?:my\s+)?advances?\b|\bmy\s+advances?\b|advance\s+history|payout\s+status|ቅድሚ.*ሁኔታ|ሁኔታ.*ቅድሚ|haala\s*kaffaltii|kaffaltii\s*kootii|xaalada\s*malipo|malipo\s*yangu|hali\s*ya\s*malipo/i,
  ],
  [
    'request_advance',
    /advance|fuel|telebirr|cbe\s*birr|ነዳጅ|ቅድሚ\s*ካፍያ|kaffaltii|gaadhin|ቅድሚ\s*ክፍሊት|malipo\s*ya\s*mbele|mafuta/i,
  ],
  [
    'track_shipment',
    /where|track|status|የት|መን\s*ሁኔታ|hordoffii|hordi|raadraac|ክትታል|ክትትል|fuatilia|ufuatiliaji/i,
  ],
  [
    'capture_pod',
    /proof\s*of\s*delivery|\bpod\b|receiver|confirm\s+(?:the\s+)?delivery|ማረጋገጫ|ምርግጋዕ|mirkaneessa|ragaa|caddeeyn|uthibitisho|thibitisha/i,
  ],
  [
    'rate_shipment',
    /\brate\b|\brated\b|rating|\bstars?\b|⭐|ደረጃ|ኮከብ|kabaja|qiimeyn|nyota|kadirio|piga/i,
  ],
  ['cancel_load', /cancel|call\s*off|ሰርዝ|ተሰርዝ|haqi|jooji|ስረዝ|ghairi/i],
  [
    'earnings',
    /earnings|income|how\s*much.*(earn|paid|make)|payout\s*history|ገቢ|galii|dakhliga|ወሰኽ|mapato/i,
  ],
  [
    'list_invoices',
    /\bmy\s+invoices?\b|\blist\s+invoices?\b|\bshow\s+(?:my\s+)?invoices?\b|\binvoices?\s+(?:list|history)\b|faktuurada|faktuuradayda|faktura\s*zangu|faktoorota|ደረሰኞች|ዝርዝር\s*ደረሰኝ/i,
  ],
  ['create_invoice', /invoice|vat|ደረሰኝ|faktuur|ankara/i],
  ['assign_truck', /assign|book|dispatch|መድብ|ቆጣሪ|ramadi|ku\s*xidh|ምድብ|panga/i],
  [
    'find_return_loads',
    /return\s*loads?|backhaul|empty\s*(?:return|trip)|መማልድ|ደግር\s*መመልድ|imala\s*deebii|safarada\s*celiska|ተመላሺ|safari\s*za\s*kurudi/i,
  ],
  [
    'find_matches',
    /match|truck|driver|carrier|available|መካና|ሰፈራ|konkobaataa|babuur|መካይን|malori|dereva/i,
  ],
  ['price_suggestion', /price|pricing|how\s*much.*charge|ዋጋ|በዕሊ|gatii|qiimo|qiimah|bei/i],
  [
    'export_transcript',
    /transcript|send\s+(?:me\s+)?(?:this|the)\s+conversation|conversation\s+(?:log|history|export)|ውይት|sheeko|wadaahadal|mazungumzo/i,
  ],
  [
    'accept_offer',
    /\baccept\s+(?:the\s+)?(?:counter\s+)?(?:offer|price)\b|\boffer\s+accepted\b|\bagree\b|ተቀበል|fudhaa|aqbal|kubali/i,
  ],
  [
    'counter_offer',
    /\bcounter[\s-]?offs?er?\b|\bcounter\b|\bbid\b|\boffer\b|\bgive\s+\d+|ጌላ\s*ዋጋ|gatii\s*haaraa|qiimo\s*cusub|bei\s*nyingine/i,
  ],
  [
    'post_load',
    /post|load|ship|cargo|ጭን|ላክ|ጭነት|fe'aa|dhiyeessi|rarka|shub|mzigo|weka/i,
  ],
  ['help', /help|what can you|እርዳታ|gargaarsa|caawimo|ሓገዝ|msaada/i],
];

export function detectIntent(text: string): AgentIntent {
  for (const [intent, pattern] of PATTERNS) {
    if (pattern.test(text)) {
      return intent;
    }
  }
  return 'unknown';
}
