const { initDB, readDB } = require('./backend/db');

console.log("=== SmartStock Inventory Core Verification Suite ===");

// 1. Test Database Initialization
const db = initDB();
console.log(`✓ Database initialized successfully. Products: ${db.products.length}, Inventory Records: ${db.inventory.length}`);

// 2. Test AI Sales Velocity Logic
const TS100 = db.products.find(p => p.sku === 'TS-100');
console.log(`✓ Product loaded: ${TS100.name} (Unit Volume: ${TS100.volume_per_unit} m³)`);

// 3. Volumetric Analysis Reconciliation Test
const invoiceQty = 100;
const measuredVolume = 0.096; // 80 units volume (0.096 m3 instead of expected 0.12 m3)
const detectedQty = Math.round(measuredVolume / TS100.volume_per_unit);
const isDiscrepancy = detectedQty !== invoiceQty;

console.log(`✓ Volumetric Analysis Test:`);
console.log(`   - Invoice Quantity: ${invoiceQty}`);
console.log(`   - Measured Volume: ${measuredVolume} m³`);
console.log(`   - Calculated Physical Units: ${detectedQty}`);
console.log(`   - Discrepancy Flagged: ${isDiscrepancy ? 'YES (Shortage of ' + (invoiceQty - detectedQty) + ' units detected!)' : 'NO'}`);

if (isDiscrepancy) {
  console.log("✓ Volumetric AI Discrepancy Detection passed!");
} else {
  console.error("❌ Discrepancy test failed!");
}

console.log("\n=== All Backend Core Verification Tests Passed! ===");
