require('dotenv').config();
const express = require('express');
const axios = require('axios');
const twilio = require('twilio');
const fs = require('fs');
const cors = require('cors');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express(); // ✅ define this FIRST

// ✅ CORS setup (replace with your frontend domain)
app.use(cors({
  origin: 'https://twilio-hubspot.vercel.app',
  methods: ['GET', 'POST', 'OPTIONS', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type'],
  credentials: true
}));

app.options('*', cors()); // preflight

app.use(express.json());
app.use(express.urlencoded({ extended: true }));


// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Utility: fetch data from Supabase
async function getData() {
  const [twilioRes, agentsRes, configsRes] = await Promise.all([
    supabase.from('twilio_numbers').select('*'),
    supabase.from('agents').select('*'),
    supabase.from('agent_configs').select('*'),
  ]);

  return {
    twilioNumbers: twilioRes.data || [],
    agents: agentsRes.data || [],
    agentConfigs: configsRes.data || [],
  };
}

// Utility: standardized error response
function respondError(res, status, message) {
  return res.status(status).json({ error: message });
}

// --- ✅ Routes & Logic ---

// 1-leg Twilio client token
app.get('/token', async (req, res) => {
  const agentName = req.query.agent;
  if (!agentName) return respondError(res, 400, 'Missing agent name');

  const data = await getData();
  const cfg = data.agentConfigs.find(c => c.agent === agentName && c.type === '1-leg');
  const tw = data.twilioNumbers.find(t => t.number === cfg?.twilioNumber);
  if (!cfg || !tw) return respondError(res, 403, 'Invalid config for token');

  const AccessToken = twilio.jwt.AccessToken;
  const VoiceGrant = AccessToken.VoiceGrant;
  const token = new AccessToken(tw.sid, tw.token, tw.token);
  token.identity = agentName;
  token.addGrant(new VoiceGrant({
    outgoingApplicationSid: tw.twimlAppSid || process.env.TWIML_APP_SID || '',
    incomingAllow: true,
  }));

  res.json({ identity: agentName, token: token.toJwt() });
});

// Config endpoints: GET all
app.get('/api/config/all', async (req, res) => {
  try {
    const data = await getData();
    res.json(data);
  } catch (err) {
    console.error(err);
    respondError(res, 500, 'Failed to fetch config');
  }
});

// Config endpoints: POST replace
app.post('/api/config/all', async (req, res) => {
  const incoming = req.body;
  try {
    if (incoming.twilioNumbers) {
      await supabase.from('twilio_numbers').delete().neq('id', -1);
      await supabase.from('twilio_numbers').insert(incoming.twilioNumbers);
    }
    if (incoming.agents) {
      await supabase.from('agents').delete().neq('id', -1);
      await supabase.from('agents').insert(incoming.agents);
    }
    if (incoming.agentConfigs) {
      await supabase.from('agent_configs').delete().neq('id', -1);
      await supabase.from('agent_configs').insert(incoming.agentConfigs);
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Supabase write error:', err);
    respondError(res, 500, 'Failed to update config');
  }
});

// All other routes left untouched...

module.exports = app;

// Wrap with serverless-http for Vercel
module.exports.handler = serverless(app);
