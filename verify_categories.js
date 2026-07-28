const http = require('http');

const PORT = 5000;
const HOST = 'localhost';

function request(method, path, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: HOST,
      port: PORT,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            body: data ? JSON.parse(data) : null
          });
        } catch (e) {
          resolve({ status: res.statusCode, rawBody: data });
        }
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log("=== SmartStock Categories Integration Test ===");

  const uniqueSuffix = Math.floor(1000 + Math.random() * 9000);
  const email = `admin_${uniqueSuffix}@acme.com`;
  const password = "password123";
  const org_name = `Acme Org ${uniqueSuffix}`;

  // 1. Create a new Organization & Admin
  console.log("1. Registering new organization and admin user...");
  const signupRes = await request('POST', '/api/auth/signup', {}, {
    org_name,
    admin_email: email,
    password,
    industry: "General Retail"
  });

  if (signupRes.status !== 200) {
    console.error("Signup failed:", signupRes.body);
    process.exit(1);
  }

  const { token: org_id, user_id } = signupRes.body;
  console.log(`   ✓ Org registered: ${org_id}. Admin user ID: ${user_id}`);

  const authHeaders = {
    'X-Org-Id': org_id,
    'X-User-Id': user_id
  };

  // 2. Fetch seeded categories
  console.log("2. Querying default seeded categories...");
  const getCatsRes = await request('GET', '/api/categories', authHeaders);
  if (getCatsRes.status !== 200) {
    console.error("Get categories failed:", getCatsRes.body);
    process.exit(1);
  }

  const categories = getCatsRes.body;
  console.log(`   ✓ Categories retrieved: ${categories.length}`);
  categories.forEach(c => console.log(`     - ${c.name}`));

  if (categories.length !== 5) {
    console.error("Expected exactly 5 default categories.");
    process.exit(1);
  }

  // 3. Create a custom category
  console.log("3. Creating a custom category...");
  const newCatName = "Premium Beverages";
  const postCatRes = await request('POST', '/api/categories', authHeaders, {
    name: newCatName
  });

  if (postCatRes.status !== 200) {
    console.error("Create category failed:", postCatRes.body);
    process.exit(1);
  }

  console.log(`   ✓ Category created: ${postCatRes.body.category.name}`);

  // 4. Verify duplicate prevention
  console.log("4. Verifying duplicate category rejection...");
  const duplicateRes = await request('POST', '/api/categories', authHeaders, {
    name: newCatName
  });

  if (duplicateRes.status === 200) {
    console.error("Duplicate category was allowed erroneously!");
    process.exit(1);
  }
  console.log(`   ✓ Duplicate rejected correctly: ${duplicateRes.body.error}`);

  // 5. Query categories again to verify update
  console.log("5. Querying categories list again...");
  const getCatsRes2 = await request('GET', '/api/categories', authHeaders);
  if (getCatsRes2.body.length !== 6) {
    console.error(`Expected 6 categories, got ${getCatsRes2.body.length}`);
    process.exit(1);
  }
  console.log("   ✓ Category count successfully incremented to 6");

  // 6. Register a new product using the custom category
  console.log("6. Registering a new product under the custom category...");
  const productRes = await request('POST', '/api/products', authHeaders, {
    sku: "BEV-001",
    name: "Sparkling Energy Water",
    category: newCatName,
    volume_per_unit: 0.0005,
    cost: 1.20,
    price: 2.99,
    safety_stock: 50,
    min_reorder_level: 100,
    lead_time: 3,
    supplier_name: "Beverage Wholesalers",
    main_qty: 200,
    north_qty: 50,
    south_qty: 80
  });

  if (productRes.status !== 200) {
    console.error("Product creation failed:", productRes.body);
    process.exit(1);
  }
  console.log(`   ✓ Product registered under category '${productRes.body.product.category}'`);

  console.log("\n=== All Category Integration Tests Passed Successfully! ===");
}

runTests().catch(e => {
  console.error("Test execution failed:", e);
  process.exit(1);
});
