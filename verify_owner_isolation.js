const http = require('http');
const { readDB } = require('./backend/db');

console.log("=================================================================");
console.log(" SmartStock App Owner Super Admin Isolation Test Suite ");
console.log("=================================================================");

function makeRequest(path, method, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(body || {});
    const reqHeaders = {
      'Content-Type': 'application/json',
      ...headers
    };
    if (method === 'POST') {
      reqHeaders['Content-Length'] = Buffer.byteLength(postData);
    }

    const req = http.request({
      hostname: '127.0.0.1',
      port: 5000,
      path,
      method,
      headers: reqHeaders
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch(e) {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', reject);
    if (method === 'POST') req.write(postData);
    req.end();
  });
}

async function runIsolationTests() {
  try {
    // 1. Register Client Company (Not the App Owner)
    console.log("\n1. Registering standard Client Company...");
    const clientEmail = `client_admin_${Date.now()}@fairprice.com`;
    const clientSignup = await makeRequest('/api/auth/signup', 'POST', {
      org_name: 'Fairprice Retailers',
      admin_email: clientEmail,
      password: 'password123',
      industry: 'Supermarket & Grocery'
    });

    const clientToken = clientSignup.data.token;
    console.log(`   Registered! Org ID Token: ${clientToken}`);

    // Verify is_owner: false
    const clientMe = await makeRequest('/api/auth/me', 'GET', null, { 'X-Org-Id': clientToken });
    console.log(`   Client is_owner flag: ${clientMe.data.is_owner}`);
    if (clientMe.data.is_owner === false) {
      console.log("   ✓ Client correctly identified as standard user (is_owner = false)");
    } else {
      console.error("   ❌ Client user misidentified as App Owner!");
      process.exit(1);
    }

    // 2. Standard Client Company Attempting Owner Endpoint Access
    console.log("\n2. Testing access control rules for Client Company (expecting 403)...");
    
    const logsRes = await makeRequest('/api/owner/email-logs', 'GET', null, { 'X-Org-Id': clientToken });
    console.log(`   GET /api/owner/email-logs status: ${logsRes.status} (Error: ${logsRes.data.error})`);
    
    const overviewRes = await makeRequest('/api/owner/overview', 'GET', null, { 'X-Org-Id': clientToken });
    console.log(`   GET /api/owner/overview status: ${overviewRes.status} (Error: ${overviewRes.data.error})`);

    const settingsRes = await makeRequest('/api/owner/settings', 'POST', { owner_email: "hacker@evil.com" }, { 'X-Org-Id': clientToken });
    console.log(`   POST /api/owner/settings status: ${settingsRes.status} (Error: ${settingsRes.data.error})`);

    if (logsRes.status === 403 && overviewRes.status === 403 && settingsRes.status === 403) {
      console.log("   ✓ Owner Super Admin routes strictly protected! Client access denied (403 Forbidden).");
    } else {
      console.error("   ❌ Access control violation! Standard client was able to access owner routes.");
      process.exit(1);
    }

    // 3. Registering/Updating Database to Seed Owner Account (bernieamce@gmail.com)
    console.log("\n3. Registering/Verifying App Owner Account (bernieamce@gmail.com)...");
    let db = readDB();
    if (!db.settings) db.settings = {};
    if (!db.settings.global) db.settings.global = {};
    db.settings.global.owner_email = 'bernieamce@gmail.com';
    const { writeDB } = require('./backend/db');
    writeDB(db);

    let ownerOrg = (db.organizations || []).find(o => o.admin_email.toLowerCase() === 'bernieamce@gmail.com');
    let ownerToken = "";

    if (!ownerOrg) {
      const ownerSignup = await makeRequest('/api/auth/signup', 'POST', {
        org_name: 'SmartStock Owner Corp',
        admin_email: 'bernieamce@gmail.com',
        password: 'ownerpassword123',
        industry: 'Electronics & Smart Home'
      });
      ownerToken = ownerSignup.data.token;
    } else {
      ownerToken = ownerOrg.id;
    }
    console.log(`   Owner Org Token: ${ownerToken}`);

    // Verify is_owner: true
    const ownerMe = await makeRequest('/api/auth/me', 'GET', null, { 'X-Org-Id': ownerToken });
    console.log(`   Owner is_owner flag: ${ownerMe.data.is_owner}`);
    if (ownerMe.data.is_owner === true) {
      console.log("   ✓ App Owner correctly identified (is_owner = true)");
    } else {
      console.error("   ❌ Owner account misidentified as standard user!");
      process.exit(1);
    }

    // 4. Testing Authorized App Owner Access to Portal Endpoints
    console.log("\n4. Testing authorized App Owner access to Super Admin endpoints...");
    
    const ownerOverview = await makeRequest('/api/owner/overview', 'GET', null, { 'X-Org-Id': ownerToken });
    console.log(`   GET /api/owner/overview status: ${ownerOverview.status}`);
    
    const ownerLogs = await makeRequest('/api/owner/email-logs', 'GET', null, { 'X-Org-Id': ownerToken });
    console.log(`   GET /api/owner/email-logs status: ${ownerLogs.status}, Total Logged Emails: ${ownerLogs.data.length}`);

    const ownerSetUpdate = await makeRequest('/api/owner/settings', 'POST', {
      owner_email: "bernieamce@gmail.com",
      owner_alerts_enabled: true
    }, { 'X-Org-Id': ownerToken });
    console.log(`   POST /api/owner/settings status: ${ownerSetUpdate.status}`);

    if (ownerOverview.status === 200 && ownerLogs.status === 200 && ownerSetUpdate.status === 200) {
      console.log("   ✓ App Owner (bernieamce@gmail.com) successfully authorized for all portal management functions!");
    } else {
      console.error("   ❌ App Owner failed to access own portal endpoints!");
      process.exit(1);
    }

    console.log("\n=================================================================");
    console.log(" 🎉 ALL APP OWNER SUPER ADMIN ISOLATION TESTS PASSED 100%! ");
    console.log("=================================================================\n");

  } catch (err) {
    console.error("Owner isolation test failed:", err);
    process.exit(1);
  }
}

runIsolationTests();
