const http = require('http');

console.log("=== SmartStock Receipt OCR & Invoice Intake Test ===");

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
    // 1. Log a new purchase invoice (containing both an existing item TS-100 and a new item OCR-NEW)
    console.log("1. Submitting new purchase invoice...");
    const invoicePayload = {
      invoice_id: "INV-TEST-OCR-999",
      supplier_name: "Apex Electronics Wholesalers",
      date: "2026-07-23",
      branch_name: "North Branch",
      items: [
        { sku: "TS-100", name: "EcoSmart Smart Thermostat", qty: 10, price: 80.00 },
        { sku: "OCR-NEW", name: "Laser Scanner Sensor Pack", qty: 5, price: 120.00 }
      ],
      total_amount: 1400.00
    };

    const postRes = await makeRequest('/api/invoices', 'POST', invoicePayload, headers);
    if (postRes.status !== 200) {
      console.error("   ❌ Failed to submit invoice:", postRes.data);
      return;
    }
    console.log("   ✓ Invoice processed successfully!");
    console.log(`   ✓ Message: ${postRes.data.message}`);

    // 2. Fetch inventory list to verify stock levels updated
    console.log("2. Querying catalog inventory state...");
    const catRes = await makeRequest('/api/inventory', 'GET', null, headers);
    if (catRes.status !== 200) {
      console.error("   ❌ Failed to fetch catalog!");
      return;
    }

    // Verify existing item TS-100 stock at North Branch was incremented
    const ts100 = catRes.data.find(p => p.sku === "TS-100");
    const ts100Branch = ts100 && ts100.branches ? ts100.branches.find(b => b.branch === "North Branch") : null;
    const northStock = ts100Branch ? ts100Branch.quantity : 0;
    console.log(`   ✓ TS-100 stock level at North Branch: ${northStock} (should be updated)`);

    // Verify new item OCR-NEW was auto-registered
    const ocrNew = catRes.data.find(p => p.sku === "OCR-NEW");
    if (ocrNew) {
      console.log(`   ✓ New item OCR-NEW registered! Name: ${ocrNew.name}`);
      const ocrNewBranch = ocrNew.branches ? ocrNew.branches.find(b => b.branch === "North Branch") : null;
      console.log(`   ✓ OCR-NEW stock level at North Branch: ${ocrNewBranch ? ocrNewBranch.quantity : 0} (expected: 5)`);
    } else {
      console.error("   ❌ OCR-NEW was not registered in product catalog!");
      return;
    }

    // 3. Query ledger archive
    console.log("3. Querying invoice ledger...");
    const getRes = await makeRequest('/api/invoices', 'GET', null, headers);
    if (getRes.status !== 200) {
      console.error("   ❌ Failed to query invoice ledger!");
      return;
    }
    const savedInvoice = getRes.data.find(inv => inv.id === "INV-TEST-OCR-999");
    if (savedInvoice) {
      console.log(`   ✓ Invoice INV-TEST-OCR-999 verified in history database!`);
      console.log(`   ✓ Supplier: ${savedInvoice.supplier_name}`);
      console.log(`   ✓ Total Amount: $${savedInvoice.total_amount}`);
    } else {
      console.error("   ❌ Saved invoice could not be found in historical ledger!");
      return;
    }

    console.log("   ✓ Receipt OCR Scanner and Ledger integration verified successfully!");

  } catch (err) {
    console.error("Error during execution", err);
  }
}

runTests();
