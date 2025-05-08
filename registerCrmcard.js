const axios = require('axios');
require('dotenv').config();

async function registerCrmCard() {
  const res = await axios.post(
    'https://api.hubapi.com/crm-extensions/v1/cards',
  
    {
      title: 'Twilio Call Widget',
      fetch: {
        targetUrl: 'https://5fb4-156-236-76-114.ngrok-free.app/call-widget',
        method: 'GET',
        headers: []
      },
      objectTypes: ['CONTACT'],
      display: {
        width: 400,
        height: 120
      }
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`,
        'Content-Type': 'application/json'
      }
    }
  );
  console.log('CRM card registered:', res.data);
}
registerCrmCard();
