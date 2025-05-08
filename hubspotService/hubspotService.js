const axios = require('axios');
const HUBSPOT_API = 'https://api.hubapi.com';

async function findContact(contactId) {
  const res = await axios.get(`${HUBSPOT_API}/crm/v3/objects/contacts/${contactId}`, {
    headers: {
      Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`
    }
  });
  return res.data;
}

module.exports = { findContact };
