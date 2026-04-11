// Run: node get-gsc-token.js /path/to/your-service-account.json
const crypto = require('crypto');
const fs = require('fs');

const keyFile = process.argv[2];
if (!keyFile) {
  console.error('Usage: node get-gsc-token.js /path/to/service-account.json');
  process.exit(1);
}

const sa = JSON.parse(fs.readFileSync(keyFile, 'utf8'));

// Build JWT
const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const payload = Buffer.from(JSON.stringify({
  iss: sa.client_email,
  scope: 'https://www.googleapis.com/auth/webmasters.readonly',
  aud: 'https://oauth2.googleapis.com/token',
  iat: now,
  exp: now + 3600,
})).toString('base64url');

const signature = crypto.sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), sa.private_key);
const jwt = `${header}.${payload}.${signature.toString('base64url')}`;

// Exchange JWT for access token
fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
})
  .then(r => r.json())
  .then(d => {
    if (d.access_token) {
      console.log('\nYour GSC access token (valid for 1 hour):\n');
      console.log(d.access_token);
      console.log('\nClient email:', sa.client_email);
      console.log('Project ID:', sa.project_id);
    } else {
      console.error('Error:', d);
    }
  });
