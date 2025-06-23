// server.js (2-leg + 1-leg support using data.json)
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const twilio = require('twilio');
const fs = require('fs');
const cors = require('cors');
const path = require('path');


app.use(cors({
  origin: 'https://twilio-hubspot.vercel.app', // your frontend URL
  methods: ['GET','POST','OPTIONS','DELETE','PUT','PATCH'],
  allowedHeaders: ['Content-Type'],
  credentials: true
}));

// OR for testing, allow all origins:
// app.use(cors());

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);


const AccessToken = twilio.jwt.AccessToken;
const VoiceGrant = AccessToken.VoiceGrant;

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const { HUBSPOT_PRIVATE_APP_TOKEN, BASE_URL, TWIML_APP_SID } = process.env;

async function getData() {
  const [twilioRes, agentsRes, configsRes] = await Promise.all([
    supabase.from('twilio_numbers').select('*'),
    supabase.from('agents').select('*'),
    supabase.from('agent_configs').select('*')
  ]);

  return {
    twilioNumbers: twilioRes.data || [],
    agents: agentsRes.data || [],
    agentConfigs: configsRes.data || []
  };
}


function respondError(res, status, message) {
  return res.status(status).json({ error: message });
}

// 🔐 Token generation for 1-leg call (Twilio Client in browser)
app.get('/token', (req, res) => {
  const agentName = req.query.agent;
  if (!agentName) return respondError(res, 400, 'Missing agent name');

  const data = getData();
  const agentCfg = data.agentConfigs.find(cfg => cfg.agent === agentName && cfg.type === '1-leg');
  const twilioInfo = data.twilioNumbers.find(t => t.number === agentCfg?.twilioNumber);

  if (!agentCfg || !twilioInfo) return respondError(res, 403, 'Invalid agent config for token');

  const token = new AccessToken(twilioInfo.sid, twilioInfo.token, twilioInfo.token);
  token.identity = agentName;
  const grant = new VoiceGrant({
    outgoingApplicationSid: twilioInfo.twimlAppSid || TWIML_APP_SID || '',
    incomingAllow: true
  });
  token.addGrant(grant);

  res.json({ identity: agentName, token: token.toJwt() });
});

// 🗣 TwiML response for browser-originated (1-leg) call (customer number from HubSpot)
app.post('/voice', async (req, res) => {
  const contactId = req.body.contactId;
  const agentName = req.body.agent;
  const useMobile = req.body.useMobile === 'true';

  if (!contactId || !agentName) return res.status(400).send('Missing contactId or agent');

  try {
    const contactResp = await axios.get(`https://api.hubapi.com/crm/v3/objects/contacts/${contactId}`, {
      params: { properties: 'phone,mobilephone' },
      headers: { Authorization: `Bearer ${HUBSPOT_PRIVATE_APP_TOKEN}` }
    });
    const contact = contactResp.data.properties;
    const to = useMobile ? contact.mobilephone : contact.phone;

    const data = getData();
    const agentCfg = data.agentConfigs.find(cfg => cfg.agent === agentName);
    const twilioInfo = data.twilioNumbers.find(t => t.number === agentCfg?.twilioNumber);

    if (!to || !twilioInfo) return res.status(403).send('Missing customer number or Twilio info');

    const twiml = new twilio.twiml.VoiceResponse();
    const dial = twiml.dial({ callerId: twilioInfo.number });
    dial.number({}, to);

    res.type('text/xml').send(twiml.toString());
  } catch (err) {
    console.error('❌ /voice error:', err.message);
    res.status(500).send('<Response><Say>Error retrieving contact number</Say></Response>');
  }
});

// 📞 Main webhook for contact-triggered call to regular phone
app.post('/start-phone-call', async (req, res) => {
  await initiateCall(req, res, false);
});

// 📱 Main webhook for contact-triggered call to mobile phone
app.post('/start-mobile-call', async (req, res) => {
  await initiateCall(req, res, true);
});

// Shared logic for both phone and mobile
async function initiateCall(req, res, useMobile) {
  const contactId = req.body.hs_object_id || req.body.contactId || req.query.contactId;
  if (!contactId) return respondError(res, 400, 'Missing contact ID');

  try {
    const contactResp = await axios.get(`https://api.hubapi.com/crm/v3/objects/contacts/${contactId}`, {
      params: { properties: 'phone,mobilephone,hubspot_owner_id,assigned_agent_name' },
      headers: { Authorization: `Bearer ${HUBSPOT_PRIVATE_APP_TOKEN}` }
    });

    const contact = contactResp.data.properties;
    const to = useMobile ? contact.mobilephone : contact.phone;
    const agentName = contact.assigned_agent_name || contact.hubspot_owner_id;
    const data = getData();
    const agentCfg = data.agentConfigs.find(cfg => cfg.agent === agentName);
    const agent = data.agents.find(a => a.name === agentCfg?.agent);
    const twilioInfo = data.twilioNumbers.find(t => t.number === agentCfg?.twilioNumber);

    if (!to || !agent || !twilioInfo || agentCfg.type !== '2-leg') {
      return respondError(res, 403, 'Missing or invalid agent/twilio config for 2-leg');
    }

    const twilioClient = twilio(twilioInfo.sid, twilioInfo.token);
    const twimlUrl = `${BASE_URL}/connect-call?contactId=${contactId}&ownerId=${agentName}&to=${encodeURIComponent(to)}&from=${twilioInfo.number}`;

    await twilioClient.calls.create({
      from: twilioInfo.number,
      to: agent.phone,
      url: twimlUrl,
      method: 'GET'
    });

    res.json({ message: `2-leg ${useMobile ? 'mobile' : 'phone'} call started` });
  } catch (err) {
    console.error(err.response?.data || err.message);
    respondError(res, 500, '2-leg call failed');
  }
}

// 🔄 Bridge agent (answered) to customer
app.all('/connect-call', (req, res) => {
  const { contactId, ownerId, to, from } = req.query;

  if (!to || !contactId || !ownerId || !from) {
    return res.status(400).type('text/xml').send('<Response><Say>Call failed due to missing data</Say></Response>');
  }

  const voice = new twilio.twiml.VoiceResponse();
  voice.dial({
    callerId: from,
    record: 'record-from-answer',
    recordingStatusCallback: `${BASE_URL}/recording-callback?contactId=${contactId}&ownerId=${ownerId}`,
    recordingStatusCallbackMethod: 'POST',
    recordingStatusCallbackEvent: 'completed'
  }).number(to);

  res.type('text/xml').send(voice.toString());
});

// 💾 Log recording engagement
app.post('/recording-callback', async (req, res) => {
  const { contactId, ownerId } = req.query;
  let recordingUrl = req.body.RecordingUrl ? req.body.RecordingUrl + '.mp3' : '';
  const durationMs = (parseInt(req.body.RecordingDuration || '0') || 0) * 1000;
  const startTime = new Date(Date.now() - durationMs).toISOString();

  const payload = {
    hs_timestamp: startTime,
    hs_call_title: 'Outbound call via Twilio',
    hs_call_body: recordingUrl ? `Recording: ${recordingUrl}` : 'Call completed',
    hs_call_duration: durationMs.toString(),
    hs_call_status: 'COMPLETED',
    hs_call_direction: 'OUTBOUND',
    hs_call_from_number: req.body.From,
    hs_call_to_number: req.body.To,
    hubspot_owner_id: ownerId
  };

  try {
    const callResp = await axios.post('https://api.hubapi.com/crm/v3/objects/calls',
      { properties: payload },
      { headers: { Authorization: `Bearer ${HUBSPOT_PRIVATE_APP_TOKEN}` } });

    const callId = callResp.data.id;
    if (callId && contactId) {
      const assocUrl = `https://api.hubapi.com/crm/v3/objects/calls/${callId}/associations/contacts/${contactId}/call_to_contact`;
      await axios.put(assocUrl, {}, { headers: { Authorization: `Bearer ${HUBSPOT_PRIVATE_APP_TOKEN}` } });
    }
  } catch (err) {
    console.error('❌ Error logging call in HubSpot:', err.response?.data || err.message);
  }

  res.sendStatus(200);
});

// Frontend config endpoints
// ✅ Read all
app.get('/config/all', async (req, res) => {
  try {
    const data = await getData();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch data' });
  }
});

// ✅ Overwrite all
app.post('/config/all', async (req, res) => {
  const incoming = req.body;

  try {
    // Clear and repopulate each table
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
    console.error('❌ Supabase write error:', err.message);
    res.status(500).json({ error: 'Failed to update config' });
  }
});

module.exports = app;
