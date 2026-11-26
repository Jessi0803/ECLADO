const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runStudentPricingDatabaseScenario } = require('../fixtures/student-pricing-db.cjs');

test('1C: real existing engines plus student prices and AUTO/MANUAL',
  {skip:!process.env.PGLITE_MODULE&&!process.env.EMBEDDED_POSTGRES_MODULE,timeout:120000},()=>runStudentPricingDatabaseScenario());
