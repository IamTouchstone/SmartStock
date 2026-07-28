const http = require('http');

console.log("=== SmartStock Alerts & Purchase List Verification Tests ===");

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
    // 1. Update Alert settings
    console.log("1. Setting WhatsApp & Email configurations...");
    const settingsRes = await makeRequest('/api/settings', 'POST', {
      alert_whatsapp_enabled: true,
      alert_whatsapp_phone: "+1999888777",
      alert_email_enabled: true,
      alert_email_address: "notifications@smartstock.io",
      alert_telegram_enabled: false
    }, headers);

    if (settingsRes.status !== 200) {
      console.error("   ❌ Settings update failed!", settingsRes.data);
      return;
    }
    console.log("   ✓ Settings saved successfully");

    // 2. Trigger Alert Simulation
    console.log("2. Simulating notification triggers...");
    const simRes = await makeRequest('/api/alerts/simulate', 'POST', {}, headers);
    if (simRes.status !== 200) {
      console.error("   ❌ Alert simulation failed!", simRes.data);
      return;
    }
    console.log(`   ✓ Simulated messages dispatched. Logs generated: ${simRes.data.logs.length}`);

    // 3. Fetch alert logs
    console.log("3. Verifying alert logs trace...");
    const logsRes = await makeRequest('/api/alerts', 'GET', null, headers);
    if (logsRes.status !== 200 || logsRes.data.length === 0) {
      console.error("   ❌ Fetching alert logs failed!");
      return;
    }
    console.log(`   ✓ Retrieved ${logsRes.data.length} logs.`);
    console.log(`   ✓ First log trace: [${logsRes.data[0].channel} -> ${logsRes.data[0].recipient}] ${logsRes.data[0].message}`);

    // 4. Create Purchase list item
    console.log("4. Registering a market purchase item...");
    const createItemRes = await makeRequest('/api/purchase-list', 'POST', {
      item_name: "Heavy Duty Shipping Bags",
      category: "Packaging & Delivery",
      quantity: 300
    }, headers);

    if (createItemRes.status !== 200) {
      console.error("   ❌ Failed to add item to purchase list!", createItemRes.data);
      return;
    }
    const newItemId = createItemRes.data.item.id;
    console.log(`   ✓ Item registered: ${newItemId} (${createItemRes.data.item.item_name})`);

    // 5. Toggle item purchased status
    console.log("5. Toggling item status to Purchased...");
    const toggleRes = await makeRequest('/api/purchase-list/toggle', 'POST', { item_id: newItemId }, headers);
    if (toggleRes.status !== 200 || toggleRes.data.item.status !== 'Purchased') {
      console.error("   ❌ Status toggle failed!", toggleRes.data);
      return;
    }
    console.log(`   ✓ Item status successfully toggled to: ${toggleRes.data.item.status}`);

    // 6. Delete item
    console.log("6. Deleting item from purchase list...");
    const deleteRes = await makeRequest('/api/purchase-list/delete', 'POST', { item_id: newItemId }, headers);
    if (deleteRes.status !== 200) {
      console.error("   ❌ Item deletion failed!");
      return;
    }
    console.log("   ✓ Item successfully removed from checklist");
    console.log("   ✓ Alerts settings, dispatch simulation, and purchase lists validated successfully!");

  } catch (err) {
    console.error("Error during execution", err);
  }
}

runTests();
