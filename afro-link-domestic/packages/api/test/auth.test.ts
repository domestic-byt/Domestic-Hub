import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signToken, verifyToken } from '../src/auth';
import { buildServer } from '../src/server';

const SECRET = 'test-secret';
const addis = { name: 'Addis Ababa', lat: 9.03, lon: 38.74 };
const jimma = { name: 'Jimma', lat: 7.67, lon: 36.83 };

function token(role: 'shipper' | 'operator' | 'admin', subject = 'user-1'): string {
  return signToken({ subject, role }, SECRET);
}

const authed = (role: 'shipper' | 'operator' | 'admin', subject = 'user-1') => ({
  authorization: `Bearer ${token(role, subject)}`,
});

describe('auth tokens', () => {
  it('roundtrips a valid token', () => {
    const actor = verifyToken(signToken({ subject: 'op-1', role: 'operator', name: 'Abebe' }, SECRET), SECRET);
    expect(actor).toEqual({ subject: 'op-1', role: 'operator', name: 'Abebe' });
  });

  it('rejects tampered, wrong-secret, expired and malformed tokens', () => {
    const valid = signToken({ subject: 'op-1', role: 'operator' }, SECRET);
    expect(verifyToken(valid.slice(0, -2) + 'xx', SECRET)).toBeUndefined();
    expect(verifyToken(valid, 'other-secret')).toBeUndefined();
    const expired = signToken({ subject: 'op-1', role: 'operator' }, SECRET, -10);
    expect(verifyToken(expired, SECRET)).toBeUndefined();
    expect(verifyToken('not-a-jwt', SECRET)).toBeUndefined();
  });
});

describe('authenticated api', async () => {
  const app = await buildServer({ auth: { secret: SECRET } });

  beforeAll(async () => {
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('keeps reads public', async () => {
    const res = await app.inject({ method: 'GET', url: '/loads' });
    expect(res.statusCode).toBe(200);
  });

  it('restricts metrics to admins', async () => {
    const anonymous = await app.inject({ method: 'GET', url: '/metrics' });
    expect(anonymous.statusCode).toBe(401);

    const forbidden = await app.inject({ method: 'GET', url: '/metrics', headers: authed('shipper') });
    expect(forbidden.statusCode).toBe(403);

    const allowed = await app.inject({ method: 'GET', url: '/metrics', headers: authed('admin') });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json()).toHaveProperty('loads');
  });

  it('restricts the audit log to admins', async () => {
    const anonymous = await app.inject({ method: 'GET', url: '/admin/audit' });
    expect(anonymous.statusCode).toBe(401);

    const forbidden = await app.inject({ method: 'GET', url: '/admin/audit', headers: authed('shipper') });
    expect(forbidden.statusCode).toBe(403);

    const allowed = await app.inject({ method: 'GET', url: '/admin/audit', headers: authed('admin') });
    expect(allowed.statusCode).toBe(200);
    expect(Array.isArray(allowed.json())).toBe(true);
  });

  it('restricts the KYC review queue and decisions to admins', async () => {
    const anonymous = await app.inject({ method: 'GET', url: '/admin/kyc' });
    expect(anonymous.statusCode).toBe(401);

    const forbidden = await app.inject({ method: 'GET', url: '/admin/kyc', headers: authed('operator') });
    expect(forbidden.statusCode).toBe(403);

    const allowed = await app.inject({ method: 'GET', url: '/admin/kyc', headers: authed('admin') });
    expect(allowed.statusCode).toBe(200);

    const operatorRes = await app.inject({
      method: 'POST',
      url: '/operators',
      payload: {
        name: 'Auth KYC Trucks',
        phone: '+251911004433',
        truckPlate: 'AA-44330',
        capacityTons: 21,
        currentCity: addis,
      },
      headers: authed('admin'),
    });
    const operator = operatorRes.json();

    const forbiddenDecision = await app.inject({
      method: 'POST',
      url: `/operators/${operator.id}/kyc`,
      payload: { decision: 'approved' },
      headers: authed('shipper'),
    });
    expect(forbiddenDecision.statusCode).toBe(403);

    const allowedDecision = await app.inject({
      method: 'POST',
      url: `/operators/${operator.id}/kyc`,
      payload: { decision: 'approved', licenseExpiry: '2031-01-01' },
      headers: authed('admin'),
    });
    expect(allowedDecision.statusCode).toBe(200);
    expect(allowedDecision.json().kycDecision).toBe('approved');
  });

  it('rejects unauthenticated writes with 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/loads',
      payload: { shipperId: 's1', origin: addis, destination: jimma, weightTons: 10, offeredPriceEtb: 1000 },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects wrong roles with 403', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/loads',
      headers: authed('operator'),
      payload: { shipperId: 's1', origin: addis, destination: jimma, weightTons: 10, offeredPriceEtb: 1000 },
    });
    expect(res.statusCode).toBe(403);
  });

  it('lets operators see only their own earnings', async () => {
    const forbidden = await app.inject({
      method: 'GET',
      url: '/operators/someone-else/earnings',
      headers: authed('operator', 'op-me'),
    });
    expect(forbidden.statusCode).toBe(403);

    const shipperForbidden = await app.inject({
      method: 'GET',
      url: '/operators/op-me/earnings',
      headers: authed('shipper'),
    });
    expect(shipperForbidden.statusCode).toBe(403);

    const own = await app.inject({
      method: 'GET',
      url: '/operators/op-me/earnings',
      headers: authed('operator', 'op-me'),
    });
    expect(own.statusCode).toBe(404);
  });

  it('lets operators see only their own advances and shippers only their own invoices', async () => {
    const advancesForbidden = await app.inject({
      method: 'GET',
      url: '/operators/someone-else/advances',
      headers: authed('operator', 'op-me'),
    });
    expect(advancesForbidden.statusCode).toBe(403);

    const advancesShipperForbidden = await app.inject({
      method: 'GET',
      url: '/operators/op-me/advances',
      headers: authed('shipper'),
    });
    expect(advancesShipperForbidden.statusCode).toBe(403);

    const advancesOwn = await app.inject({
      method: 'GET',
      url: '/operators/op-me/advances',
      headers: authed('operator', 'op-me'),
    });
    expect(advancesOwn.statusCode).toBe(200);
    expect(advancesOwn.json()).toEqual([]);

    const dashForbidden = await app.inject({
      method: 'GET',
      url: '/operators/someone-else/dashboard',
      headers: authed('operator', 'op-me'),
    });
    expect(dashForbidden.statusCode).toBe(403);

    const dashShipperForbidden = await app.inject({
      method: 'GET',
      url: '/operators/op-me/dashboard',
      headers: authed('shipper'),
    });
    expect(dashShipperForbidden.statusCode).toBe(403);

    const dashOwn = await app.inject({
      method: 'GET',
      url: '/operators/op-me/dashboard',
      headers: authed('operator', 'op-me'),
    });
    expect(dashOwn.statusCode).toBe(404);

    const invoicesForbidden = await app.inject({
      method: 'GET',
      url: '/shippers/someone-else/invoices',
      headers: authed('shipper', 'shipper-me'),
    });
    expect(invoicesForbidden.statusCode).toBe(403);

    const invoicesOperatorForbidden = await app.inject({
      method: 'GET',
      url: '/shippers/shipper-me/invoices',
      headers: authed('operator'),
    });
    expect(invoicesOperatorForbidden.statusCode).toBe(403);

    const invoicesOwn = await app.inject({
      method: 'GET',
      url: '/shippers/shipper-me/invoices',
      headers: authed('shipper', 'shipper-me'),
    });
    expect(invoicesOwn.statusCode).toBe(200);
    expect(invoicesOwn.json()).toEqual([]);
  });

  it('lets a shipper post loads and an operator register trucks', async () => {
    const operatorRes = await app.inject({
      method: 'POST',
      url: '/operators',
      headers: authed('operator', 'op-77'),
      payload: {
        name: 'Auth Trucks',
        phone: '+251911222333',
        truckPlate: 'AU-0001',
        capacityTons: 25,
        currentCity: jimma,
      },
    });
    expect(operatorRes.statusCode).toBe(201);

    const loadRes = await app.inject({
      method: 'POST',
      url: '/loads',
      headers: authed('shipper', 'shipper-77'),
      payload: {
        shipperId: 'ignored',
        origin: jimma,
        destination: addis,
        weightTons: 20,
        offeredPriceEtb: 40000,
      },
    });
    expect(loadRes.statusCode).toBe(201);
    expect(loadRes.json().shipperId).toBe('shipper-77');
  });

  it('lets shippers cancel only their own loads', async () => {
    const otherLoad = await app.inject({
      method: 'POST',
      url: '/loads',
      headers: authed('shipper', 'shipper-other'),
      payload: { shipperId: 'ignored', origin: addis, destination: jimma, weightTons: 10, offeredPriceEtb: 1000 },
    });
    expect(otherLoad.statusCode).toBe(201);

    const forbidden = await app.inject({
      method: 'POST',
      url: `/loads/${otherLoad.json().id}/cancel`,
      headers: authed('shipper', 'shipper-77'),
    });
    expect(forbidden.statusCode).toBe(403);

    const own = await app.inject({
      method: 'POST',
      url: `/loads/${otherLoad.json().id}/cancel`,
      headers: authed('shipper', 'shipper-other'),
    });
    expect(own.statusCode).toBe(200);
    expect(own.json().status).toBe('cancelled');
  });

  it('restricts payout transitions to admins', async () => {
    const operatorRes = await app.inject({
      method: 'POST',
      url: '/operators',
      headers: authed('admin'),
      payload: {
        name: 'Admin Trucks',
        phone: '+251911444555',
        truckPlate: 'AU-0002',
        capacityTons: 25,
        currentCity: addis,
      },
    });
    const operator = operatorRes.json();
    const loadRes = await app.inject({
      method: 'POST',
      url: '/loads',
      headers: authed('admin'),
      payload: { shipperId: 's', origin: addis, destination: jimma, weightTons: 10, offeredPriceEtb: 20000 },
    });
    const shipmentRes = await app.inject({
      method: 'POST',
      url: '/shipments',
      headers: authed('admin'),
      payload: { loadId: loadRes.json().id, operatorId: operator.id },
    });
    const advanceRes = await app.inject({
      method: 'POST',
      url: '/advances',
      headers: authed('operator', operator.id),
      payload: {
        operatorId: operator.id,
        shipmentId: shipmentRes.json().id,
        amountEtb: 1000,
        channel: 'telebirr',
      },
    });
    expect(advanceRes.statusCode).toBe(201);

    const forbidden = await app.inject({
      method: 'POST',
      url: `/advances/${advanceRes.json().id}/transition`,
      headers: authed('operator'),
      payload: { action: 'approve' },
    });
    expect(forbidden.statusCode).toBe(403);

    const allowed = await app.inject({
      method: 'POST',
      url: `/advances/${advanceRes.json().id}/transition`,
      headers: authed('admin'),
      payload: { action: 'approve' },
    });
    expect(allowed.statusCode).toBe(200);
  });

  it('derives the agent identity from the token', async () => {
    const operatorRes = await app.inject({
      method: 'POST',
      url: '/operators',
      headers: authed('operator', 'op-99'),
      payload: {
        name: 'Agent Trucks',
        phone: '+251911666777',
        truckPlate: 'AU-0003',
        capacityTons: 25,
        currentCity: jimma,
      },
    });
    const operator = operatorRes.json();

    const postRes = await app.inject({
      method: 'POST',
      url: '/agent/chat',
      headers: authed('shipper', 'shipper-99'),
      payload: { message: 'Post 20 tons from Jimma to Addis Ababa for 40000 birr' },
    });
    expect(postRes.statusCode).toBe(200);
    const loadId = postRes.json().data.id as string;

    const assignRes = await app.inject({
      method: 'POST',
      url: '/agent/chat',
      headers: authed('operator', operator.id),
      payload: { message: `assign the top match for ${loadId}` },
    });
    expect(assignRes.statusCode).toBe(200);
    expect(assignRes.json().intent).toBe('assign_truck');
  });
});
