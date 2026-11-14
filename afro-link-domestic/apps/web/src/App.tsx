import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import type { Load, OperatorMatch, TrackingEvent } from './types';

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

  return (
    <div className="app">
      <header>
        <h1>
          Afro-Link Domestic <span className="am">አፍሮ-ሊንክ ዶሜስቲክ</span>
        </h1>
        <p className="tagline">
          Ethiopia's AI-powered freight marketplace · part of DomesticHub
        </p>
        <nav>
          {(
            [
              ['shipper', 'Shipper · አቅራቢ'],
              ['driver', 'Driver · ሹፌር'],
              ['track', 'Tracking · ክትትል'],
              ['agent', 'AI Agent'],
            ] as Array<[Tab, string]>
          ).map(([id, label]) => (
            <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </nav>
      </header>
      <main>
        {tab === 'shipper' && <ShipperPanel />}
        {tab === 'driver' && <DriverPanel />}
        {tab === 'track' && <TrackPanel />}
        {tab === 'agent' && <AgentPanel />}
      </main>
    </div>
  );
}

function ErrorBox({ error }: { error: string | null }) {
  if (!error) return null;
  return <div className="error">⚠️ {error}</div>;
}

function ShipperPanel() {
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
        setError('No available trucks for this load.');
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
      <h2>Post a load · ጭነት ይላኩ</h2>
      <ErrorBox error={error} />
      <form onSubmit={submit} className="card row">
        <label>
          Shipper ID
          <input
            value={form.shipperId}
            onChange={(e) => setForm({ ...form, shipperId: e.target.value })}
          />
        </label>
        <label>
          From
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
          To
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
          Tons
          <input
            type="number"
            min="1"
            step="0.5"
            value={form.weightTons}
            onChange={(e) => setForm({ ...form, weightTons: Number(e.target.value) })}
          />
        </label>
        <label>
          Price (ETB)
          <input
            type="number"
            min="1"
            value={form.offeredPriceEtb}
            onChange={(e) => setForm({ ...form, offeredPriceEtb: Number(e.target.value) })}
          />
        </label>
        <button type="submit">Post load</button>
      </form>

      <h2>Loads · ጭነቶች</h2>
      {loads.length === 0 && <p>No loads yet.</p>}
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
            <button onClick={() => findMatches(load.id)}>Find matches</button>
            {load.status === 'open' && (
              <button onClick={() => assignTop(load.id)}>Assign top match</button>
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

function DriverPanel() {
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
      <h2>Register truck · መኪና ያስመዝግቡ</h2>
      <ErrorBox error={error} />
      <form onSubmit={register} className="card row">
        <label>
          Name
          <input
            value={opForm.name}
            onChange={(e) => setOpForm({ ...opForm, name: e.target.value })}
          />
        </label>
        <label>
          Phone
          <input
            value={opForm.phone}
            onChange={(e) => setOpForm({ ...opForm, phone: e.target.value })}
          />
        </label>
        <label>
          Plate
          <input
            value={opForm.truckPlate}
            onChange={(e) => setOpForm({ ...opForm, truckPlate: e.target.value })}
          />
        </label>
        <label>
          Capacity (t)
          <input
            type="number"
            min="1"
            value={opForm.capacityTons}
            onChange={(e) => setOpForm({ ...opForm, capacityTons: Number(e.target.value) })}
          />
        </label>
        <label>
          Current city
          <select
            value={opForm.currentCity}
            onChange={(e) => setOpForm({ ...opForm, currentCity: e.target.value })}
          >
            {CITIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <button type="submit">Register</button>
      </form>

      <h2>Fuel advance · የነዳጅ ቅድመ ክፍያ</h2>
      <form onSubmit={requestAdvance} className="card row">
        <label>
          Operator ID
          <input
            value={advForm.operatorId}
            onChange={(e) => setAdvForm({ ...advForm, operatorId: e.target.value })}
          />
        </label>
        <label>
          Shipment ID
          <input
            value={advForm.shipmentId}
            onChange={(e) => setAdvForm({ ...advForm, shipmentId: e.target.value })}
          />
        </label>
        <label>
          Amount (ETB)
          <input
            type="number"
            min="1"
            value={advForm.amountEtb}
            onChange={(e) => setAdvForm({ ...advForm, amountEtb: Number(e.target.value) })}
          />
        </label>
        <label>
          Channel
          <select
            value={advForm.channel}
            onChange={(e) => setAdvForm({ ...advForm, channel: e.target.value })}
          >
            <option value="telebirr">Telebirr</option>
            <option value="cbe_birr">CBE Birr</option>
          </select>
        </label>
        <button type="submit">Request</button>
      </form>

      <h2>Advances</h2>
      {advances.length === 0 && <p>No advances yet.</p>}
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
                <button onClick={() => transition(a.id, 'approve')}>Approve</button>
                <button onClick={() => transition(a.id, 'reject')}>Reject</button>
              </>
            )}
            {a.status === 'approved' && (
              <button onClick={() => transition(a.id, 'disburse')}>Disburse</button>
            )}
            {a.status === 'disbursed' && (
              <button onClick={() => transition(a.id, 'recover')}>Mark recovered</button>
            )}
          </div>
        </div>
      ))}
    </section>
  );
}

function TrackPanel() {
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
      <h2>Live tracking · ቀጥታ ክትትል</h2>
      <ErrorBox error={error} />
      <form onSubmit={load} className="card row">
        <label>
          Shipment ID
          <input value={shipmentId} onChange={(e) => setShipmentId(e.target.value)} />
        </label>
        <button type="submit">Track</button>
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

function AgentPanel() {
  const [messages, setMessages] = useState<
    Array<{ role: 'user' | 'assistant'; content: string }>
  >([
    {
      role: 'assistant',
      content:
        'ሰላም! I am the Domestic AI Agent. Try: "Post 20 tons of coffee from Jimma to Addis Ababa for 40000 birr"',
    },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);

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
      <h2>Domestic AI Agent</h2>
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
          placeholder="Post a load, find trucks, request a fuel advance…"
          onChange={(e) => setInput(e.target.value)}
        />
        <button type="submit" disabled={busy}>
          Send
        </button>
      </form>
    </section>
  );
}
