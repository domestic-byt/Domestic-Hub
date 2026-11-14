import {
  AdvanceAction,
  AdvanceChannel,
  City,
  DomainError,
  FuelAdvance,
  Load,
  OperatorMatch,
  PayoutAdapter,
  ReturnLoadMatch,
  Shipment,
  TrackingEvent,
  TrackingEventKind,
  TruckOperator,
  MarketplaceMetrics,
  VatInvoice,
  computeVat,
  haversineKm,
  nextAdvanceStatus,
  rankOperatorsForLoad,
  rankReturnLoads,
  validateAdvanceRequest,
} from '@afro-link/shared';
import type {
  AgentStore,
  NewAdvanceInput,
  NewInvoiceInput,
  NewLoadInput,
} from '@afro-link/agent';
import type { MarketplaceRepo } from './repo';
import { defaultPayoutAdapters } from './payouts';
import { WebhookDispatcher } from './webhooks';

const ZERO_DEADHEAD_KM = 25;

export class MarketplaceStore implements AgentStore {
  constructor(
    private readonly repo: MarketplaceRepo,
    private readonly payouts: Record<AdvanceChannel, PayoutAdapter> = defaultPayoutAdapters(),
    private readonly webhooks?: WebhookDispatcher,
  ) {}

  async createOperator(input: {
    name: string;
    phone: string;
    truckPlate: string;
    capacityTons: number;
    currentCity: City;
    lastDropOffCity?: City;
  }): Promise<TruckOperator> {
    const operator: TruckOperator = {
      ...input,
      id: crypto.randomUUID(),
      status: 'available',
    };
    await this.repo.saveOperator(operator);
    return operator;
  }

  async createLoad(input: NewLoadInput): Promise<Load> {
    const load: Load = {
      ...input,
      id: crypto.randomUUID(),
      availableFrom: input.availableFrom ?? new Date().toISOString(),
      status: 'open',
    };
    await this.repo.saveLoad(load);
    return load;
  }

  async rankMatches(loadId: string): Promise<OperatorMatch[]> {
    const load = await this.getLoad(loadId);
    return rankOperatorsForLoad(load, await this.repo.listOperators());
  }

  async rankReturnLoads(operatorId: string): Promise<ReturnLoadMatch[]> {
    const operator = await this.getOperator(operatorId);
    return rankReturnLoads(operator, await this.repo.listLoads());
  }

  async assignShipment(loadId: string, operatorId: string): Promise<Shipment> {
    const load = await this.getLoad(loadId);
    if (load.status !== 'open') {
      throw new DomainError('conflict', `Load is ${load.status}, not open.`);
    }
    const operator = await this.getOperator(operatorId);
    if (operator.capacityTons < load.weightTons) {
      throw new DomainError('conflict', 'Operator capacity is below load weight.');
    }
    const deadheadKm =
      Math.round(
        haversineKm(operator.lastDropOffCity ?? operator.currentCity, load.origin) * 10,
      ) / 10;
    const shipment: Shipment = {
      id: crypto.randomUUID(),
      loadId: load.id,
      operatorId: operator.id,
      assignedAt: new Date().toISOString(),
      status: 'assigned',
      deadheadKm,
    };
    await this.repo.saveShipment(shipment);
    await this.repo.saveLoad({ ...load, status: 'assigned' });
    await this.repo.saveOperator({ ...operator, status: 'on_trip' });
    await this.repo.appendTrackingEvent({
      shipmentId: shipment.id,
      at: shipment.assignedAt,
      kind: 'assigned',
      location: load.origin,
      note: `Assigned to ${operator.name} (${operator.truckPlate}).`,
    });
    void this.webhooks?.dispatch('shipment.assigned', {
      shipment,
      load,
      operatorId: operator.id,
    });
    return shipment;
  }

  async addTrackingEvent(
    shipmentId: string,
    kind: TrackingEventKind,
    location?: City,
    note?: string,
  ): Promise<TrackingEvent> {
    const shipment = await this.getShipment(shipmentId);
    const event: TrackingEvent = {
      shipmentId: shipment.id,
      at: new Date().toISOString(),
      kind,
      location,
      note,
    };
    await this.repo.appendTrackingEvent(event);

    if (kind === 'picked_up') {
      await this.repo.saveShipment({ ...shipment, status: 'in_transit' });
      void this.webhooks?.dispatch('shipment.picked_up', { shipment, event });
    }
    if (kind === 'delivered') {
      await this.repo.saveShipment({
        ...shipment,
        status: 'delivered',
        deliveredAt: event.at,
      });
      const load = await this.repo.getLoad(shipment.loadId);
      if (load) {
        await this.repo.saveLoad({ ...load, status: 'delivered' });
      }
      const operator = await this.repo.getOperator(shipment.operatorId);
      if (operator) {
        await this.repo.saveOperator({
          ...operator,
          status: 'available',
          currentCity: location ?? load?.destination ?? operator.currentCity,
          lastDropOffCity: location ?? load?.destination,
        });
      }
      void this.webhooks?.dispatch('shipment.delivered', { shipment, event, load });
    }
    return event;
  }

  async getMetrics(): Promise<MarketplaceMetrics> {
    const [loads, shipments, advances, invoices] = await Promise.all([
      this.repo.listLoads(),
      this.repo.listShipments(),
      this.repo.listAdvances(),
      this.repo.listInvoices(),
    ]);
    const deadheads = shipments
      .map((s) => s.deadheadKm)
      .filter((km): km is number => typeof km === 'number');
    const avgDeadheadKm =
      deadheads.length === 0
        ? 0
        : Math.round((deadheads.reduce((sum, km) => sum + km, 0) / deadheads.length) * 10) / 10;
    const zeroDeadheadShare =
      deadheads.length === 0
        ? 0
        : Math.round(
            (deadheads.filter((km) => km < ZERO_DEADHEAD_KM).length / deadheads.length) * 1000,
          ) / 1000;
    const disbursed = advances.filter((a) => a.status === 'disbursed' || a.status === 'recovered');
    const byChannel = { telebirr: 0, cbe_birr: 0 };
    for (const advance of disbursed) {
      byChannel[advance.channel] += advance.amountEtb;
    }
    return {
      loads: {
        total: loads.length,
        open: loads.filter((l) => l.status === 'open').length,
        assigned: loads.filter((l) => l.status === 'assigned').length,
        delivered: loads.filter((l) => l.status === 'delivered').length,
      },
      shipments: {
        total: shipments.length,
        delivered: shipments.filter((s) => s.status === 'delivered').length,
      },
      avgDeadheadKm,
      zeroDeadheadShare,
      advances: {
        total: advances.length,
        disbursedEtb: disbursed.reduce((sum, a) => sum + a.amountEtb, 0),
        byChannel,
      },
      vat: {
        invoiceCount: invoices.length,
        totalVatEtb: invoices.reduce((sum, i) => sum + i.vatEtb, 0),
        totalWithVatEtb: invoices.reduce((sum, i) => sum + i.totalEtb, 0),
      },
    };
  }

  async getTracking(shipmentId: string): Promise<TrackingEvent[]> {
    await this.getShipment(shipmentId);
    return this.repo.getTrackingEvents(shipmentId);
  }

  async requestFuelAdvance(input: NewAdvanceInput): Promise<FuelAdvance> {
    const shipment = await this.getShipment(input.shipmentId);
    if (shipment.operatorId !== input.operatorId) {
      throw new DomainError('conflict', 'Shipment does not belong to this operator.');
    }
    const load = await this.getLoad(shipment.loadId);
    const errors = validateAdvanceRequest({
      amountEtb: input.amountEtb,
      load,
      activeAdvances: await this.repo.activeAdvancesFor(input.operatorId),
    });
    if (errors.length > 0) {
      throw new DomainError('validation', errors[0]!, errors);
    }
    const advance: FuelAdvance = {
      ...input,
      id: crypto.randomUUID(),
      status: 'requested',
      requestedAt: new Date().toISOString(),
    };
    await this.repo.saveAdvance(advance);
    return advance;
  }

  async transitionAdvance(id: string, action: AdvanceAction): Promise<FuelAdvance> {
    const advance = await this.repo.getAdvance(id);
    if (!advance) {
      throw new DomainError('not_found', 'Advance not found.');
    }
    const next = nextAdvanceStatus(advance.status, action);
    if (!next) {
      throw new DomainError(
        'conflict',
        `Cannot ${action} an advance in status '${advance.status}'.`,
      );
    }
    let updated: FuelAdvance = { ...advance, status: next };
    if (action === 'disburse' || action === 'recover') {
      const operator = await this.repo.getOperator(advance.operatorId);
      const request = {
        advanceId: advance.id,
        operatorId: advance.operatorId,
        amountEtb: advance.amountEtb,
        phone: operator?.phone ?? '',
        channel: advance.channel,
      };
      const adapter = this.payouts[advance.channel];
      const payout =
        action === 'disburse' ? await adapter.disburse(request) : await adapter.recover(request);
      if (!payout.success) {
        throw new DomainError(
          'conflict',
          `${advance.channel} payout failed: ${payout.error ?? 'unknown error'}`,
        );
      }
      updated = { ...updated, payoutReference: payout.reference };
    }
    await this.repo.saveAdvance(updated);
    return updated;
  }

  async createInvoice(input: NewInvoiceInput): Promise<VatInvoice> {
    const shipment = await this.getShipment(input.shipmentId);
    if (shipment.status !== 'delivered') {
      throw new DomainError(
        'conflict',
        'Invoices can only be issued for delivered shipments.',
      );
    }
    const load = await this.getLoad(shipment.loadId);
    const vat = computeVat(load.offeredPriceEtb);
    const invoice: VatInvoice = {
      id: crypto.randomUUID(),
      shipmentId: shipment.id,
      shipperTin: input.shipperTin,
      operatorTin: input.operatorTin,
      subtotalEtb: vat.subtotalEtb,
      vatEtb: vat.vatEtb,
      totalEtb: vat.totalEtb,
      issuedAt: new Date().toISOString(),
    };
    await this.repo.saveInvoice(invoice);
    return invoice;
  }

  async getInvoice(id: string): Promise<VatInvoice> {
    const invoice = await this.repo.getInvoice(id);
    if (!invoice) {
      throw new DomainError('not_found', 'Invoice not found.');
    }
    return invoice;
  }

  async findShipment(shipmentId: string): Promise<Shipment | undefined> {
    return this.repo.getShipment(shipmentId);
  }

  async findLatestShipment(): Promise<Shipment | undefined> {
    return this.repo.latestShipment();
  }

  async findLatestLoad(): Promise<Load | undefined> {
    return this.repo.latestLoad();
  }

  async listOperators(): Promise<TruckOperator[]> {
    return this.repo.listOperators();
  }

  async listLoads(): Promise<Load[]> {
    return this.repo.listLoads();
  }

  async listShipments(): Promise<Shipment[]> {
    return this.repo.listShipments();
  }

  async listAdvances(): Promise<FuelAdvance[]> {
    return this.repo.listAdvances();
  }

  async listInvoices(): Promise<VatInvoice[]> {
    return this.repo.listInvoices();
  }

  private async getLoad(id: string): Promise<Load> {
    const load = await this.repo.getLoad(id);
    if (!load) throw new DomainError('not_found', 'Load not found.');
    return load;
  }

  private async getOperator(id: string): Promise<TruckOperator> {
    const operator = await this.repo.getOperator(id);
    if (!operator) throw new DomainError('not_found', 'Operator not found.');
    return operator;
  }

  private async getShipment(id: string): Promise<Shipment> {
    const shipment = await this.repo.getShipment(id);
    if (!shipment) throw new DomainError('not_found', 'Shipment not found.');
    return shipment;
  }
}
