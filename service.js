// Node.js Express server integrating Twilio and HubSpot for click-to-call functionality
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const twilio = require('twilio');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Load and validate required environment variables
const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_NUMBER,
  HUBSPOT_PRIVATE_APP_TOKEN,
  BASE_URL,
  AGENT_PHONE_MAP,
  // WEBHOOK_SECRET
} = process.env;

if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_NUMBER || !HUBSPOT_PRIVATE_APP_TOKEN || !BASE_URL || !AGENT_PHONE_MAP) {
  console.error('Error: Missing required environment variables. Please check your .env configuration.');
  process.exit(1);
}

// Initialize Twilio REST client and parse the agent phone map
const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
let agentPhoneMap;
try {
  agentPhoneMap = JSON.parse(AGENT_PHONE_MAP);
} catch (e) {
  console.error('Error: AGENT_PHONE_MAP is not valid JSON.');
  process.exit(1);
}

// Utility function to send error responses in a consistent format
function respondError(res, status, message) {
  return res.status(status).json({ error: message });
}

// Optional security middleware: verify a secret token on incoming requests (to ensure it's from HubSpot)
// app.use((req, res, next) => {
//   if (WEBHOOK_SECRET) {
//     const provided = req.headers['x-webhook-secret'] || req.headers['authorization'];
//     if (provided !== WEBHOOK_SECRET) {
//       return respondError(res, 403, 'Forbidden: Invalid webhook secret');
//     }
//   }
//   next();
// });

// Helper function to initiate a Twilio call to the agent and set up bridging to the contact
async function initiateCall(contactId, useMobile, res) {
  try {
    // Fetch contact details from HubSpot (phone, mobile, and ownerId)
    const hubspotResp = await axios.get(`https://api.hubapi.com/crm/v3/objects/contacts/${contactId}`, {
      params: { properties: 'phone,mobilephone,hubspot_owner_id' },
      headers: { Authorization: `Bearer ${HUBSPOT_PRIVATE_APP_TOKEN}` }
    });
    const contact = hubspotResp.data;
    if (!contact || !contact.properties) {
      return respondError(res, 404, 'Contact not found in HubSpot');
    }
    const phoneNumber = useMobile ? contact.properties.mobilephone : contact.properties.phone;
    const ownerId = contact.properties.hubspot_owner_id;
    // Validate that the required phone number exists
    if (!phoneNumber) {
      return respondError(res, 400, `Contact does not have a ${useMobile ? 'mobile phone' : 'phone'} number`);
    }
    // Validate that the contact has an owner and that owner is authorized
    if (!ownerId) {
      return respondError(res, 400, 'Contact has no owner assigned');
    }
    const agentNumber = agentPhoneMap[ownerId];
    if (!agentNumber) {
      return respondError(res, 403, 'Call blocked: Contact owner is not configured for calling');
    }

    // Construct TwiML URL with query params for contact and owner (for use in the TwiML generation step)
    const twimlUrl = `${BASE_URL}/connect-call?contactId=${contactId}&ownerId=${ownerId}&to=${encodeURIComponent(phoneNumber)}`;
    // Initiate the call via Twilio (calls the agent first)
    await twilioClient.calls.create({
      from: TWILIO_NUMBER,
      to: agentNumber,
      url: twimlUrl,
      method: 'GET'  // Twilio will GET the TwiML instructions once the agent picks up
    });
    return res.status(200).json({ message: 'Call initiated successfully' });
  } catch (err) {
    // Handle errors from HubSpot API or Twilio API
    if (err.response && err.response.data) {
      console.error('HubSpot API error:', err.response.status, err.response.data);
      return respondError(res, err.response.status, 'Failed to retrieve contact data from HubSpot');
    } else {
      console.error('Error initiating Twilio call:', err.message || err);
      return respondError(res, 500, 'Failed to initiate Twilio call');
    }
  }
}

// POST route to initiate a PHONE CALL (to contact's phone number)
app.post('/start-phone-call', async (req, res) => {
  const contactId = req.body.hs_object_id || req.body.contactId || req.query.contactId;
  if (!contactId) {
    return respondError(res, 400, 'Missing hs_object_id (contact ID)');
  }
  // Trigger the call using the primary phone number
  await initiateCall(contactId, false, res);
});

// POST route to initiate a MOBILE CALL (to contact's mobile number)
app.post('/start-mobile-call', async (req, res) => {
  const contactId = req.body.hs_object_id || req.body.contactId || req.query.contactId;
  if (!contactId) {
    return respondError(res, 400, 'Missing hs_object_id (contact ID)');
  }
  // Trigger the call using the mobile phone number
  await initiateCall(contactId, true, res);
});

// GET route to provide TwiML instructions to Twilio for connecting the agent to the contact
app.all('/connect-call', (req, res) => {
  const { contactId, ownerId, to } = req.query;

  // Debug logs for validation
  console.log('📞 /connect-call received with:', { contactId, ownerId, to });

  // Validate required params
  if (!to || !contactId || !ownerId) {
    console.error('❌ Missing required query parameters:', { contactId, ownerId, to });
    return res
      .status(400)
      .type('text/xml')
      .send('<Response><Say>Call failed due to missing information.</Say></Response>');
  }

  try {
    const voiceResponse = new twilio.twiml.VoiceResponse();

    voiceResponse.dial({
      callerId: TWILIO_NUMBER,
      record: 'record-from-answer',
      recordingStatusCallback: `${BASE_URL}/recording-callback?contactId=${contactId}&ownerId=${ownerId}`,
      recordingStatusCallbackMethod: 'POST',
      recordingStatusCallbackEvent: 'completed'
    }).number(to);

    const xml = voiceResponse.toString();
    console.log('✅ TwiML generated:', xml);

    res.type('text/xml').send(xml);
  } catch (err) {
    console.error('❌ Error generating TwiML:', err);
    res
      .status(500)
      .type('text/xml')
      .send('<Response><Say>There was an error connecting the call.</Say></Response>');
  }
});


// POST route to handle Twilio recording callback (called when the call recording is complete)
app.post('/recording-callback', async (req, res) => {
  const contactId = req.query.contactId;
  const ownerId = req.query.ownerId;
  // Extract recording details from Twilio's POST body (typically sent as application/x-www-form-urlencoded)
  let recordingUrl = req.body.RecordingUrl || null;
  const recordingSid = req.body.RecordingSid;
  const recordingDurationSec = req.body.RecordingDuration;
  if (recordingUrl) {
    // Append file extension to get a direct audio link (Twilio provides the URL without extension by default)
    recordingUrl += '.mp3';
  }
  // Calculate duration in milliseconds, if available
  let durationMs = 0;
  if (recordingDurationSec) {
    const sec = parseInt(recordingDurationSec, 10);
    if (!isNaN(sec)) {
      durationMs = sec * 1000;
    }
  }
  // Determine call start timestamp (current time minus duration)
  const endTime = new Date();
  const startTime = durationMs ? new Date(endTime.getTime() - durationMs) : endTime;
  const startTimeIso = startTime.toISOString();

  try {
    // Prepare call engagement properties for HubSpot
    const callProperties = {
      hs_timestamp: startTimeIso,                                       // Call start time in ISO format
      hs_call_title: 'Outbound call via Twilio',
      hs_call_body: recordingUrl ? `Call recording URL: ${recordingUrl}` : 'Call completed',
      hs_call_duration: durationMs.toString(),                          // Duration in milliseconds
      hs_call_status: 'COMPLETED',                                      // Call completed successfully
      hs_call_direction: 'OUTBOUND',                                    // Outbound call from agent’s perspective
      hs_call_from_number: TWILIO_NUMBER,                               // Agent/Twilio caller ID
      hs_call_to_number: req.body.To || '',                             // Customer’s number dialed
      hubspot_owner_id: ownerId                                         // Assign the engagement to the contact owner
    };

    // Create the call engagement in HubSpot (unassociated at first)
    const createResp = await axios.post('https://api.hubapi.com/crm/v3/objects/calls', 
      { properties: callProperties },
      { headers: { Authorization: `Bearer ${HUBSPOT_PRIVATE_APP_TOKEN}`, 'Content-Type': 'application/json' } }
    );
    const callId = createResp.data && createResp.data.id;
    // Associate the call engagement with the contact in HubSpot
    if (callId && contactId) {
      const assocUrl = `https://api.hubapi.com/crm/v3/objects/calls/${callId}/associations/contacts/${contactId}/call_to_contact`;
      await axios.put(assocUrl, {}, { headers: { Authorization: `Bearer ${HUBSPOT_PRIVATE_APP_TOKEN}` } });
    }
    // (The call engagement will now appear on the contact's timeline in HubSpot)
  } catch (err) {
    // Log any errors in creating or associating the engagement (for debugging)
    console.error('Error logging call in HubSpot:', err.response ? err.response.data : err.message);
  }

  // Respond to Twilio immediately to acknowledge the callback (avoid retransmission attempts)
  res.sendStatus(200);
});

// Start the Express server
const PORT = process.env.PORT || 3000;

module.exports = app;
