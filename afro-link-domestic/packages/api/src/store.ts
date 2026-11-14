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
import { Repo } from './repo';
import { defaultPayoutAdapters } from './payouts';

export class MarketplaceStore implements AgentStore {
  constructor(
    private readonly repo: Repo,
    private readonly payouts: Record<AdvanceChannel, PayoutAdapter> = defaultPayoutAdapters(),
  ) {}

  createOperator(input: {
    name: string;
    phone: string;
    truckPlate: string;
    capacityTons: number;
    currentCity: City;
    lastDropOffCity?: City;
  }): TruckOperator {
    const operator: TruckOperator = {
      ...input,
      id: crypto.randomUUID(),
      status: 'available',
    };
    this.repo.operators.set(operator.id, operator);
    return operator;
  }

  createLoad(input: NewLoadInput): Load {
    const load: Load = {
      ...input,
      id: crypto.randomUUID(),
      availableFrom: input.availableFrom ?? new Date().toISOString(),
      status: 'open',
    };
    this.repo.loads.set(load.id, load);
    return load;
  }

  rankMatches(loadId: string): OperatorMatch[] {
    const load = this.getLoad(loadId);
    return rankOperatorsForLoad(load, [...this.repo.operators.values()]);
  }

  assignShipment(loadId: string, operatorId: string): Shipment {
    const load = this.getLoad(loadId);
    if (load.status !== 'open') {
      throw new DomainError('conflict', `Load is ${load.status}, not open.`);
    }
    const operator = this.getOperator(operatorId);
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
    this.repo.shipments.set(shipment.id, shipment);
    this.repo.loads.set(load.id, { ...load, status: 'assigned' });
    this.repo.operators.set(operator.id, { ...operator, status: 'on_trip' });
    this.repo.tracking.set(shipment.id, [
      {
        shipmentId: shipment.id,
        at: shipment.assignedAt,
        kind: 'assigned',
        location: load.origin,
        note: `Assigned to ${operator.name} (${operator.truckPlate}).`,
      },
    ]);
    return shipment;
  }

  addTrackingEvent(
    shipmentId: string,
    kind: TrackingEventKind,
    location?: City,
    note?: string,
  ): TrackingEvent {
    const shipment = this.getShipment(shipmentId);
    const event: TrackingEvent = {
      shipmentId: shipment.id,
      at: new Date().toISOString(),
      kind,
      location,
      note,
    };
    const events = this.repo.tracking.get(shipment.id) ?? [];
    events.push(event);
    this.repo.tracking.set(shipment.id, events);

    if (kind === 'picked_up') {
      this.repo.shipments.set(shipment.id, { ...shipment, status: 'in_transit' });
    }
    if (kind === 'delivered') {
      this.repo.shipments.set(shipment.id, {
        ...shipment,
        status: 'delivered',
        deliveredAt: event.at,
      });
      const load = this.repo.loads.get(shipment.loadId);
      if (load) {
        this.repo.loads.set(load.id, { ...load, status: 'delivered' });
      }
      const operator = this.repo.operators.get(shipment.operatorId);
      if (operator) {
        this.repo.operators.set(operator.id, {
          ...operator,
          status: 'available',
          currentCity: location ?? load?.destination ?? operator.currentCity,
          lastDropOffCity: location ?? load?.destination,
        });
      }
    }
    return event;
  }

  getTracking(shipmentId: string): TrackingEvent[] {
    this.getShipment(shipmentId);
    return this.repo.tracking.get(shipmentId) ?? [];
  }

  requestFuelAdvance(input: NewAdvanceInput): FuelAdvance {
    const shipment = this.getShipment(input.shipmentId);
    if (shipment.operatorId !== input.operatorId) {
      throw new DomainError('conflict', 'Shipment does not belong to this operator.');
    }
    const load = this.getLoad(shipment.loadId);
    const errors = validateAdvanceRequest({
      amountEtb: input.amountEtb,
      load,
      activeAdvances: this.repo.activeAdvancesFor(input.operatorId),
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
    this.repo.advances.set(advance.id, advance);
    return advance;
  }

  async transitionAdvance(id: string, action: AdvanceAction): Promise<FuelAdvance> {
    const advance = this.repo.advances.get(id);
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
      const operator = this.repo.operators.get(advance.operatorId);
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
    this.repo.advances.set(id, updated);
    return updated;
  }

  createInvoice(input: NewInvoiceInput): VatInvoice {
    const shipment = this.getShipment(input.shipmentId);
    if (shipment.status !== 'delivered') {
      throw new DomainError(
        'conflict',
        'Invoices can only be issued for delivered shipments.',
      );
    }
    const load = this.getLoad(shipment.loadId);
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
    this.repo.invoices.set(invoice.id, invoice);
    return invoice;
  }

  getInvoice(id: string): VatInvoice {
    const invoice = this.repo.invoices.get(id);
    if (!invoice) {
      throw new DomainError('not_found', 'Invoice not found.');
    }
    return invoice;
  }

  findShipment(shipmentId: string): Shipment | undefined {
    return this.repo.shipments.get(shipmentId);
  }

  findLatestShipment(): Shipment | undefined {
    return [...this.repo.shipments.values()].at(-1);
  }

  findLatestLoad(): Load | undefined {
    return [...this.repo.loads.values()].at(-1);
  }

  listOperators(): TruckOperator[] {
    return [...this.repo.operators.values()];
  }

  listLoads(): Load[] {
    return [...this.repo.loads.values()];
  }

  listShipments(): Shipment[] {
    return [...this.repo.shipments.values()];
  }

  listAdvances(): FuelAdvance[] {
    return [...this.repo.advances.values()];
  }

  listInvoices(): VatInvoice[] {
    return [...this.repo.invoices.values()];
  }

  private getLoad(id: string): Load {
    const load = this.repo.loads.get(id);
    if (!load) throw new DomainError('not_found', 'Load not found.');
    return load;
  }

  private getOperator(id: string): TruckOperator {
    const operator = this.repo.operators.get(id);
    if (!operator) throw new DomainError('not_found', 'Operator not found.');
    return operator;
  }

  private getShipment(id: string): Shipment {
    const shipment = this.repo.shipments.get(id);
    if (!shipment) throw new DomainError('not_found', 'Shipment not found.');
    return shipment;
  }
}
