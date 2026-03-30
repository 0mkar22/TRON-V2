const crypto = require('crypto');

const secret = 'my_super_secret_test_key';
const payload = JSON.stringify({
  action: 'opened',
  repository: { full_name: 'omkar-engineer/tron-daemon' },
  pull_request: {
    // 👇 Inject your REAL Basecamp Card ID right here!
    title: 'TASK-9732439871: Update the database schema', 
    user: { login: 'omkar-engineer' }
  }
});

const hmac = crypto.createHmac('sha256', secret);
const signature = 'sha256=' + hmac.update(payload).digest('hex');

console.log('🔫 Firing simulated GitHub Webhook...');

fetch('http://localhost:3000/webhook', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-github-event': 'pull_request',
    'x-github-delivery': 'test-delivery-id-12345',
    'x-hub-signature-256': signature
  },
  body: payload
})
.then(res => res.text())
.then(response => console.log('Server Responded:', response))
.catch(err => console.error('Error firing webhook:', err));