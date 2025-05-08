const twilio = require('twilio');
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

function initiateCall(from, to) {
  return client.calls.create({
    from,
    to,
    url: 'https://your-ngrok-url/twiml',
    record: true
  });
}

module.exports = { initiateCall };
