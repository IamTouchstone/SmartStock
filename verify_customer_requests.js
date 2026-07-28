const http = require('http');

console.log("=== SmartStock Hierarchical Auth & Customer Requests Test ===");

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
  try {
    // 1. Sign up New Organization
    console.log("1. Signing up New Org & Admin...");
    const orgSuffix = Date.now().toString().slice(-4);
    const signupRes = await makeRequest('/api/auth/signup', 'POST', {
      org_name: `Apex Retailers ${orgSuffix}`,
      admin_email: `admin_${orgSuffix}@apex.com`,
      password: 'adminPassword123',
      industry: 'Electronics & Smart Home'
    });

    if (signupRes.status !== 200) {
      console.error("   ❌ Signup Failed!", signupRes.data);
      return;
    }

    const orgId = signupRes.data.token;
    const adminId = signupRes.data.user_id;
    console.log(`   ✓ Org created: ${orgId}. Admin user: ${adminId}`);

    // 2. Admin creates Manager
    console.log("2. Admin creating Manager account...");
    const managerEmail = `manager_${orgSuffix}@apex.com`;
    const createMgrRes = await makeRequest('/api/users', 'POST', {
      name: "Apex Manager",
      email: managerEmail,
      password: 'managerPassword123',
      role: 'Manager'
    }, {
      'X-Org-Id': orgId,
      'X-User-Id': adminId
    });

    if (createMgrRes.status !== 200) {
      console.error("   ❌ Admin creating Manager Failed!", createMgrRes.data);
      return;
    }
    const managerId = createMgrRes.data.user.id;
    console.log(`   ✓ Manager created: ${managerId}`);

    // 3. Manager creates Staff
    console.log("3. Manager creating Staff account...");
    const staffEmail = `staff_${orgSuffix}@apex.com`;
    const createStaffRes = await makeRequest('/api/users', 'POST', {
      name: "Apex Staff John",
      email: staffEmail,
      password: 'staffPassword123',
      role: 'Staff'
    }, {
      'X-Org-Id': orgId,
      'X-User-Id': managerId
    });

    if (createStaffRes.status !== 200) {
      console.error("   ❌ Manager creating Staff Failed!", createStaffRes.data);
      return;
    }
    const staffId = createStaffRes.data.user.id;
    console.log(`   ✓ Staff created: ${staffId}`);

    // 4. Staff logs Customer Request
    console.log("4. Staff creating Customer Request...");
    const requestRes = await makeRequest('/api/customer-requests', 'POST', {
      customer_name: "John Doe Customer",
      customer_email: "johndoe@gmail.com",
      requested_item: "Premium EcoSmart Smart Thermostat Gold Series (Custom Item)",
      item_description: "Standard model with extra screen guards",
      quantity: 10,
      notes: "Customer needs stock hold"
    }, {
      'X-Org-Id': orgId,
      'X-User-Id': staffId
    });

    if (requestRes.status !== 200) {
      console.error("   ❌ Staff creating Customer Request Failed!", requestRes.data);
      return;
    }
    console.log(`   ✓ Customer request filed successfully!`);

    // 5. Query Customer Requests (Should be visible to all)
    console.log("5. Querying requests visible to all roles...");
    const viewRes = await makeRequest('/api/customer-requests', 'GET', null, {
      'X-Org-Id': orgId,
      'X-User-Id': adminId
    });

    if (viewRes.status === 200 && viewRes.data.length > 0) {
      console.log(`   ✓ Total Requests Retrieved: ${viewRes.data.length}`);
      console.log(`   ✓ Customer Name: ${viewRes.data[0].customer_name}`);
      console.log(`   ✓ Item Description: ${viewRes.data[0].item_description}`);
      console.log(`   ✓ Filed by Staff: ${viewRes.data[0].created_by_staff}`);
      console.log("   ✓ Hierarchical Auth & Customer Requests Verified Successfully!");
    } else {
      console.error("   ❌ Requests check failed!");
    }

  } catch (err) {
    console.error("Error during execution", err);
  }
}

runTests();
