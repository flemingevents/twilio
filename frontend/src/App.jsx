// App.js (React frontend for Twilio + HubSpot config)
import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import './App.css';

const App = () => (
  <Router>
    <div className="layout-full">
      <header className="app-header">
        <h1>📞 Twilio + HubSpot Config</h1>
        <nav>
          <Link to="/twilio-numbers">Twilio Numbers</Link>
          <Link to="/agents">Sales Agents</Link>
          <Link to="/assignments">Agent Assignments</Link>
        </nav>
      </header>
      <main className="main-content">
        <Routes>
          <Route path="/twilio-numbers" element={<TwilioNumbers />} />
          <Route path="/agents" element={<Agents />} />
          <Route path="/assignments" element={<Assignments />} />
          <Route path="*" element={<TwilioNumbers />} />
        </Routes>
      </main>
    </div>
  </Router>
);

const validatePhoneNumber = (phone) => /^\+?[1-9]\d{1,14}$/.test(phone);

const apiBase = 'https://twilio-gbq8.vercel.app/api';

function useFetchConfig() {
  const [data, setData] = React.useState({ twilioNumbers: [], agents: [], agentConfigs: [] });

  const refresh = () => {
    fetch(`${apiBase}/config/all`).then(res => res.json()).then(setData);
  };

  React.useEffect(refresh, []);
  return [data, refresh];
}

function TwilioNumbers() {
  const [data, refresh] = useFetchConfig();
  const [form, setForm] = React.useState({ sid: '', token: '', number: '' });

  const add = async () => {
    if (!form.sid || !form.token || !form.number) return alert('All fields required');
    if (!validatePhoneNumber(form.number)) return alert('Invalid phone format');
    await fetch(`${apiBase}/config/all`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ twilioNumbers: [...data.twilioNumbers, form] })
    });
    setForm({ sid: '', token: '', number: '' });
    refresh();
  };

  const remove = async (sid) => {
    await fetch(`${apiBase}/config/all`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ twilioNumbers: data.twilioNumbers.filter(t => t.sid !== sid) })
    });
    refresh();
  };

  return (
    <section className="section">
      <h2>📞 Twilio Numbers</h2>
      <div className="form-row">
        <input placeholder="SID" value={form.sid} onChange={e => setForm({ ...form, sid: e.target.value })} />
        <input placeholder="Token" value={form.token} onChange={e => setForm({ ...form, token: e.target.value })} />
        <input placeholder="Phone (+1234567890)" value={form.number} onChange={e => setForm({ ...form, number: e.target.value })} />
        <button onClick={add}>Add</button>
      </div>
      <table>
        <thead><tr><th>Phone</th><th>SID</th><th>Action</th></tr></thead>
        <tbody>
          {data.twilioNumbers.map(t => (
            <tr key={t.sid}><td>{t.number}</td><td>{t.sid}</td><td><button onClick={() => remove(t.sid)}>Delete</button></td></tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Agents() {
  const [data, refresh] = useFetchConfig();
  const [form, setForm] = React.useState({ name: '', phone: '' });

  const add = async () => {
    if (!form.name || !form.phone) return alert('All fields required');
    if (!validatePhoneNumber(form.phone)) return alert('Invalid phone format');
    await fetch(`${apiBase}/config/all`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agents: [...data.agents, form] })
    });
    setForm({ name: '', phone: '' });
    refresh();
  };

  const remove = async (name) => {
    await fetch(`${apiBase}/config/all`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agents: data.agents.filter(a => a.name !== name) })
    });
    refresh();
  };

  return (
    <section className="section">
      <h2>👤 Sales Agents</h2>
      <div className="form-row">
        <input placeholder="Name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
        <input placeholder="Phone (+1234567890)" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
        <button onClick={add}>Add</button>
      </div>
      <table>
        <thead><tr><th>Name</th><th>Phone</th><th>Action</th></tr></thead>
        <tbody>
          {data.agents.map(a => (
            <tr key={a.name}><td>{a.name}</td><td>{a.phone}</td><td><button onClick={() => remove(a.name)}>Delete</button></td></tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Assignments() {
  const [data, refresh] = useFetchConfig();
  const [form, setForm] = React.useState({ agent: '', type: '2-leg', twilioNumber: '' });

  const add = async () => {
    if (!form.agent || !form.twilioNumber) return;
    await fetch(`${apiBase}/config/all`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentConfigs: [...data.agentConfigs, form] })
    });
    setForm({ agent: '', type: '2-leg', twilioNumber: '' });
    refresh();
  };

  const remove = async (index) => {
    const updated = data.agentConfigs.filter((_, i) => i !== index);
    await fetch(`${apiBase}/config/all`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentConfigs: updated })
    });
    refresh();
  };

  return (
    <section className="section">
      <h2>🔁 Agent Assignments</h2>
      <div className="form-row">
        <select value={form.agent} onChange={e => setForm({ ...form, agent: e.target.value })}>
          <option value="">Select Agent</option>
          {data.agents.map(a => <option key={a.name} value={a.name}>{a.name}</option>)}
        </select>
        <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
          <option value="1-leg">1-leg</option>
          <option value="2-leg">2-leg</option>
        </select>
        <select value={form.twilioNumber} onChange={e => setForm({ ...form, twilioNumber: e.target.value })}>
          <option value="">Select Twilio</option>
          {data.twilioNumbers.map(t => <option key={t.number} value={t.number}>{t.number}</option>)}
        </select>
        <button onClick={add}>Assign</button>
      </div>
      <table>
        <thead><tr><th>Agent</th><th>Type</th><th>Twilio</th><th>Action</th></tr></thead>
        <tbody>
          {data.agentConfigs.map((cfg, i) => (
            <tr key={i}><td>{cfg.agent}</td><td>{cfg.type}</td><td>{cfg.twilioNumber}</td><td><button onClick={() => remove(i)}>Delete</button></td></tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

createRoot(document.getElementById('root')).render(<App />);
export default App;
