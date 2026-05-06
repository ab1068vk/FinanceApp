/**
 * Master test runner for all calculation verification tests.
 * Run with: node tests/run-all-calculation-tests.js
 */

const path = require('path');
const { runCLI } = require('jest');

const backendRoot = path.join(__dirname, '..');
const testFiles = [
  'tests/budget-calculations.test.js',
  'tests/reports-data.test.js',
  'tests/account-balance.test.js',
  'tests/frontend-data-flow.test.js',
  'tests/edge-cases.test.js',
];

async function main() {
  console.log('===========================================');
  console.log('  FINANCEAPP CALCULATION VERIFICATION SUITE');
  console.log('===========================================\n');

  const { results } = await runCLI({
    _: testFiles,
    $0: 'jest',
    coverage: false,
    runInBand: true,
    testPathPatterns: testFiles,
    verbose: true,
  }, [backendRoot]);

  console.log('\n===========================================');
  console.log('  TEST RESULTS SUMMARY');
  console.log('===========================================\n');

  for (const result of results.testResults) {
    const name = path.basename(result.testFilePath, '.test.js');
    const passed = result.numPassingTests;
    const failed = result.numFailingTests;
    console.log(`  ${failed === 0 ? 'PASS' : 'FAIL'} ${name}: ${passed} passed, ${failed} failed`);
  }

  console.log(`\n  TOTAL: ${results.numPassedTests} passed, ${results.numFailedTests} failed`);

  if (!results.success) {
    console.log('\nSOME TESTS FAILED - CHECK CALCULATION LOGS ABOVE');
    process.exit(1);
  }

  console.log('\nALL TESTS PASSED - CALCULATIONS ARE CORRECT');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
