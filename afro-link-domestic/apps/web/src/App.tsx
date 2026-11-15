import { useCallback, useEffect, useState } from 'react';
import { api, apiUrl, getAuthToken, setAuthToken } from './api';
import { flushOutbox, outboxCount } from './outbox';
import { usePwaInstall } from './usePwaInstall';
import { LANGUAGES, Lang, loadLang, saveLang, STRINGS, Strings } from './i18n';
import { useVoiceInput } from './useVoiceInput';
import type {
  AuditEntry,
  KycReview,
  Load,
  Webhook,
  WebhookDelivery,
  MarketplaceMetrics,
  OperatorDashboard,
  OperatorEarnings,
  OperatorMatch,
  PriceSuggestion,
  Rating,
  ReturnLoadMatch,
  Shipment,
  TrackingEvent,
  VatInvoice,
} from './types';

const CITIES = [
  'Addis Ababa',
  'Adama',
  'Dire Dawa',
  'Mekelle',
  'Bahir Dar',
  'Gondar',
  'Hawassa',
  'Jimma',
  'Dessie',
  'Nekemte',
  'Arba Minch',
  'Jijiga',
  'Harar',
];

const CITY_COORDS: Record<string, { lat: number; lon: number }> = {
  'Addis Ababa': { lat: 9.03, lon: 38.74 },
  Adama: { lat: 8.54, lon: 39.27 },
  'Dire Dawa': { lat: 9.59, lon: 41.85 },
  Mekelle: { lat: 13.5, lon: 39.47 },
  'Bahir Dar': { lat: 11.59, lon: 37.39 },
  Gondar: { lat: 12.6, lon: 37.47 },
  Hawassa: { lat: 7.06, lon: 38.47 },
  Jimma: { lat: 7.67, lon: 36.83 },
  Dessie: { lat: 11.13, lon: 39.63 },
  Nekemte: { lat: 9.09, lon: 36.55 },
  'Arba Minch': { lat: 6.04, lon: 37.56 },
  Jijiga: { lat: 9.35, lon: 42.8 },
  Harar: { lat: 9.31, lon: 42.12 },
};

function city(name: string) {
  const coords = CITY_COORDS[name]!;
  return { name, ...coords };
}

type Tab = 'shipper' | 'driver' | 'track' | 'agent' | 'metrics' | 'kyc';

export default function App() {
  const [tab, setTab] = useState<Tab>('shipper');
  const [lang, setLang] = useState<Lang>(loadLang);
  const [token, setToken] = useState(getAuthToken() ?? '');
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const t = STRINGS[lang];

  const sync = useCallback(async () => {
    if (navigator.onLine) {
      await flushOutbox((item) => api.replay(item.path, item.body));
    }
    setPending(outboxCount());
  }, []);

  useEffect(() => {
    setOnline(navigator.onLine);
    void sync();
    const goOnline = () => {
      setOnline(true);
      void sync();
    };
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    const retry = window.setInterval(() => {
      if (navigator.onLine && outboxCount() > 0) void sync();
    }, 30000);
    let onMessage: ((e: MessageEvent) => void) | undefined;
    if ('serviceWorker' in navigator) {
      onMessage = (e: MessageEvent) => {
        if ((e.data as { type?: string } | null)?.type === 'flush-outbox') void sync();
      };
      navigator.serviceWorker.addEventListener('message', onMessage);
    }
    return () => {
      window.clearInterval(retry);
      if (onMessage && 'serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', onMessage);
      }
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, [sync]);

  const pwa = usePwaInstall();

  const applyToken = (value: string) => {
    setToken(value);
    setAuthToken(value);
  };

  const applyLang = (value: Lang) => {
    setLang(value);
    saveLang(value);
  };

  return (
    <div className="app">
      <header>
        <div className="row spread">
          <h1>
            Afro-Link Domestic <span className="am">አፍሮ-ሊንክ ዶሜስቲክ</span>
          </h1>
          <select
            className="lang-toggle"
            value={lang}
            onChange={(e) => applyLang(e.target.value as Lang)}
            aria-label="Language"
          >
            {LANGUAGES.map(({ code, label }) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <p className="tagline">{t.tagline}</p>
        <div className="auth-row">
          <input
            type="password"
            value={token}
            placeholder={t.tokenPlaceholder}
            onChange={(e) => applyToken(e.target.value)}
          />
          {token ? <span className="auth-ok">{t.signedIn}</span> : <span className="auth-hint">{t.guestMode}</span>}
          {pwa.canInstall && (
            <button type="button" className="install-btn" onClick={() => void pwa.install()}>
              {t.installApp}
            </button>
          )}
          {(!online || pending > 0) && (
            <span className={online ? 'auth-ok' : 'offline-badge'}>
              {!online && t.offline}
              {online && pending > 0 && `${pending} ${t.queued}`}
            </span>
          )}
        </div>
        <nav>
          {(
            [
              ['shipper', t.tabShipper],
              ['driver', t.tabDriver],
              ['track', t.tabTrack],
              ['agent', t.tabAgent],
              ['metrics', t.tabMetrics],
              ['kyc', t.tabKyc],
            ] as Array<[Tab, string]>
          ).map(([id, label]) => (
            <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </nav>
      </header>
      <main>
        {tab === 'shipper' && <ShipperPanel t={t} />}
        {tab === 'driver' && <DriverPanel t={t} />}
        {tab === 'track' && <TrackPanel t={t} />}
        {tab === 'agent' && <AgentPanel t={t} lang={lang} />}
        {tab === 'metrics' && <MetricsPanel t={t} />}
        {tab === 'kyc' && <KycPanel t={t} />}
      </main>
    </div>
  );
}

function ErrorBox({ error }: { error: string | null }) {
  if (!error) return null;
  return <div className="error">⚠️ {error}</div>;
}

function ShipperPanel({ t }: { t: Strings }) {
  const [loads, setLoads] = useState<Load[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [matches, setMatches] = useState<Record<string, OperatorMatch[]>>({});
  const [priceHint, setPriceHint] = useState<PriceSuggestion | null>(null);
  const [rateForm, setRateForm] = useState({ shipmentId: '', stars: 5, comment: '' });
  const [rateSaved, setRateSaved] = useState(false);
  const [invoices, setInvoices] = useState<VatInvoice[] | null>(null);
  const [form, setForm] = useState({
    shipperId: 'shipper-1',
    origin: 'Jimma',
    destination: 'Addis Ababa',
    weightTons: 20,
    offeredPriceEtb: 40000,
  });

  const refresh = useCallback(async () => {
    try {
      setLoads(await api.listLoads());
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    api
      .listInvoices(form.shipperId)
      .then((rows) => {
        if (!cancelled) setInvoices(rows);
      })
      .catch(() => {
        if (!cancelled) setInvoices(null);
      });
    return () => {
      cancelled = true;
    };
  }, [form.shipperId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPriceHint(null);
    try {
      await api.createLoad({
        shipperId: form.shipperId,
        origin: city(form.origin),
        destination: city(form.destination),
        weightTons: Number(form.weightTons),
        offeredPriceEtb: Number(form.offeredPriceEtb),
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function suggestPrice() {
    setError(null);
    try {
      setPriceHint(
        await api.getSuggestedPrice(form.origin, form.destination, Number(form.weightTons)),
      );
    } catch (e) {
      setPriceHint(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function findMatches(loadId: string) {
    setError(null);
    try {
      const result = await api.getMatches(loadId);
      setMatches((m) => ({ ...m, [loadId]: result }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function assignTop(loadId: string) {
    setError(null);
    try {
      const list = matches[loadId] ?? (await api.getMatches(loadId));
      const top = list[0];
      if (!top) {
        setError(t.noTrucks);
        return;
      }
      await api.createShipment(loadId, top.operatorId);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function cancel(loadId: string) {
    setError(null);
    try {
      await api.cancelLoad(loadId);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function rate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setRateSaved(false);
    try {
      await api.rateShipment(
        rateForm.shipmentId.trim(),
        Number(rateForm.stars),
        rateForm.comment || undefined,
      );
      setRateSaved(true);
      setRateForm({ shipmentId: '', stars: 5, comment: '' });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <section>
      <h2>{t.postLoad}</h2>
      <ErrorBox error={error} />
      <form onSubmit={submit} className="card row">
        <label>
          {t.shipperId}
          <input
            value={form.shipperId}
            onChange={(e) => setForm({ ...form, shipperId: e.target.value })}
          />
        </label>
        <label>
          {t.from}
          <select
            value={form.origin}
            onChange={(e) => setForm({ ...form, origin: e.target.value })}
          >
            {CITIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          {t.to}
          <select
            value={form.destination}
            onChange={(e) => setForm({ ...form, destination: e.target.value })}
          >
            {CITIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          {t.tons}
          <input
            type="number"
            min="1"
            step="0.5"
            value={form.weightTons}
            onChange={(e) => setForm({ ...form, weightTons: Number(e.target.value) })}
          />
        </label>
        <label>
          {t.price}
          <input
            type="number"
            min="1"
            value={form.offeredPriceEtb}
            onChange={(e) => setForm({ ...form, offeredPriceEtb: Number(e.target.value) })}
          />
        </label>
        <button type="submit">{t.postLoadBtn}</button>
        <button type="button" onClick={() => void suggestPrice()}>
          {t.suggestPriceBtn}
        </button>
      </form>
      {priceHint && (
        <div className="card metric">
          <strong>{priceHint.suggestedEtb.toLocaleString()} ETB</strong>
          <span>{t.suggestedPrice}</span>
          <em>
            {priceHint.lowEtb.toLocaleString()}–{priceHint.highEtb.toLocaleString()} ETB ·{' '}
            {priceHint.etbPerTonKm} ETB/t·km · {priceHint.distanceKm} km ·{' '}
            {priceHint.sampleSize} {priceHint.basis}
          </em>
          <button onClick={() => setForm({ ...form, offeredPriceEtb: priceHint.suggestedEtb })}>
            {t.usePrice}
          </button>
        </div>
      )}

      <h2>{t.loads}</h2>
      {loads.length === 0 && <p>{t.noLoads}</p>}
      {loads.map((load) => (
        <div key={load.id} className="card">
          <div className="row spread">
            <strong>
              {load.origin.name} → {load.destination.name}
            </strong>
            <span className={`badge ${load.status}`}>{load.status}</span>
          </div>
          <div className="row">
            <span>{load.weightTons} t</span>
            <span>{load.offeredPriceEtb.toLocaleString()} ETB</span>
            <span className="muted">{load.id}</span>
          </div>
          <div className="row">
            <button onClick={() => findMatches(load.id)}>{t.findMatches}</button>
            {load.status === 'open' && (
              <button onClick={() => assignTop(load.id)}>{t.assignTopMatch}</button>
            )}
            {(load.status === 'open' || load.status === 'assigned') && (
              <button className="danger" onClick={() => cancel(load.id)}>
                {t.cancelLoadBtn}
              </button>
            )}
          </div>
          {matches[load.id] && (
            <ol className="matches">
              {matches[load.id]!.map((m) => (
                <li key={m.operatorId}>
                  <strong>{m.operatorName}</strong> — score {m.score}, {m.deadheadKm} km deadhead
                  {m.ratingCount ? ` ⭐ ${m.ratingAvg} (${m.ratingCount})` : ''}
                  {m.reasons.length > 0 && <em> ({m.reasons.join('; ')})</em>}
                </li>
              ))}
            </ol>
          )}
        </div>
      ))}

      <h2>{t.ratingHeading}</h2>
      <form onSubmit={rate} className="card row">
        <label>
          {t.podShipment}
          <input
            value={rateForm.shipmentId}
            onChange={(e) => setRateForm({ ...rateForm, shipmentId: e.target.value })}
          />
        </label>
        <label>
          {t.ratingStars}
          <select
            value={rateForm.stars}
            onChange={(e) => setRateForm({ ...rateForm, stars: Number(e.target.value) })}
          >
            {[5, 4, 3, 2, 1].map((n) => (
              <option key={n} value={n}>
                {n} ⭐
              </option>
            ))}
          </select>
        </label>
        <label>
          {t.ratingComment}
          <input
            value={rateForm.comment}
            onChange={(e) => setRateForm({ ...rateForm, comment: e.target.value })}
          />
        </label>
        <button type="submit" disabled={!rateForm.shipmentId}>
          {t.ratingSubmit}
        </button>
      </form>
      {rateSaved && <p className="auth-ok">{t.ratingSaved}</p>}

      <h2>{t.invoicesHeading}</h2>
      {invoices && invoices.length === 0 && <p className="muted">{t.noInvoices}</p>}
      {invoices &&
        invoices.map((inv) => (
          <div className="card" key={inv.id}>
            <strong>{inv.id}</strong>{' '}
            <a href={apiUrl(`/invoices/${inv.id}/view`)} target="_blank" rel="noreferrer">
              {t.invoiceView}
            </a>{' '}
            <span className="muted">
              {t.shipmentId} {inv.shipmentId} · {inv.subtotalEtb} + {inv.vatEtb} VAT ={' '}
              {inv.totalEtb} ETB · {new Date(inv.issuedAt).toLocaleString()}
            </span>
          </div>
        ))}
    </section>
  );
}

function DriverPanel({ t }: { t: Strings }) {
  const [operators, setOperators] = useState<Awaited<ReturnType<typeof api.listOperators>>>([]);
  const [advances, setAdvances] = useState<Awaited<ReturnType<typeof api.listAdvances>>>([]);
  const [error, setError] = useState<string | null>(null);
  const [opForm, setOpForm] = useState({
    name: '',
    phone: '+2519',
    truckPlate: '',
    capacityTons: 25,
    currentCity: 'Addis Ababa',
    licenseExpiry: '',
    insuranceExpiry: '',
  });
  const [advForm, setAdvForm] = useState({
    operatorId: '',
    shipmentId: '',
    amountEtb: 5000,
    channel: 'telebirr',
  });
  const [returnOperator, setReturnOperator] = useState('');
  const [returnLoads, setReturnLoads] = useState<ReturnLoadMatch[] | null>(null);
  const [earningsOperator, setEarningsOperator] = useState('');
  const [earnings, setEarnings] = useState<OperatorEarnings | null>(null);
  const [podForm, setPodForm] = useState({ shipmentId: '', receiverName: '', note: '' });
  const [podSaved, setPodSaved] = useState(false);
  const [eventForm, setEventForm] = useState({
    shipmentId: '',
    kind: 'in_transit',
    location: '',
  });
  const [eventSaved, setEventSaved] = useState(false);
  const [dashOperator, setDashOperator] = useState('');
  const [dashboard, setDashboard] = useState<OperatorDashboard | null>(null);
  const [docsForm, setDocsForm] = useState({
    operatorId: '',
    licenseNumber: '',
    licenseExpiry: '',
    insuranceExpiry: '',
    licenseDocUrl: '',
    insuranceDocUrl: '',
  });
  const [docsSaved, setDocsSaved] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setOperators(await api.listOperators());
      setAdvances(await api.listAdvances());
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function register(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.createOperator({
        name: opForm.name,
        phone: opForm.phone,
        truckPlate: opForm.truckPlate,
        capacityTons: Number(opForm.capacityTons),
        currentCity: city(opForm.currentCity),
        ...(opForm.licenseExpiry ? { licenseExpiry: opForm.licenseExpiry } : {}),
        ...(opForm.insuranceExpiry ? { insuranceExpiry: opForm.insuranceExpiry } : {}),
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function requestAdvance(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.requestAdvance({
        operatorId: advForm.operatorId,
        shipmentId: advForm.shipmentId,
        amountEtb: Number(advForm.amountEtb),
        channel: advForm.channel,
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function findReturnLoads(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      setReturnLoads(await api.getReturnLoads(returnOperator));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function capture(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPodSaved(false);
    try {
      await api.capturePod(
        podForm.shipmentId.trim(),
        podForm.receiverName,
        podForm.note || undefined,
      );
      setPodSaved(true);
      setPodForm({ shipmentId: '', receiverName: '', note: '' });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function loadEarnings(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      setEarnings(await api.getEarnings(earningsOperator));
    } catch (e) {
      setEarnings(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function loadDashboard(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      setDashboard(await api.getOperatorDashboard(dashOperator));
    } catch (e) {
      setDashboard(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function addEvent(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setEventSaved(false);
    try {
      await api.addTrackingEvent(
        eventForm.shipmentId.trim(),
        eventForm.kind,
        eventForm.location ? city(eventForm.location) : undefined,
      );
      setEventSaved(true);
      setEventForm({ shipmentId: '', kind: 'in_transit', location: '' });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function transition(advanceId: string, action: string) {
    setError(null);
    try {
      await api.transitionAdvance(advanceId, action);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function retry(advanceId: string) {
    setError(null);
    try {
      await api.retryPayout(advanceId);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function submitDocs(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDocsSaved(false);
    try {
      await api.submitKycDocuments(docsForm.operatorId.trim(), {
        ...(docsForm.licenseNumber ? { licenseNumber: docsForm.licenseNumber.trim() } : {}),
        ...(docsForm.licenseExpiry ? { licenseExpiry: docsForm.licenseExpiry } : {}),
        ...(docsForm.insuranceExpiry ? { insuranceExpiry: docsForm.insuranceExpiry } : {}),
        ...(docsForm.licenseDocUrl ? { licenseDocUrl: docsForm.licenseDocUrl.trim() } : {}),
        ...(docsForm.insuranceDocUrl ? { insuranceDocUrl: docsForm.insuranceDocUrl.trim() } : {}),
      });
      setDocsSaved(true);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <section>
      <h2>{t.dashboardHeading}</h2>
      <ErrorBox error={error} />
      <form onSubmit={loadDashboard} className="card row">
        <label>
          {t.operatorId}
          <select value={dashOperator} onChange={(e) => setDashOperator(e.target.value)}>
            <option value="">—</option>
            {operators.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} ({o.currentCity.name})
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={!dashOperator}>
          {t.viewDashboard}
        </button>
      </form>
      {dashboard && (
        <div className="card metric">
          <strong>{dashboard.netEtb.toLocaleString()} ETB</strong>
          <span>{t.netEarnings}</span>
          <em>
            {t.currentCity}: {dashboard.currentCity} · {dashboard.deliveredShipments}{' '}
            {t.delivered} · {t.outstandingAdvances}{' '}
            {dashboard.outstandingAdvanceEtb.toLocaleString()}
          </em>
          {dashboard.activeShipment ? (
            <em>
              {t.dashboardActiveShipment}: {dashboard.activeShipment.origin} →{' '}
              {dashboard.activeShipment.destination} ({dashboard.activeShipment.status}) ·{' '}
              {dashboard.activeShipment.shipmentId}
            </em>
          ) : (
            <em className="muted">{t.dashboardNoShipment}</em>
          )}
          {dashboard.activeAdvance && (
            <em>
              {t.fuelAdvance}: {dashboard.activeAdvance.amountEtb.toLocaleString()} ETB ·{' '}
              {dashboard.activeAdvance.status}
              {dashboard.activeAdvance.lastPayoutError
                ? ` · ${dashboard.activeAdvance.lastPayoutError}`
                : ''}
            </em>
          )}
          {dashboard.returnLoads.length > 0 && (
            <em>
              {t.returnTrips}: {dashboard.returnLoads[0]!.origin} →{' '}
              {dashboard.returnLoads[0]!.destination} ({dashboard.returnLoads[0]!.offeredPriceEtb.toLocaleString()} ETB)
            </em>
          )}
        </div>
      )}

      <h2>{t.registerTruck}</h2>
      <form onSubmit={register} className="card row">
        <label>
          {t.name}
          <input
            value={opForm.name}
            onChange={(e) => setOpForm({ ...opForm, name: e.target.value })}
          />
        </label>
        <label>
          {t.phone}
          <input
            value={opForm.phone}
            onChange={(e) => setOpForm({ ...opForm, phone: e.target.value })}
          />
        </label>
        <label>
          {t.plate}
          <input
            value={opForm.truckPlate}
            onChange={(e) => setOpForm({ ...opForm, truckPlate: e.target.value })}
          />
        </label>
        <label>
          {t.capacity}
          <input
            type="number"
            min="1"
            value={opForm.capacityTons}
            onChange={(e) => setOpForm({ ...opForm, capacityTons: Number(e.target.value) })}
          />
        </label>
        <label>
          {t.currentCity}
          <select
            value={opForm.currentCity}
            onChange={(e) => setOpForm({ ...opForm, currentCity: e.target.value })}
          >
            {CITIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          {t.licenseExpiry}
          <input
            type="date"
            value={opForm.licenseExpiry}
            onChange={(e) => setOpForm({ ...opForm, licenseExpiry: e.target.value })}
          />
        </label>
        <label>
          {t.insuranceExpiry}
          <input
            type="date"
            value={opForm.insuranceExpiry}
            onChange={(e) => setOpForm({ ...opForm, insuranceExpiry: e.target.value })}
          />
        </label>
        <button type="submit">{t.registerBtn}</button>
      </form>

      <h2>{t.fuelAdvance}</h2>
      <form onSubmit={requestAdvance} className="card row">
        <label>
          {t.operatorId}
          <input
            value={advForm.operatorId}
            onChange={(e) => setAdvForm({ ...advForm, operatorId: e.target.value })}
          />
        </label>
        <label>
          {t.shipmentId}
          <input
            value={advForm.shipmentId}
            onChange={(e) => setAdvForm({ ...advForm, shipmentId: e.target.value })}
          />
        </label>
        <label>
          {t.amount}
          <input
            type="number"
            min="1"
            value={advForm.amountEtb}
            onChange={(e) => setAdvForm({ ...advForm, amountEtb: Number(e.target.value) })}
          />
        </label>
        <label>
          {t.channel}
          <select
            value={advForm.channel}
            onChange={(e) => setAdvForm({ ...advForm, channel: e.target.value })}
          >
            <option value="telebirr">Telebirr</option>
            <option value="cbe_birr">CBE Birr</option>
          </select>
        </label>
        <button type="submit">{t.requestBtn}</button>
      </form>

      <h2>{t.returnTrips}</h2>
      <form onSubmit={findReturnLoads} className="card row">
        <label>
          {t.operatorId}
          <select value={returnOperator} onChange={(e) => setReturnOperator(e.target.value)}>
            <option value="">—</option>
            {operators.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} ({o.currentCity.name})
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={!returnOperator}>
          {t.viewReturnLoads}
        </button>
      </form>
      {returnLoads?.length === 0 && <p>{t.noReturnLoads}</p>}
      {returnLoads?.map((m) => (
        <div key={m.loadId} className="card">
          <div className="row spread">
            <strong>
              {m.origin} → {m.destination}
            </strong>
            <span>{m.offeredPriceEtb.toLocaleString()} ETB</span>
          </div>
          <div className="row">
            <span>{m.weightTons} t</span>
            <span>{m.deadheadKm} km deadhead</span>
            <span className="muted">{m.loadId}</span>
          </div>
          {m.reasons.length > 0 && <em className="muted">({m.reasons.join('; ')})</em>}
        </div>
      ))}

      <h2>{t.earningsHeading}</h2>
      <form onSubmit={loadEarnings} className="card row">
        <label>
          {t.operatorId}
          <select value={earningsOperator} onChange={(e) => setEarningsOperator(e.target.value)}>
            <option value="">—</option>
            {operators.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} ({o.currentCity.name})
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={!earningsOperator}>
          {t.viewEarnings}
        </button>
      </form>
      {earnings && (
        <div className="card metric">
          <strong>{earnings.netEtb.toLocaleString()} ETB</strong>
          <span>{t.netEarnings}</span>
          <em>
            {earnings.deliveredShipments} {t.delivered} · {t.grossEarnings}{' '}
            {earnings.grossEtb.toLocaleString()} · {t.outstandingAdvances}{' '}
            {earnings.outstandingAdvanceEtb.toLocaleString()}
          </em>
        </div>
      )}

      <h2>{t.kycDocsHeading}</h2>
      <form
        onSubmit={submitDocs}
        className="card row"
      >
        <label>
          {t.operatorId}
          <input
            value={docsForm.operatorId}
            onChange={(e) => setDocsForm({ ...docsForm, operatorId: e.target.value })}
          />
        </label>
        <label>
          {t.kycLicenseNumber}
          <input
            value={docsForm.licenseNumber}
            onChange={(e) => setDocsForm({ ...docsForm, licenseNumber: e.target.value })}
          />
        </label>
        <label>
          {t.licenseExpiry}
          <input
            type="date"
            value={docsForm.licenseExpiry}
            onChange={(e) => setDocsForm({ ...docsForm, licenseExpiry: e.target.value })}
          />
        </label>
        <label>
          {t.insuranceExpiry}
          <input
            type="date"
            value={docsForm.insuranceExpiry}
            onChange={(e) => setDocsForm({ ...docsForm, insuranceExpiry: e.target.value })}
          />
        </label>
        <label>
          {t.kycDocUrl}
          <input
            value={docsForm.licenseDocUrl}
            onChange={(e) => setDocsForm({ ...docsForm, licenseDocUrl: e.target.value })}
          />
        </label>
        <label>
          {t.kycInsuranceDocUrl}
          <input
            value={docsForm.insuranceDocUrl}
            onChange={(e) => setDocsForm({ ...docsForm, insuranceDocUrl: e.target.value })}
          />
        </label>
        <button type="submit" disabled={!docsForm.operatorId}>
          {t.kycSubmitDocs}
        </button>
      </form>
      {docsSaved && <p className="auth-ok">{t.kycDocsSaved}</p>}

      <h2>{t.trackUpdateHeading}</h2>
      <form onSubmit={addEvent} className="card row">
        <label>
          {t.shipmentId}
          <input
            value={eventForm.shipmentId}
            onChange={(e) => setEventForm({ ...eventForm, shipmentId: e.target.value })}
          />
        </label>
        <label>
          {t.eventKind}
          <select
            value={eventForm.kind}
            onChange={(e) => setEventForm({ ...eventForm, kind: e.target.value })}
          >
            <option value="picked_up">picked_up</option>
            <option value="in_transit">in_transit</option>
            <option value="at_checkpoint">at_checkpoint</option>
            <option value="delivered">delivered</option>
          </select>
        </label>
        <label>
          {t.eventLocationOptional}
          <select
            value={eventForm.location}
            onChange={(e) => setEventForm({ ...eventForm, location: e.target.value })}
          >
            <option value="">—</option>
            {CITIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={!eventForm.shipmentId}>
          {t.registerBtn}
        </button>
      </form>
      {eventSaved && <p className="auth-ok">{t.eventSaved}</p>}

      <h2>{t.podHeading}</h2>
      <form onSubmit={capture} className="card row">
        <label>
          {t.podShipment}
          <input
            value={podForm.shipmentId}
            onChange={(e) => setPodForm({ ...podForm, shipmentId: e.target.value })}
          />
        </label>
        <label>
          {t.podReceiver}
          <input
            value={podForm.receiverName}
            onChange={(e) => setPodForm({ ...podForm, receiverName: e.target.value })}
          />
        </label>
        <label>
          {t.podNote}
          <input
            value={podForm.note}
            onChange={(e) => setPodForm({ ...podForm, note: e.target.value })}
          />
        </label>
        <button type="submit" disabled={!podForm.shipmentId || !podForm.receiverName}>
          {t.podCapture}
        </button>
      </form>
      {podSaved && <p className="auth-ok">{t.podSaved}</p>}

      <h2>{t.advances}</h2>
      {advances.length === 0 && <p>{t.noAdvances}</p>}
      {advances.map((a) => (
        <div key={a.id} className="card">
          <div className="row spread">
            <strong>
              {a.amountEtb.toLocaleString()} ETB via {a.channel}
            </strong>
            <span className={`badge ${a.status}`}>{a.status}</span>
          </div>
          <div className="row">
            <span className="muted">{a.id}</span>
            {a.payoutReference && <span className="ref">{a.payoutReference}</span>}
          </div>
          {a.lastPayoutError && (
            <div className="row">
              <em className="muted">
                {t.payoutFailed} ({a.payoutAttempts ?? 1})
              </em>
            </div>
          )}
          <div className="row">
            {a.status === 'requested' && (
              <>
                <button onClick={() => transition(a.id, 'approve')}>{t.approve}</button>
                <button onClick={() => transition(a.id, 'reject')}>{t.reject}</button>
              </>
            )}
            {a.status === 'approved' && (
              <button onClick={() => transition(a.id, 'disburse')}>{t.disburse}</button>
            )}
            {a.status === 'disbursed' && (
              <button onClick={() => transition(a.id, 'recover')}>{t.markRecovered}</button>
            )}
            {a.lastPayoutError && (a.status === 'approved' || a.status === 'disbursed') && (
              <button className="danger" onClick={() => void retry(a.id)}>
                {t.retryPayout}
              </button>
            )}
          </div>
        </div>
      ))}
    </section>
  );
}

function TrackPanel({ t }: { t: Strings }) {
  const [shipmentId, setShipmentId] = useState('');
  const [events, setEvents] = useState<TrackingEvent[] | null>(null);
  const [shipment, setShipment] = useState<Shipment | null>(null);
  const [rating, setRating] = useState<Rating | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const id = shipmentId.trim();
    try {
      const [evs, shp, rt] = await Promise.all([
        api.getTracking(id),
        api.getShipment(id).catch(() => null),
        api.getShipmentRating(id).catch(() => null),
      ]);
      setEvents(evs);
      setShipment(shp);
      setRating(rt);
    } catch (err) {
      setEvents(null);
      setShipment(null);
      setRating(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <section>
      <h2>{t.liveTracking}</h2>
      <ErrorBox error={error} />
      <form onSubmit={load} className="card row">
        <label>
          {t.shipmentId}
          <input value={shipmentId} onChange={(e) => setShipmentId(e.target.value)} />
        </label>
        <button type="submit">{t.trackBtn}</button>
      </form>
      {events && (
        <ul className="timeline">
          {events.map((ev, i) => (
            <li key={i}>
              <span className="kind">{ev.kind}</span>
              <span className="muted">{new Date(ev.at).toLocaleString()}</span>
              {ev.location && <span>@ {ev.location.name}</span>}
              {ev.note && <em>{ev.note}</em>}
            </li>
          ))}
        </ul>
      )}
      {shipment && (
        <div className="card">
          <strong>{shipment.status}</strong>
          {shipment.pod && (
            <div className="muted">
              ✅ {t.podRecorded}: {shipment.pod.receiverName} ·{' '}
              {new Date(shipment.pod.capturedAt).toLocaleString()}
              {shipment.pod.note ? ` · ${shipment.pod.note}` : ''}
            </div>
          )}
          <div>
            {rating ? (
              <span>
                ⭐ {t.shipperRating}: {rating.stars}/5
                {rating.comment ? ` — ${rating.comment}` : ''}
              </span>
            ) : (
              <span className="muted">{t.notRated}</span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function MetricsPanel({ t }: { t: Strings }) {
  const [metrics, setMetrics] = useState<MarketplaceMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      setMetrics(await api.getMetrics());
    } catch (err) {
      setMetrics(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section>
      <h2>
        {t.metricsHeading}{' '}
        <button onClick={() => void load()} disabled={busy}>
          {t.refresh}
        </button>
      </h2>
      <ErrorBox error={error} />
      {metrics && (
        <div className="metrics-grid">
          <div className="card metric">
            <strong>{metrics.loads.total}</strong>
            <span>{t.loadsLabel}</span>
            <em>
              {metrics.loads.open} {t.open} · {metrics.loads.assigned} {t.assigned} ·{' '}
              {metrics.loads.delivered} {t.delivered}
            </em>
          </div>
          <div className="card metric">
            <strong>{metrics.shipments.delivered}</strong>
            <span>{t.shipmentsLabel}</span>
            <em>{metrics.shipments.total}</em>
          </div>
          <div className="card metric">
            <strong>{metrics.avgDeadheadKm}</strong>
            <span>{t.avgDeadhead}</span>
            <em>{Math.round(metrics.zeroDeadheadShare * 100)}% {t.zeroDeadheadShare}</em>
          </div>
          <div className="card metric">
            <strong>{metrics.advances.disbursedEtb}</strong>
            <span>{t.advancesDisbursed}</span>
            <em>
              telebirr {metrics.advances.byChannel.telebirr} · cbe_birr{' '}
              {metrics.advances.byChannel.cbe_birr}
            </em>
          </div>
          <div className="card metric">
            <strong>{metrics.vat.totalVatEtb}</strong>
            <span>{t.vatCollected}</span>
            <em>{metrics.vat.invoiceCount} · {metrics.vat.totalWithVatEtb} ETB</em>
          </div>
        </div>
      )}
      {!metrics && !error && busy && <p className="muted">…</p>}
      {error && <p className="muted">{t.metricsAdminNote}</p>}
    </section>
  );
}

function KycPanel({ t }: { t: Strings }) {
  const [queue, setQueue] = useState<KycReview[] | null>(null);
  const [audit, setAudit] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      setQueue(await api.getKycQueue());
      setAudit(await api.getAuditLog());
    } catch (err) {
      setQueue(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section>
      <h2>
        {t.kycHeading}{' '}
        <button onClick={() => void load()} disabled={busy}>
          {t.refresh}
        </button>
      </h2>
      <ErrorBox error={error} />
      {queue && queue.length === 0 && <p className="muted">{t.kycEmpty}</p>}
      {queue &&
        queue.map((r) => <KycCard key={r.operatorId} t={t} review={r} onReviewed={() => void load()} />)}
      {!queue && !error && busy && <p className="muted">…</p>}
      {error && <p className="muted">{t.metricsAdminNote}</p>}
      <h2>{t.auditHeading}</h2>
      {audit && audit.length === 0 && <p className="muted">…</p>}
      {audit &&
        audit.slice(0, 20).map((entry) => (
          <div className="card" key={entry.id}>
            <strong>{entry.action}</strong>{' '}
            <span className="muted">
              {entry.actorRole}:{entry.actorId} · {entry.target}
              {entry.detail ? ` · ${entry.detail}` : ''} ·{' '}
              {new Date(entry.at).toLocaleString()}
            </span>
          </div>
        ))}
      <WebhooksSection t={t} />
    </section>
  );
}

const WEBHOOK_EVENTS = [
  'shipment.assigned',
  'shipment.picked_up',
  'shipment.delivered',
  'load.cancelled',
  'operator.kyc_expiring',
] as const;

function WebhooksSection({ t }: { t: Strings }) {
  const [hooks, setHooks] = useState<Webhook[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newUrl, setNewUrl] = useState('');
  const [newEvents, setNewEvents] = useState<string[]>([]);

  const loadHooks = useCallback(async () => {
    setError(null);
    try {
      setHooks(await api.listWebhooks());
    } catch (err) {
      setHooks(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void loadHooks();
  }, [loadHooks]);

  const toggle = async (id: string) => {
    setError(null);
    if (openId === id) {
      setOpenId(null);
      return;
    }
    try {
      setDeliveries(await api.getDeliveries(id));
      setOpenId(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const retry = async (deliveryId: string) => {
    setError(null);
    try {
      await api.retryDelivery(deliveryId);
      if (openId) setDeliveries(await api.getDeliveries(openId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const register = async () => {
    setError(null);
    if (newUrl.trim() === '') return;
    try {
      await api.createWebhook(newUrl.trim(), newEvents);
      setNewUrl('');
      setNewEvents([]);
      await loadHooks();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const remove = async (id: string) => {
    setError(null);
    try {
      await api.deleteWebhook(id);
      if (openId === id) {
        setOpenId(null);
        setDeliveries([]);
      }
      await loadHooks();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div>
      <h2>
        {t.webhooksHeading}{' '}
        <button onClick={() => void loadHooks()}>{t.refresh}</button>
      </h2>
      <ErrorBox error={error} />
      <div className="card">
        <strong>{t.webhookRegister}</strong>
        <div>
          <input
            type="url"
            placeholder={t.webhookUrl}
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
          />
        </div>
        <div>
          {WEBHOOK_EVENTS.map((event) => (
            <label key={event} style={{ marginRight: '0.75rem' }}>
              <input
                type="checkbox"
                checked={newEvents.includes(event)}
                onChange={(e) =>
                  setNewEvents((prev) =>
                    e.target.checked ? [...prev, event] : prev.filter((x) => x !== event),
                  )
                }
              />{' '}
              {event}
            </label>
          ))}
        </div>
        <button onClick={() => void register()} disabled={newUrl.trim() === ''}>
          {t.webhookRegister}
        </button>
        <p className="muted">{t.webhookAllEventsHint}</p>
      </div>
      {hooks && hooks.length === 0 && <p className="muted">…</p>}
      {hooks &&
        hooks.map((hook) => (
          <div className="card" key={hook.id}>
            <strong>{hook.url}</strong>{' '}
            <span className="muted">
              {hook.events.length > 0 ? hook.events.join(', ') : t.webhooksAllEvents}
            </span>{' '}
            <button onClick={() => void toggle(hook.id)}>
              {t.deliveriesLabel}
            </button>{' '}
            <button onClick={() => void remove(hook.id)}>{t.webhookDelete}</button>
            {openId === hook.id && (
              <div>
                {deliveries.length === 0 && <p className="muted">…</p>}
                {deliveries.map((d) => (
                  <div key={d.id}>
                    <strong>{d.ok ? `✅ ${t.deliveryOk}` : `⛔ ${t.deliveryFailed}`}</strong>{' '}
                    <span className="muted">
                      {d.event} · {d.ok ? d.statusCode : d.error} · {d.attemptCount}× ·{' '}
                      {new Date(d.attemptedAt).toLocaleString()}
                    </span>{' '}
                    {!d.ok && (
                      <button onClick={() => void retry(d.id)}>{t.retryDelivery}</button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
    </div>
  );
}

function KycCard({
  t,
  review,
  onReviewed,
}: {
  t: Strings;
  review: KycReview;
  onReviewed: () => void;
}) {
  const [license, setLicense] = useState(review.licenseExpiry ?? '');
  const [insurance, setInsurance] = useState(review.insuranceExpiry ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const statusLabel =
    review.status === 'valid'
      ? t.kycValid
      : review.status === 'expired'
        ? t.kycExpired
        : review.status === 'rejected'
          ? t.kycRejected
          : t.kycUnverified;

  const submit = async (decision: string) => {
    setBusy(true);
    setError(null);
    try {
      await api.reviewKyc(
        review.operatorId,
        decision,
        license.trim() === '' ? undefined : license.trim(),
        insurance.trim() === '' ? undefined : insurance.trim(),
      );
      onReviewed();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <strong>{review.operatorName}</strong> <span className="muted">{review.truckPlate}</span>
      <div>
        <em>{statusLabel}</em> <span className="muted">· {review.decision}</span>
      </div>
      {review.issues.length > 0 && (
        <ul>
          {review.issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}
      {review.expiring.length > 0 && (
        <ul>
          {review.expiring.map((warning) => (
            <li key={warning}>⏳ {warning}</li>
          ))}
        </ul>
      )}
      {(review.licenseNumber || review.licenseDocUrl || review.insuranceDocUrl) && (
        <div className="muted">
          {review.licenseNumber && <div>🪪 {review.licenseNumber}</div>}
          {review.licenseDocUrl && (
            <div>
              <a href={review.licenseDocUrl} target="_blank" rel="noreferrer">
                {t.kycDocUrl}
              </a>
            </div>
          )}
          {review.insuranceDocUrl && (
            <div>
              <a href={review.insuranceDocUrl} target="_blank" rel="noreferrer">
                {t.kycInsuranceDocUrl}
              </a>
            </div>
          )}
        </div>
      )}
      <label>
        {t.licenseExpiry}{' '}
        <input type="date" value={license} onChange={(e) => setLicense(e.target.value)} />
      </label>{' '}
      <label>
        {t.insuranceExpiry}{' '}
        <input type="date" value={insurance} onChange={(e) => setInsurance(e.target.value)} />
      </label>{' '}
      <button onClick={() => void submit('approved')} disabled={busy}>
        {t.kycApprove}
      </button>{' '}
      <button onClick={() => void submit('rejected')} disabled={busy}>
        {t.kycReject}
      </button>
      <ErrorBox error={error} />
    </div>
  );
}

function AgentPanel({ t, lang }: { t: Strings; lang: Lang }) {
  const [messages, setMessages] = useState<
    Array<{ role: 'user' | 'assistant'; content: string }>
  >([{ role: 'assistant', content: t.greeting }]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);

  const voice = useVoiceInput(lang, (text) => setInput((current) => (current ? `${current} ${text}` : text)));

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const message = input.trim();
    if (!message || busy) return;
    setBusy(true);
    setInput('');
    setMessages((m) => [...m, { role: 'user', content: message }]);
    try {
      const result = await api.chat(message, {}, lang);
      setMessages((m) => [...m, { role: 'assistant', content: result.reply }]);
    } catch (err) {
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: err instanceof Error ? err.message : String(err) },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2>{t.agentHeading}</h2>
      <div className="chat card">
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.content}
          </div>
        ))}
        {busy && <div className="msg assistant muted">…</div>}
      </div>
      <form onSubmit={send} className="row">
        <input
          value={input}
          placeholder={t.agentPlaceholder}
          onChange={(e) => setInput(e.target.value)}
        />
        {voice.supported && (
          <button
            type="button"
            className={voice.listening ? 'mic listening' : 'mic'}
            title={voice.listening ? t.listening : t.mic}
            aria-label={voice.listening ? t.listening : t.mic}
            onClick={() => (voice.listening ? voice.stop() : voice.start())}
          >
            {voice.listening ? '◉' : '🎤'}
          </button>
        )}
        <button type="submit" disabled={busy}>
          {t.send}
        </button>
      </form>
      {voice.error === 'unsupported' && <p className="muted">{t.voiceUnsupported}</p>}
    </section>
  );
}
