import { DomainError } from '@afro-link/shared';
import { detectIntent } from './intent';
import { extractSlots } from './slots';
import {
  AgentContext,
  AgentIntent,
  AgentResult,
  AgentStore,
  LlmAdapter,
} from './types';

const HELP_TEXT = [
  'I am the Domestic AI Agent for Afro-Link Domestic. I can:',
  '- Post a load: "Post 20 tons of coffee from Jimma to Addis Ababa for 40000 birr"',
  '- Find trucks: "find trucks for <load id>"',
  '- Assign a carrier: "assign the top match for <load id>"',
  '- Fuel advances: "request an 8000 birr telebirr advance" (Telebirr or CBE Birr)',
  '- Track: "where is my shipment <id>?"',
  '- Invoices: "issue the VAT invoice" (15% Ethiopian VAT)',
].join('\n');

const UNKNOWN_TEXT = "I didn't catch that. " + HELP_TEXT;

export class DomesticAgent {
  constructor(
    private readonly store: AgentStore,
    private readonly llm?: LlmAdapter,
  ) {}

  async handle(message: string, ctx: AgentContext = {}): Promise<AgentResult> {
    const intent = detectIntent(message);
    const outcome = await this.execute(intent, message, ctx);
    let reply = outcome.reply;
    if (this.llm) {
      try {
        reply = await this.llm.complete({
          system: this.systemPrompt(intent, outcome.data),
          messages: [{ role: 'user', content: message }],
        });
      } catch {
        reply = outcome.reply;
      }
    }
    return { intent, reply, data: outcome.data };
  }

  private async execute(
    intent: AgentIntent,
    message: string,
    ctx: AgentContext,
  ): Promise<{ reply: string; data?: unknown }> {
    try {
      switch (intent) {
        case 'post_load':
          return await this.postLoad(message, ctx);
        case 'find_matches':
          return await this.findMatches(message);
        case 'assign_truck':
          return await this.assignTruck(message);
        case 'request_advance':
          return await this.requestAdvance(message, ctx);
        case 'track_shipment':
          return await this.trackShipment(message);
        case 'create_invoice':
          return await this.createInvoice(message, ctx);
        case 'help':
          return { reply: HELP_TEXT };
        default:
          return { reply: UNKNOWN_TEXT };
      }
    } catch (err) {
      if (err instanceof DomainError) {
        return { reply: `⚠️ ${err.message}` };
      }
      throw err;
    }
  }

  private async postLoad(message: string, ctx: AgentContext) {
    const slots = extractSlots(message);
    const [origin, destination] = slots.cities;
    if (!origin || !destination || !slots.weightTons || !slots.moneyEtb) {
      return {
        reply:
          'I can post that load. Please include origin, destination, weight in tons and price in birr — e.g. "Post 20 tons of coffee from Jimma to Addis Ababa for 40000 birr".',
      };
    }
    const load = await this.store.createLoad({
      shipperId: ctx.shipperId ?? 'guest',
      origin,
      destination,
      weightTons: slots.weightTons,
      offeredPriceEtb: slots.moneyEtb,
    });
    return {
      reply: `Load ${load.id} posted: ${load.weightTons} t from ${load.origin.name} to ${load.destination.name} at ${load.offeredPriceEtb} ETB. Say "find trucks for ${load.id}" to see ranked carriers.`,
      data: load,
    };
  }

  private async findMatches(message: string) {
    const slots = extractSlots(message);
    const loadId = slots.ids[0] ?? (await this.store.findLatestLoad())?.id;
    if (!loadId) {
      return {
        reply:
          'Which load? Share the load id, or post one first — e.g. "Post 20 tons from Jimma to Addis Ababa for 40000 birr".',
      };
    }
    const matches = await this.store.rankMatches(loadId);
    if (matches.length === 0) {
      return {
        reply: `No available trucks can carry load ${loadId} right now.`,
        data: [],
      };
    }
    const top = matches
      .slice(0, 3)
      .map(
        (m, i) =>
          `${i + 1}. ${m.operatorName} (${m.operatorId}) — score ${m.score}, ${m.deadheadKm} km deadhead${m.reasons.length ? ` (${m.reasons.join('; ')})` : ''}`,
      )
      .join('\n');
    return {
      reply: `Top matches for load ${loadId}:\n${top}\nSay "assign the top match for ${loadId}" to book.`,
      data: matches,
    };
  }

  private async assignTruck(message: string) {
    const slots = extractSlots(message);
    const loadId = slots.ids[0] ?? (await this.store.findLatestLoad())?.id;
    if (!loadId) {
      return {
        reply:
          'Which load should I assign? Share the load id, or run "find trucks" first.',
      };
    }
    const operatorId =
      slots.ids[1] ?? (await this.store.rankMatches(loadId))[0]?.operatorId;
    if (!operatorId) {
      return { reply: `No available trucks for load ${loadId}.` };
    }
    const shipment = await this.store.assignShipment(loadId, operatorId);
    return {
      reply: `Shipment ${shipment.id} assigned: load ${loadId} → operator ${operatorId}. The driver can now request a fuel advance, e.g. "request an 8000 birr telebirr advance".`,
      data: shipment,
    };
  }

  private async requestAdvance(message: string, ctx: AgentContext) {
    const slots = extractSlots(message);
    const shipment = slots.ids[0]
      ? await this.store.findShipment(slots.ids[0])
      : await this.store.findLatestShipment();
    if (!shipment) {
      return {
        reply: 'Which shipment is the advance for? Share the shipment id.',
      };
    }
    if (!slots.moneyEtb) {
      return {
        reply:
          'How much fuel advance? Example: "request an 8000 birr telebirr advance".',
      };
    }
    const advance = await this.store.requestFuelAdvance({
      operatorId: ctx.operatorId ?? shipment.operatorId,
      shipmentId: shipment.id,
      amountEtb: slots.moneyEtb,
      channel: slots.channel ?? 'telebirr',
    });
    return {
      reply: `Fuel advance of ${advance.amountEtb} ETB requested via ${advance.channel} (status: ${advance.status}). It needs approval before disbursement.`,
      data: advance,
    };
  }

  private async trackShipment(message: string) {
    const slots = extractSlots(message);
    const shipment = slots.ids[0]
      ? await this.store.findShipment(slots.ids[0])
      : await this.store.findLatestShipment();
    if (!shipment) {
      return {
        reply: 'Which shipment? Share the shipment id, or assign a load first.',
      };
    }
    const events = await this.store.getTracking(shipment.id);
    if (events.length === 0) {
      return {
        reply: `No tracking events yet for shipment ${shipment.id}.`,
        data: [],
      };
    }
    const timeline = events
      .map(
        (e) =>
          `- ${e.at} ${e.kind}${e.location ? ` @ ${e.location.name}` : ''}${e.note ? ` — ${e.note}` : ''}`,
      )
      .join('\n');
    return {
      reply: `Tracking for shipment ${shipment.id} (status: ${shipment.status}):\n${timeline}`,
      data: events,
    };
  }

  private async createInvoice(message: string, ctx: AgentContext) {
    const slots = extractSlots(message);
    const shipment = slots.ids[0]
      ? await this.store.findShipment(slots.ids[0])
      : await this.store.findLatestShipment();
    if (!shipment) {
      return {
        reply: 'Which shipment should I invoice? Share the shipment id.',
      };
    }
    const invoice = await this.store.createInvoice({
      shipmentId: shipment.id,
      shipperTin: ctx.shipperTin ?? 'PENDING',
      operatorTin: ctx.operatorTin ?? 'PENDING',
    });
    return {
      reply: `VAT invoice ${invoice.id}: subtotal ${invoice.subtotalEtb} ETB + VAT ${invoice.vatEtb} ETB = ${invoice.totalEtb} ETB.`,
      data: invoice,
    };
  }

  private systemPrompt(intent: AgentIntent, data: unknown): string {
    return [
      'You are the Domestic AI Agent for Afro-Link Domestic, an Ethiopian freight marketplace inside DomesticHub.',
      'A deterministic tool already executed the user request.',
      `Intent: ${intent}.`,
      `Structured result JSON: ${JSON.stringify(data ?? null)}`,
      'Write a short, friendly reply in English or Amharic presenting the result. Never invent ids, prices, or statuses.',
    ].join('\n');
  }
}
