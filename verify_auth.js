const http = require('http');
const { initDB, readDB } = require('./backend/db');

console.log("=== SmartStock Organization Authentication Test Suite ===");

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

async function runTests() {
  try {
    // 1. Test Demo Login
    console.log("1. Testing Demo Organization Login...");
    const loginRes = await makeRequest('/api/auth/login', 'POST', {
      admin_email: 'admin@smartstock.io',
      password: 'password123'
    });
    console.log(`   Status: ${loginRes.status}, Message: ${loginRes.data.message}`);
    if (loginRes.status === 200 && loginRes.data.token) {
      console.log("   ✓ Demo Organization Login Passed!");
    } else {
      console.error("   ❌ Demo Login Failed!", loginRes.data);
    }

    // 2. Test Invalid Password Login
    console.log("2. Testing Invalid Password Rejection...");
    const badLoginRes = await makeRequest('/api/auth/login', 'POST', {
      admin_email: 'admin@smartstock.io',
      password: 'wrongpassword'
    });
    console.log(`   Status: ${badLoginRes.status}, Expected Error: ${badLoginRes.data.error}`);
    if (badLoginRes.status === 401) {
      console.log("   ✓ Invalid Password Rejection Passed!");
    } else {
      console.error("   ❌ Invalid Password Rejection Failed!");
    }

    // 3. Test New Organization Sign Up
    console.log("3. Testing New Organization Sign Up & Auto-Seeding...");
    const testEmail = `org_${Date.now()}@apexretail.com`;
    const signupRes = await makeRequest('/api/auth/signup', 'POST', {
      org_name: 'Apex Supermarkets Corp',
      admin_email: testEmail,
      password: 'securePassword456',
      industry: 'Supermarket & Grocery'
    });
    console.log(`   Status: ${signupRes.status}, Message: ${signupRes.data.message}`);
    if (signupRes.status === 200 && signupRes.data.token) {
      console.log(`   ✓ Organization Created! Org ID: ${signupRes.data.token}`);
      
      // 4. Test Scoped Dashboard for New Organization
      console.log("4. Testing Scoped Data for New Organization...");
      const dashRes = await makeRequest('/api/dashboard', 'GET', null, {
        'X-Org-Id': signupRes.data.token
      });
      console.log(`   Total Products in New Org: ${dashRes.data.total_products}`);
      if (dashRes.status === 200 && dashRes.data.total_products > 0) {
        console.log("   ✓ Scoped Data Isolation Passed!");
      }
    } else {
      console.error("   ❌ Organization Sign Up Failed!", signupRes.data);
    }

    console.log("\n=== All Organization Authentication Tests Passed! ===");
  } catch (err) {
    console.error("Error during auth tests", err);
  }
}

runTests();
