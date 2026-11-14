import { DomainError, KycDecision } from '@afro-link/shared';
import { detectIntent } from './intent';
import { AgentMemory, AgentMemoryState, InMemoryAgentMemory } from './memory';
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
  '- Metrics: "show me the business report"',
  '- Cancel: "cancel load <id>"',
  '- Earnings: "how much have I earned?"',
  '- Pricing: "what price for 20 tons from Jimma to Addis Ababa?"',
  '- Proof of delivery: "confirm delivery received by <name>"',
  '- Rate a delivery: "rate 5 stars"',
  '- KYC review (admin): "show KYC queue", "approve operator <id>"',
].join('\n');

const UNKNOWN_TEXT = "I didn't catch that. " + HELP_TEXT;

export class DomesticAgent {
  constructor(
    private readonly store: AgentStore,
    private readonly llm?: LlmAdapter,
    private readonly memory: AgentMemory = new InMemoryAgentMemory(),
  ) {}

  async handle(message: string, ctx: AgentContext = {}): Promise<AgentResult> {
    const intent = detectIntent(message);
    const sessionKey = ctx.sessionKey ?? ctx.shipperId ?? ctx.operatorId ?? 'guest';
    const memory = (await this.memory.get(sessionKey)) ?? {};
    const outcome = await this.execute(intent, message, ctx, memory);
    await this.memory.set(sessionKey, memory);
    let reply = outcome.reply;
    if (this.llm) {
      try {
        reply = await this.llm.complete({
          system: this.systemPrompt(intent, outcome.data, ctx.lang),
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
    memory: AgentMemoryState,
  ): Promise<{ reply: string; data?: unknown }> {
    try {
      switch (intent) {
        case 'post_load':
          return await this.postLoad(message, ctx, memory);
        case 'find_matches':
          return await this.findMatches(message, memory);
        case 'find_return_loads':
          return await this.findReturnLoads(message, ctx, memory);
        case 'assign_truck':
          return await this.assignTruck(message, memory);
        case 'request_advance':
          return await this.requestAdvance(message, ctx, memory);
        case 'track_shipment':
          return await this.trackShipment(message, memory);
        case 'create_invoice':
          return await this.createInvoice(message, ctx, memory);
        case 'get_metrics':
          return await this.reportMetrics();
        case 'cancel_load':
          return await this.cancelLoad(message, memory);
        case 'capture_pod':
          return await this.capturePod(message, memory);
        case 'rate_shipment':
          return await this.rateShipment(message, ctx, memory);
        case 'earnings':
          return await this.reportEarnings(message, ctx, memory);
        case 'review_kyc':
          return await this.reviewKyc(message, ctx, memory);
        case 'price_suggestion':
          return await this.suggestPricing(message, memory);
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

  private async postLoad(message: string, ctx: AgentContext, memory: AgentMemoryState) {
    const slots = extractSlots(message);
    const [origin, destination] = slots.cities;
    const merged = {
      origin: origin ?? memory.lastOrigin,
      destination: destination ?? memory.lastDestination,
      weightTons: slots.weightTons ?? memory.lastWeightTons,
      moneyEtb: slots.moneyEtb ?? memory.lastMoneyEtb,
    };
    if (!merged.origin || !merged.destination || !merged.weightTons || !merged.moneyEtb) {
      return {
        reply:
          'I can post that load. Please include origin, destination, weight in tons and price in birr — e.g. "Post 20 tons of coffee from Jimma to Addis Ababa for 40000 birr".',
      };
    }
    const load = await this.store.createLoad({
      shipperId: ctx.shipperId ?? 'guest',
      origin: merged.origin,
      destination: merged.destination,
      weightTons: merged.weightTons,
      offeredPriceEtb: merged.moneyEtb,
    });
    memory.lastLoadId = load.id;
    memory.lastOrigin = merged.origin;
    memory.lastDestination = merged.destination;
    memory.lastWeightTons = merged.weightTons;
    memory.lastMoneyEtb = merged.moneyEtb;
    return {
      reply: `Load ${load.id} posted: ${load.weightTons} t from ${load.origin.name} to ${load.destination.name} at ${load.offeredPriceEtb} ETB. Say "find trucks for ${load.id}" to see ranked carriers.`,
      data: load,
    };
  }

  private async findMatches(message: string, memory: AgentMemoryState) {
    const slots = extractSlots(message);
    const loadId = slots.ids[0] ?? memory.lastLoadId ?? (await this.store.findLatestLoad())?.id;
    if (!loadId) {
      return {
        reply:
          'Which load? Share the load id, or post one first — e.g. "Post 20 tons from Jimma to Addis Ababa for 40000 birr".',
      };
    }
    memory.lastLoadId = loadId;
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

  private async findReturnLoads(message: string, ctx: AgentContext, memory: AgentMemoryState) {
    const slots = extractSlots(message);
    const operatorId =
      slots.ids[0] ??
      ctx.operatorId ??
      memory.lastOperatorId ??
      (await this.store.findLatestShipment())?.operatorId;
    if (!operatorId) {
      return {
        reply:
          'Which truck? Share the operator id, or finish assigning a shipment first — I will then look for loads near your current location.',
      };
    }
    const matches = await this.store.rankReturnLoads(operatorId);
    if (matches.length === 0) {
      return {
        reply: `No open loads near your current location yet, operator ${operatorId}. I will flag return trips as soon as shippers post one.`,
        data: [],
      };
    }
    const top = matches[0]!;
    const list = matches
      .slice(0, 3)
      .map(
        (m) =>
          `${m.weightTons} t ${m.origin}→${m.destination} for ${m.offeredPriceEtb} ETB (${m.deadheadKm} km deadhead)`,
      )
      .join('; ');
    return {
      reply: `${matches.length} return load${matches.length === 1 ? '' : 's'} for operator ${operatorId}. Best: load ${top.loadId} — ${list}. Say "assign the top match for ${top.loadId}" to book it.`,
      data: matches,
    };
  }

  private async assignTruck(message: string, memory: AgentMemoryState) {
    const slots = extractSlots(message);
    const loadId = slots.ids[0] ?? memory.lastLoadId ?? (await this.store.findLatestLoad())?.id;
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
    memory.lastLoadId = loadId;
    memory.lastShipmentId = shipment.id;
    memory.lastOperatorId = operatorId;
    return {
      reply: `Shipment ${shipment.id} assigned: load ${loadId} → operator ${operatorId}. The driver can now request a fuel advance, e.g. "request an 8000 birr telebirr advance".`,
      data: shipment,
    };
  }

  private async requestAdvance(message: string, ctx: AgentContext, memory: AgentMemoryState) {
    const slots = extractSlots(message);
    const shipment = slots.ids[0]
      ? await this.store.findShipment(slots.ids[0])
      : memory.lastShipmentId
        ? await this.store.findShipment(memory.lastShipmentId)
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
      channel: slots.channel ?? memory.lastChannel ?? 'telebirr',
    });
    memory.lastShipmentId = shipment.id;
    memory.lastOperatorId = advance.operatorId;
    memory.lastMoneyEtb = slots.moneyEtb;
    memory.lastChannel = advance.channel;
    return {
      reply: `Fuel advance of ${advance.amountEtb} ETB requested via ${advance.channel} (status: ${advance.status}). It needs approval before disbursement.`,
      data: advance,
    };
  }

  private async trackShipment(message: string, memory: AgentMemoryState) {
    const slots = extractSlots(message);
    const shipment = slots.ids[0]
      ? await this.store.findShipment(slots.ids[0])
      : memory.lastShipmentId
        ? await this.store.findShipment(memory.lastShipmentId)
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

  private async createInvoice(message: string, ctx: AgentContext, memory: AgentMemoryState) {
    const slots = extractSlots(message);
    const shipment = slots.ids[0]
      ? await this.store.findShipment(slots.ids[0])
      : memory.lastShipmentId
        ? await this.store.findShipment(memory.lastShipmentId)
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
    memory.lastShipmentId = shipment.id;
    return {
      reply: `VAT invoice ${invoice.id}: subtotal ${invoice.subtotalEtb} ETB + VAT ${invoice.vatEtb} ETB = ${invoice.totalEtb} ETB.`,
      data: invoice,
    };
  }

  private async cancelLoad(message: string, memory: AgentMemoryState) {
    const slots = extractSlots(message);
    const loadId = slots.ids[0] ?? memory.lastLoadId;
    if (!loadId) {
      return {
        reply: 'Which load should I cancel? Share the load id, or post one first.',
      };
    }
    const load = await this.store.cancelLoad(loadId);
    memory.lastLoadId = load.id;
    return {
      reply: `Load ${load.id} cancelled. The truck is free again and can take return loads near its current location.`,
      data: load,
    };
  }

  private async capturePod(message: string, memory: AgentMemoryState) {
    const slots = extractSlots(message);
    const shipmentId =
      slots.ids[0] ?? memory.lastShipmentId ?? (await this.store.findLatestShipment())?.id;
    if (!shipmentId) {
      return {
        reply:
          'Which shipment? Share the shipment id, or track one first \u2014 e.g. "where is my shipment <id>".',
      };
    }
    const nameMatch = /(?:received\s+by|by)\s+([A-Za-z][A-Za-z\s'.-]{1,40})/i.exec(message);
    const receiverName = nameMatch?.[1]?.trim();
    if (!receiverName) {
      return {
        reply:
          'Who received the cargo? Include the receiver name \u2014 e.g. "confirm delivery received by Abebe Kebede".',
      };
    }
    const shipment = await this.store.capturePod(shipmentId, receiverName);
    memory.lastShipmentId = shipment.id;
    return {
      reply: `Proof of delivery recorded for shipment ${shipment.id} \u2014 received by ${receiverName}.`,
      data: shipment,
    };
  }

  private async rateShipment(
    message: string,
    ctx: AgentContext,
    memory: AgentMemoryState,
  ) {
    const slots = extractSlots(message);
    const shipmentId =
      slots.ids[0] ?? memory.lastShipmentId ?? (await this.store.findLatestShipment())?.id;
    if (!shipmentId) {
      return {
        reply:
          'Which shipment? Share the shipment id, or track one first \u2014 e.g. "where is my shipment <id>".',
      };
    }
    const starsMatch = /(?:^|\s)([1-5])\s*(?:stars?|\u2b50|\u12ae\u12a8\u1265|nyota)/i.exec(message);
    const stars = starsMatch ? Number(starsMatch[1]) : undefined;
    if (!stars) {
      return {
        reply:
          'How many stars (1\u20135)? Include them \u2014 e.g. "rate 5 stars for <shipment id>".',
      };
    }
    const rating = await this.store.rateShipment({
      shipmentId,
      shipperId: ctx.shipperId ?? 'guest',
      stars,
    });
    memory.lastShipmentId = rating.shipmentId;
    return {
      reply: `Rated ${rating.stars} star(s) for shipment ${rating.shipmentId}. Thank you \u2014 ratings help shippers pick reliable trucks.`,
      data: rating,
    };
  }

  private async suggestPricing(message: string, memory: AgentMemoryState) {
    const slots = extractSlots(message);
    const [origin, destination] = slots.cities;
    const merged = {
      origin: origin ?? memory.lastOrigin,
      destination: destination ?? memory.lastDestination,
      weightTons: slots.weightTons ?? memory.lastWeightTons,
    };
    if (!merged.origin || !merged.destination || !merged.weightTons) {
      return {
        reply:
          'I can suggest a market price. Tell me the lane and weight — e.g. "what price for 20 tons from Jimma to Addis Ababa?"',
      };
    }
    const suggestion = await this.store.suggestLanePrice({
      origin: merged.origin,
      destination: merged.destination,
      weightTons: merged.weightTons,
    });
    if (!suggestion) {
      return {
        reply: `No delivered loads on record yet, so I cannot benchmark ${merged.origin.name} → ${merged.destination.name}. Post the load at your best estimate and I will learn from deliveries.`,
        data: null,
      };
    }
    return {
      reply: `Suggested price for ${merged.weightTons} t ${merged.origin.name} → ${merged.destination.name} (${suggestion.distanceKm} km): ${suggestion.suggestedEtb} ETB (range ${suggestion.lowEtb}–${suggestion.highEtb}, ${suggestion.etbPerTonKm} ETB/t·km from ${suggestion.sampleSize} ${suggestion.basis} deliveries). Say "post ${merged.weightTons} tons from ${merged.origin.name} to ${merged.destination.name} for ${suggestion.suggestedEtb} birr" to list it.`,
      data: suggestion,
    };
  }

  private async reportEarnings(message: string, ctx: AgentContext, memory: AgentMemoryState) {
    const slots = extractSlots(message);
    const operatorId =
      slots.ids[0] ??
      ctx.operatorId ??
      memory.lastOperatorId ??
      (await this.store.findLatestShipment())?.operatorId;
    if (!operatorId) {
      return {
        reply:
          'Which truck? Share the operator id, or finish assigning a shipment first.',
      };
    }
    const earnings = await this.store.getEarnings(operatorId);
    return {
      reply: `Earnings for ${earnings.operatorName} (${operatorId}): ${earnings.deliveredShipments} delivered shipment${earnings.deliveredShipments === 1 ? '' : 's'} worth ${earnings.grossEtb} ETB, ${earnings.outstandingAdvanceEtb} ETB in outstanding fuel advances, net ${earnings.netEtb} ETB.`,
      data: earnings,
    };
  }

  private async reviewKyc(message: string, ctx: AgentContext, memory: AgentMemoryState) {
    if (!ctx.admin) {
      return {
        reply: '⚠️ KYC review is available to admins only. Sign in with an admin token.',
      };
    }
    const approveRe = /\bapprov(?:e|al)\b|\baccept\b|አጽድቅ|hayyami|ansaxi|idhinisha/i;
    const rejectRe = /\breject\b|\bdeny\b|ውድቅ|\bdidi\b|\bdiid\b|kataa/i;
    const decision: KycDecision | undefined = approveRe.test(message)
      ? 'approved'
      : rejectRe.test(message)
        ? 'rejected'
        : undefined;
    const { ids } = extractSlots(message);
    const shortId = message.match(/operator\s+([A-Za-z0-9][A-Za-z0-9-]*)/i)?.[1];
    const operatorId =
      ids[0] ?? (shortId && shortId.toLowerCase() !== 'id' ? shortId : memory.lastOperatorId);
    if (decision && operatorId) {
      const operator = await this.store.reviewKyc({ operatorId, decision });
      memory.lastOperatorId = operator.id;
      return {
        reply:
          decision === 'approved'
            ? `✅ Operator ${operator.name} (${operator.id}) KYC approved.`
            : `⛔ Operator ${operator.name} (${operator.id}) KYC rejected — hidden from matches and blocked from assignment.`,
        data: operator,
      };
    }
    if (decision) {
      return {
        reply: 'Which operator? Give the operator id, e.g. "approve operator <id>".',
      };
    }
    const queue = await this.store.kycReviewQueue();
    const top = queue.slice(0, 5);
    const lines = top.map((r) => {
      const issues = r.issues.length > 0 ? ` — ${r.issues.join('; ')}` : '';
      return `- ${r.operatorName} (${r.operatorId}) · ${r.status} · decision: ${r.decision}${issues}`;
    });
    return {
      reply: [
        `🛡️ KYC review queue (${queue.length} operators${queue.length > top.length ? ', top 5' : ''}):`,
        ...lines,
        'Approve or reject with "approve operator <id>" / "reject operator <id>".',
      ].join('\n'),
      data: queue,
    };
  }

  private async reportMetrics() {
    const m = await this.store.getMetrics();
    const share = Math.round(m.zeroDeadheadShare * 100);
    return {
      reply: [
        '📊 Marketplace snapshot:',
        `- Loads: ${m.loads.total} total (${m.loads.open} open, ${m.loads.assigned} assigned, ${m.loads.delivered} delivered)`,
        `- Shipments: ${m.shipments.total} total, ${m.shipments.delivered} delivered`,
        `- Empty-trip cutting: avg deadhead ${m.avgDeadheadKm} km, ${share}% of trips under 25 km`,
        `- Fuel advances: ${m.advances.total} requested, ${m.advances.disbursedEtb} ETB disbursed (telebirr ${m.advances.byChannel.telebirr}, cbe_birr ${m.advances.byChannel.cbe_birr})`,
        `- VAT: ${m.vat.invoiceCount} invoices, ${m.vat.totalVatEtb} ETB VAT, ${m.vat.totalWithVatEtb} ETB total`,
      ].join('\n'),
      data: m,
    };
  }

  private systemPrompt(intent: AgentIntent, data: unknown, lang?: string): string {
    const language =
      lang === 'am'
        ? 'Amharic'
        : lang === 'om'
          ? 'Afaan Oromoo'
          : lang === 'so'
            ? 'Somali'
            : lang === 'ti'
              ? 'Tigrinya'
              : lang === 'sw'
                ? 'Swahili'
                : undefined;
    return [
      'You are the Domestic AI Agent for Afro-Link Domestic, an Ethiopian freight marketplace inside DomesticHub.',
      'A deterministic tool already executed the user request.',
      `Intent: ${intent}.`,
      `Structured result JSON: ${JSON.stringify(data ?? null)}`,
      language
        ? `Write a short, friendly reply in ${language} presenting the result.`
        : 'Write a short, friendly reply in English or Amharic presenting the result.',
      'Never invent ids, prices, or statuses.',
    ].join('\n');
  }
}
