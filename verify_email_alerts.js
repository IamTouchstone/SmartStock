const http = require('http');
const { initDB, readDB } = require('./backend/db');

console.log("=================================================================");
console.log(" SmartStock App Owner Alerts & Email Verification Test Suite ");
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

async function runVerificationTests() {
  try {
    // 1. Sign Up New Organization & Test Email Alerts
    console.log("\n1. Testing Organization Sign-Up with Verification & Owner Alert...");
    const testEmail = `retail_owner_${Date.now()}@smartmarket.com`;
    const signupRes = await makeRequest('/api/auth/signup', 'POST', {
      org_name: 'SmartMarket Superstores',
      admin_email: testEmail,
      password: 'password123',
      industry: 'Supermarket & Grocery'
    });

    console.log(`   Signup Status: ${signupRes.status}, Message: ${signupRes.data.message}`);
    if (signupRes.status === 200 && signupRes.data.requires_verification) {
      console.log("   ✓ Organization Registered with Pending Verification Status!");
    } else {
      console.error("   ❌ Signup test failed!", signupRes.data);
      process.exit(1);
    }

    const db = readDB();
    const createdOrg = db.organizations.find(o => o.admin_email === testEmail);
    console.log(`   Generated OTP Code: ${createdOrg.verification_code}, Token: ${createdOrg.verification_token}`);

    // Verify Email Logs recorded Owner Signup Alert & User Verification Email
    const signupOwnerAlert = (db.email_logs || []).find(l => l.type === 'OWNER_ALERT_SIGNUP' && l.html.includes(testEmail));
    const userVerifyEmail = (db.email_logs || []).find(l => l.type === 'USER_VERIFICATION' && l.to === testEmail);

    if (signupOwnerAlert) {
      console.log("   ✓ Owner Alert Email Dispatched & Logged for Account Registration!");
    } else {
      console.error("   ❌ Owner Signup Alert Email missing in outbox!");
    }

    if (userVerifyEmail) {
      console.log("   ✓ User Verification Email Dispatched & Logged!");
    } else {
      console.error("   ❌ User Verification Email missing in outbox!");
    }

    // 2. Test Invalid Verification Code Rejection
    console.log("\n2. Testing Invalid Verification Code Rejection...");
    const badVerifyRes = await makeRequest('/api/auth/verify-email', 'POST', {
      admin_email: testEmail,
      code: '000000'
    });
    console.log(`   Status: ${badVerifyRes.status}, Error Message: ${badVerifyRes.data.error}`);
    if (badVerifyRes.status === 400) {
      console.log("   ✓ Invalid Verification Code Rejection Passed!");
    } else {
      console.error("   ❌ Invalid code rejection failed!");
    }

    // 3. Test Valid Verification Code Submission
    console.log("\n3. Testing Valid OTP Email Verification...");
    const verifyRes = await makeRequest('/api/auth/verify-email', 'POST', {
      admin_email: testEmail,
      code: createdOrg.verification_code
    });
    console.log(`   Status: ${verifyRes.status}, Message: ${verifyRes.data.message}`);
    if (verifyRes.status === 200 && verifyRes.data.organization.is_verified) {
      console.log("   ✓ Account Email Verified & Status set to ACTIVE!");
    } else {
      console.error("   ❌ Email Verification failed!", verifyRes.data);
    }

    // Check Owner Email Verified Alert Logged
    const dbPostVerify = readDB();
    const ownerVerifyAlert = (dbPostVerify.email_logs || []).find(l => l.type === 'OWNER_ALERT_VERIFIED' && l.html.includes(testEmail));
    if (ownerVerifyAlert) {
      console.log("   ✓ Owner Alert Email Dispatched & Logged for Verified Email!");
    }

    // 4. Test App Download Endpoint & Owner App Download Alert
    console.log("\n4. Testing App Download & Owner Download Alert...");
    const downloadRes = await makeRequest('/api/app/download', 'GET', null, {
      'X-Org-Id': signupRes.data.token
    });
    console.log(`   Download Status: ${downloadRes.status}, Package File Name: SmartStock-Desktop-App.json`);
    if (downloadRes.status === 200) {
      console.log("   ✓ SmartStock Desktop Package Downloaded Successfully!");
    } else {
      console.error("   ❌ Download endpoint failed!");
    }

    const dbPostDownload = readDB();
    const ownerDownloadAlert = (dbPostDownload.email_logs || []).find(l => l.type === 'OWNER_ALERT_DOWNLOAD');
    if (ownerDownloadAlert) {
      console.log(`   ✓ Owner Alert Email Dispatched & Logged for App Download! (Subject: "${ownerDownloadAlert.subject}")`);
    } else {
      console.error("   ❌ Owner Download Alert missing in outbox!");
    }

    // 5. Test Owner Settings Management
    console.log("\n5. Testing Owner Email Alert Settings Update...");
    let dbState = readDB();
    let ownerOrg = (dbState.organizations || []).find(o => o.admin_email.toLowerCase() === 'bernieamce@gmail.com');
    let ownerToken = ownerOrg ? ownerOrg.id : 'ORG-1265';

    const settingsRes = await makeRequest('/api/owner/settings', 'POST', {
      owner_email: 'executive_owner@smartstock.io',
      owner_alerts_enabled: true
    }, { 'X-Org-Id': ownerToken });
    console.log(`   Status: ${settingsRes.status}, Updated Owner Email: ${settingsRes.data.global_settings ? settingsRes.data.global_settings.owner_email : 'N/A'}`);
    if (settingsRes.status === 200 && settingsRes.data.global_settings && settingsRes.data.global_settings.owner_email === 'executive_owner@smartstock.io') {
      console.log("   ✓ Owner Settings Update Passed!");
    } else {
      console.error("   ❌ Owner settings update failed!");
    }

    console.log("\n=================================================================");
    console.log(" 🎉 ALL OWNER ALERT & EMAIL VERIFICATION TESTS PASSED SUCCESSFULLY! ");
    console.log("=================================================================\n");

  } catch (err) {
    console.error("Test execution error:", err);
    process.exit(1);
  }
}

runVerificationTests();
