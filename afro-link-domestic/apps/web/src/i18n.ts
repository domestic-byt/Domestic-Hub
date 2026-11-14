export type Lang = 'en' | 'am';

const EN = {
  tagline: "Ethiopia's AI-powered freight marketplace · part of DomesticHub",
  tokenPlaceholder: 'DomesticHub SSO token (optional)',
  signedIn: 'signed in',
  guestMode: 'guest mode',
  tabShipper: 'Shipper',
  tabDriver: 'Driver',
  tabTrack: 'Tracking',
  tabAgent: 'AI Agent',
  postLoad: 'Post a load',
  shipperId: 'Shipper ID',
  from: 'From',
  to: 'To',
  tons: 'Tons',
  price: 'Price (ETB)',
  postLoadBtn: 'Post load',
  loads: 'Loads',
  noLoads: 'No loads yet.',
  findMatches: 'Find matches',
  assignTopMatch: 'Assign top match',
  noTrucks: 'No available trucks for this load.',
  registerTruck: 'Register truck',
  name: 'Name',
  phone: 'Phone',
  plate: 'Plate',
  capacity: 'Capacity (t)',
  currentCity: 'Current city',
  registerBtn: 'Register',
  fuelAdvance: 'Fuel advance',
  operatorId: 'Operator ID',
  shipmentId: 'Shipment ID',
  amount: 'Amount (ETB)',
  channel: 'Channel',
  requestBtn: 'Request',
  advances: 'Advances',
  noAdvances: 'No advances yet.',
  approve: 'Approve',
  reject: 'Reject',
  disburse: 'Disburse',
  markRecovered: 'Mark recovered',
  liveTracking: 'Live tracking',
  trackBtn: 'Track',
  agentHeading: 'Domestic AI Agent',
  agentPlaceholder: 'Post a load, find trucks, request a fuel advance…',
  send: 'Send',
  mic: 'Voice input',
  listening: 'Listening…',
  voiceUnsupported: 'Voice input is not supported in this browser.',
  greeting:
    'Selam! I am the Domestic AI Agent. Try: "Post 20 tons of coffee from Jimma to Addis Ababa for 40000 birr"',
} as const;

const AM: Record<keyof typeof EN, string> = {
  tagline: 'የኢትዮጵያ የተግቢ የጭነት ገበያ · በDomesticHub ውስጥ',
  tokenPlaceholder: 'የDomesticHub SSO ቶከን (አማራጭ)',
  signedIn: 'ገብተዋል',
  guestMode: 'እንግዳ',
  tabShipper: 'አከራቢ',
  tabDriver: 'ሹፌር',
  tabTrack: 'ክትትል',
  tabAgent: 'AI ወኪል',
  postLoad: 'ጭነት ያስገቡ',
  shipperId: 'የአከራቢ መለያ',
  from: 'ከ',
  to: 'ወደ',
  tons: 'ቶን',
  price: 'ዋጋ (ETB)',
  postLoadBtn: 'ጭነት ያስገቡ',
  loads: 'ጭነቶች',
  noLoads: 'እስካሁን ምንም ጭነት የለም።',
  findMatches: 'ተሽከርካሪዎችን ፈልግ',
  assignTopMatch: 'የመጀመሪያውን አስመድቅ',
  noTrucks: 'ለዚህ ጭነት ክፍት ተሽከርካሪ የለም።',
  registerTruck: 'መኪና ያስመዝግቡ',
  name: 'ስም',
  phone: 'ስልክ',
  plate: 'ታሪፍ ቁጥር',
  capacity: 'አቅም (ቶን)',
  currentCity: 'የአሁን ከተማ',
  registerBtn: 'ተመዝገብ',
  fuelAdvance: 'የነዳጅ አስቀድሞ ክፍያ',
  operatorId: 'የሹፌር መለያ',
  shipmentId: 'የላኪነት መለያ',
  amount: 'መጠን (ETB)',
  channel: 'ቻናል',
  requestBtn: 'ጠይቅ',
  advances: 'የነዳጅ ጥያቄዎች',
  noAdvances: 'እስካሁን ምንም ጥያቄ የለም።',
  approve: 'አጽድቅ',
  reject: 'አትቀበል',
  disburse: 'ክፈል',
  markRecovered: 'እንደተመለሰ ምልክት',
  liveTracking: 'ቀጥታ ክትትል',
  trackBtn: 'ተከታተል',
  agentHeading: 'የዶምስቲክ AI ወኪል',
  agentPlaceholder: 'ጭነት ያስገቡ፣ ተሽከርካሪዎችን ይፈልጉ፣ የነዳጅ ድጋፍ ይጠይቁ…',
  send: 'ላክ',
  mic: 'በድምፅ ይናገሩ',
  listening: 'እየሰማሁ ነው…',
  voiceUnsupported: 'በዚህ አሳሽ ድምፅ አይደገፍም።',
  greeting: 'ሰላም! የዶምስቲክ AI ወኪል ነኝ። ለምሳሌ፦ "20 ቶን ቡና ከጅማ ወደ አዲስ አበባ ለ40000 ብር ላክ"',
};

export const STRINGS: Record<Lang, Record<keyof typeof EN, string>> = { en: EN, am: AM };

export type Strings = Record<keyof typeof EN, string>;

const LANG_KEY = 'afrolink.lang';

export function loadLang(): Lang {
  if (typeof localStorage !== 'undefined' && localStorage.getItem(LANG_KEY) === 'am') return 'am';
  return 'en';
}

export function saveLang(lang: Lang): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(LANG_KEY, lang);
}
