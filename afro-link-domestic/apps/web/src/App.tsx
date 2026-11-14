import { useCallback, useEffect, useState } from 'react';
import { api, getAuthToken, setAuthToken } from './api';
import { Lang, loadLang, saveLang, STRINGS, Strings } from './i18n';
import { useVoiceInput } from './useVoiceInput';
import type { Load, OperatorMatch, ReturnLoadMatch, TrackingEvent } from './types';

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

type Tab = 'shipper' | 'driver' | 'track' | 'agent';

export default function App() {
  const [tab, setTab] = useState<Tab>('shipper');
  const [lang, setLang] = useState<Lang>(loadLang);
  const [token, setToken] = useState(getAuthToken() ?? '');
  const t = STRINGS[lang];

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
          <div className="lang-toggle">
            <button className={lang === 'en' ? 'active' : ''} onClick={() => applyLang('en')}>
              EN
            </button>
            <button className={lang === 'am' ? 'active' : ''} onClick={() => applyLang('am')}>
              አማ
            </button>
          </div>
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
        </div>
        <nav>
          {(
            [
              ['shipper', t.tabShipper],
              ['driver', t.tabDriver],
              ['track', t.tabTrack],
              ['agent', t.tabAgent],
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

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
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
      </form>

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
          </div>
          {matches[load.id] && (
            <ol className="matches">
              {matches[load.id]!.map((m) => (
                <li key={m.operatorId}>
                  <strong>{m.operatorName}</strong> — score {m.score}, {m.deadheadKm} km deadhead
                  {m.reasons.length > 0 && <em> ({m.reasons.join('; ')})</em>}
                </li>
              ))}
            </ol>
          )}
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
  });
  const [advForm, setAdvForm] = useState({
    operatorId: '',
    shipmentId: '',
    amountEtb: 5000,
    channel: 'telebirr',
  });
  const [returnOperator, setReturnOperator] = useState('');
  const [returnLoads, setReturnLoads] = useState<ReturnLoadMatch[] | null>(null);

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

  async function transition(advanceId: string, action: string) {
    setError(null);
    try {
      await api.transitionAdvance(advanceId, action);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <section>
      <h2>{t.registerTruck}</h2>
      <ErrorBox error={error} />
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
          </div>
        </div>
      ))}
    </section>
  );
}

function TrackPanel({ t }: { t: Strings }) {
  const [shipmentId, setShipmentId] = useState('');
  const [events, setEvents] = useState<TrackingEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      setEvents(await api.getTracking(shipmentId.trim()));
    } catch (err) {
      setEvents(null);
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
    </section>
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
      const result = await api.chat(message);
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
