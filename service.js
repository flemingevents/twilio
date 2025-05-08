const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

app.post("/api/twilio", async (req, res) => {
  const { recordingDurationSec, recordingUrl, ownerId, contactId } = req.body;
  const TWILIO_NUMBER = process.env.TWILIO_NUMBER;
  const HUBSPOT_PRIVATE_APP_TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN;

  // Calculate duration in milliseconds
  let durationMs = 0;
  if (recordingDurationSec) {
    const sec = parseInt(recordingDurationSec, 10);
    if (!isNaN(sec)) {
      durationMs = sec * 1000;
    }
  }

  // Determine call start timestamp
  const endTime = new Date();
  const startTime = durationMs ? new Date(endTime.getTime() - durationMs) : endTime;
  const startTimeIso = startTime.toISOString();

  try {
    // Prepare call engagement properties for HubSpot
    const callProperties = {
      hs_timestamp: startTimeIso,
      hs_call_title: "Outbound call via Twilio",
      hs_call_body: recordingUrl ? `Call recording URL: ${recordingUrl}` : "Call completed",
      hs_call_duration: durationMs.toString(),
      hs_call_status: "COMPLETED",
      hs_call_direction: "OUTBOUND",
      hs_call_from_number: TWILIO_NUMBER,
      hs_call_to_number: req.body.To || "",
      hubspot_owner_id: ownerId
    };

    // Create the call engagement in HubSpot
    const createResp = await axios.post(
      "https://api.hubapi.com/crm/v3/objects/calls",
      { properties: callProperties },
      {
        headers: {
          Authorization: `Bearer ${HUBSPOT_PRIVATE_APP_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );
    const callId = createResp.data && createResp.data.id;

    // Associate the call engagement with the contact in HubSpot
    if (callId && contactId) {
      const assocUrl = `https://api.hubapi.com/crm/v3/objects/calls/${callId}/associations/contacts/${contactId}/call_to_contact`;
      await axios.put(assocUrl, {}, {
        headers: {
          Authorization: `Bearer ${HUBSPOT_PRIVATE_APP_TOKEN}`
        }
      });
    }

    // Respond to Twilio
    res.sendStatus(200);
  } catch (err) {
    console.error("Error logging call in HubSpot:", err.response ? err.response.data : err.message);
    res.sendStatus(500);
  }
});

module.exports = app;
