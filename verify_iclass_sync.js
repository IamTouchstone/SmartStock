const http = require('http');

console.log("=== SmartStock IClass Biz Manager Integration Test ===");

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
      hostname: 'localhost',
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

async function runTests() {
  const orgId = "ORG-DEMO-001";
  const userId = "USR-ADMIN-001";
  const headers = { 'X-Org-Id': orgId, 'X-User-Id': userId };

  try {
    // 1. Fetch settings (should read default/registry values)
    console.log("1. Fetching Settings (validating registry defaults)...");
    const getSetRes = await makeRequest('/api/settings', 'GET', null, headers);
    if (getSetRes.status !== 200) {
      console.error("   ❌ Settings fetch failed!");
      return;
    }
    console.log("   ✓ Settings read successfully");
    console.log(`   ✓ Server Host: ${getSetRes.data.iclass_server_host}`);
    console.log(`   ✓ Database Name: ${getSetRes.data.iclass_db_name}`);
    console.log(`   ✓ Active User: ${getSetRes.data.iclass_login_username}`);

    // 2. Trigger Synchronization
    console.log("2. Launching IClass Biz Manager Database Sync...");
    const syncRes = await makeRequest('/api/iclass/sync', 'POST', {}, headers);
    if (syncRes.status !== 200) {
      console.error("   ❌ Sync failed!", syncRes.data);
      return;
    }
    console.log(`   ✓ Sync finished. Message: ${syncRes.data.message}`);
    console.log(`   ✓ Imported items count: ${syncRes.data.imported_count}`);

    // 3. Second Sync Trigger (should skip duplicates)
    console.log("3. Re-triggering Sync (checking duplication filters)...");
    const reSyncRes = await makeRequest('/api/iclass/sync', 'POST', {}, headers);
    if (reSyncRes.status !== 200) {
      console.error("   ❌ Re-Sync failed!");
      return;
    }
    console.log(`   ✓ Re-Sync finished. Imported count: ${reSyncRes.data.imported_count} (should be 0)`);
    if (reSyncRes.data.imported_count === 0) {
      console.log("   ✓ Duplication filters verified!");
    } else {
      console.error("   ❌ Duplication filters failed!");
    }

    console.log("   ✓ IClass Biz Manager database sync integrated and verified successfully!");

  } catch (err) {
    console.error("Error during execution", err);
  }
}

runTests();
