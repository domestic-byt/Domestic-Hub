import {
  FuelAdvance,
  Load,
  Shipment,
  TrackingEvent,
  TruckOperator,
  VatInvoice,
} from '@afro-link/shared';

export class Repo {
  operators = new Map<string, TruckOperator>();
  loads = new Map<string, Load>();
  shipments = new Map<string, Shipment>();
  advances = new Map<string, FuelAdvance>();
  invoices = new Map<string, VatInvoice>();
  tracking = new Map<string, TrackingEvent[]>();

  activeAdvancesFor(operatorId: string): FuelAdvance[] {
    return [...this.advances.values()].filter(
      (a) => a.operatorId === operatorId && a.status !== 'recovered' && a.status !== 'rejected' && a.status !== 'defaulted',
    );
  }
}
