import {
  AdvanceAction,
  AdvanceChannel,
  City,
  DomainError,
  FuelAdvance,
  Load,
  OperatorMatch,
  PayoutAdapter,
  Shipment,
  TrackingEvent,
  TrackingEventKind,
  TruckOperator,
  VatInvoice,
  computeVat,
  nextAdvanceStatus,
  rankOperatorsForLoad,
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

export class MarketplaceStore implements AgentStore {
  constructor(
    private readonly repo: MarketplaceRepo,
    private readonly payouts: Record<AdvanceChannel, PayoutAdapter> = defaultPayoutAdapters(),
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

  async assignShipment(loadId: string, operatorId: string): Promise<Shipment> {
    const load = await this.getLoad(loadId);
    if (load.status !== 'open') {
      throw new DomainError('conflict', `Load is ${load.status}, not open.`);
    }
    const operator = await this.getOperator(operatorId);
    if (operator.capacityTons < load.weightTons) {
      throw new DomainError('conflict', 'Operator capacity is below load weight.');
    }
    const shipment: Shipment = {
      id: crypto.randomUUID(),
      loadId: load.id,
      operatorId: operator.id,
      assignedAt: new Date().toISOString(),
      status: 'assigned',
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
    }
    return event;
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
