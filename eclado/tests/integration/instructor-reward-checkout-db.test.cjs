const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runRewardCheckoutDatabaseScenario } = require('../fixtures/instructor-reward-checkout-db.cjs');

test('4: double wallet pricing, lifecycle and authoritative gateway contracts',{skip:!process.env.PGLITE_MODULE&&!process.env.EMBEDDED_POSTGRES_MODULE,timeout:180000},()=>runRewardCheckoutDatabaseScenario());
