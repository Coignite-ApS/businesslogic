import HF from 'hyperformula';
const { HyperFormula } = HF;

// --- Test 1: Confirm circular references produce #CYCLE! ---
console.log('=== Test 1: Circular reference detection ===');
{
  const hf = HyperFormula.buildFromSheets({
    Sheet1: [['=B1+1', '=A1+1']]
  }, { licenseKey: 'gpl-v3' });

  const a1 = hf.getCellValue({ sheet: 0, row: 0, col: 0 });
  const b1 = hf.getCellValue({ sheet: 0, row: 0, col: 1 });
  console.log('A1:', a1, '| B1:', b1);
  console.log('A1 type:', typeof a1, a1?.type, a1?.value);
  console.log('B1 type:', typeof b1, b1?.type, b1?.value);
  hf.destroy();
}

// --- Test 2: Replace one formula with value, evaluate, restore ---
console.log('\n=== Test 2: Break cycle by replacing one formula with seed value ===');
{
  const hf = HyperFormula.buildFromSheets({
    Sheet1: [['=B1+1', '=A1+1']]
  }, { licenseKey: 'gpl-v3' });

  // Both are #CYCLE!
  console.log('Before:', hf.getCellValue({ sheet: 0, row: 0, col: 0 }));

  // Replace A1 with seed value 0 (break the cycle)
  hf.setCellContents({ sheet: 0, row: 0, col: 0 }, [[0]]);
  const b1After = hf.getCellValue({ sheet: 0, row: 0, col: 1 });
  console.log('After setting A1=0: B1 =', b1After);

  // Now put formula back in A1
  hf.setCellContents({ sheet: 0, row: 0, col: 0 }, [['=B1+1']]);
  const a1Restored = hf.getCellValue({ sheet: 0, row: 0, col: 0 });
  const b1Restored = hf.getCellValue({ sheet: 0, row: 0, col: 1 });
  console.log('After restoring A1 formula: A1 =', a1Restored, '| B1 =', b1Restored);
  console.log('(Expected: #CYCLE! returns once formula is back)');
  hf.destroy();
}

// --- Test 3: Two-engine iterative approach ---
console.log('\n=== Test 3: Two-engine iterative convergence ===');
console.log('Model: A1=B1*0.5+10, B1=A1*0.3+5 (should converge)');
{
  const MAX_ITER = 50;
  const TOLERANCE = 1e-10;

  // Analytical solution: A1 = B1*0.5+10, B1 = A1*0.3+5
  // Substituting: A1 = (A1*0.3+5)*0.5+10 = 0.15*A1 + 2.5 + 10 = 0.15*A1 + 12.5
  // 0.85*A1 = 12.5 => A1 = 14.7058823...
  // B1 = 14.7058823*0.3+5 = 9.4117647...
  console.log('Analytical: A1 =', 12.5/0.85, '| B1 =', (12.5/0.85)*0.3+5);

  let a1Val = 0;
  let b1Val = 0;

  for (let i = 0; i < MAX_ITER; i++) {
    // Engine A: A1 is a value (seed/previous), B1 has formula
    const engineA = HyperFormula.buildFromSheets({
      Sheet1: [[a1Val, '=A1*0.3+5']]
    }, { licenseKey: 'gpl-v3' });
    const newB1 = engineA.getCellValue({ sheet: 0, row: 0, col: 1 });
    engineA.destroy();

    // Engine B: B1 is a value (from engineA), A1 has formula
    const engineB = HyperFormula.buildFromSheets({
      Sheet1: [['=B1*0.5+10', newB1]]
    }, { licenseKey: 'gpl-v3' });
    const newA1 = engineB.getCellValue({ sheet: 0, row: 0, col: 0 });
    engineB.destroy();

    const deltaA = Math.abs(newA1 - a1Val);
    const deltaB = Math.abs(newB1 - b1Val);

    a1Val = newA1;
    b1Val = newB1;

    if (i < 5 || i % 10 === 0) {
      console.log(`Iter ${i}: A1=${a1Val.toFixed(10)}, B1=${b1Val.toFixed(10)}, delta=${Math.max(deltaA, deltaB).toExponential(2)}`);
    }

    if (deltaA < TOLERANCE && deltaB < TOLERANCE) {
      console.log(`Converged at iteration ${i}!`);
      console.log(`Final: A1=${a1Val}, B1=${b1Val}`);
      break;
    }
  }
}

// --- Test 4: Single-engine iterative (reuse engine, swap cell contents) ---
console.log('\n=== Test 4: Single-engine iterative (setCellContents loop) ===');
console.log('Model: A1=B1*0.5+10, B1=A1*0.3+5');
{
  const MAX_ITER = 50;
  const TOLERANCE = 1e-10;

  // Build with both as values initially
  const hf = HyperFormula.buildFromSheets({
    Sheet1: [[0, 0]]
  }, { licenseKey: 'gpl-v3' });

  let a1Val = 0;
  let b1Val = 0;

  for (let i = 0; i < MAX_ITER; i++) {
    // Step 1: Set A1=value, B1=formula
    hf.setCellContents({ sheet: 0, row: 0, col: 0 }, [[a1Val]]);
    hf.setCellContents({ sheet: 0, row: 0, col: 1 }, [['=A1*0.3+5']]);
    const newB1 = hf.getCellValue({ sheet: 0, row: 0, col: 1 });

    // Step 2: Set B1=value, A1=formula
    hf.setCellContents({ sheet: 0, row: 0, col: 1 }, [[newB1]]);
    hf.setCellContents({ sheet: 0, row: 0, col: 0 }, [['=B1*0.5+10']]);
    const newA1 = hf.getCellValue({ sheet: 0, row: 0, col: 0 });

    const deltaA = Math.abs(newA1 - a1Val);
    const deltaB = Math.abs(newB1 - b1Val);

    a1Val = newA1;
    b1Val = newB1;

    if (i < 5 || i % 10 === 0) {
      console.log(`Iter ${i}: A1=${a1Val.toFixed(10)}, B1=${b1Val.toFixed(10)}, delta=${Math.max(deltaA, deltaB).toExponential(2)}`);
    }

    if (deltaA < TOLERANCE && deltaB < TOLERANCE) {
      console.log(`Converged at iteration ${i}!`);
      console.log(`Final: A1=${a1Val}, B1=${b1Val}`);
      break;
    }
  }
  hf.destroy();
}

// --- Test 5: More realistic scenario — loan amortization with circular interest ---
console.log('\n=== Test 5: Realistic circular ref — interest depends on balance depends on interest ===');
console.log('A1=principal(1000), B1=interest rate(0.05), C1=interest(=A1*B1), D1=payment(=A1+C1)');
console.log('But make it circular: A1=D1-C1 (balance after payment adjustment)');
console.log('Simplified: A1=1000, B1=0.05, C1=A1*B1, D1=A1+C1, then circular: A1=D2, D2=D1-500');
{
  // A1=initial balance, B1=rate, C1=interest=A1*B1, D1=total=A1+C1
  // Make circular: A1 depends on some adjusted value from D1
  // A1 = D1 - 500 (payment), C1 = A1*B1, D1 = A1 + C1
  // Solving: A1 = A1 + A1*0.05 - 500 = 1.05*A1 - 500
  // => 0 = 0.05*A1 - 500 => A1 = 10000
  // C1 = 500, D1 = 10500

  const hf = HyperFormula.buildFromSheets({
    Sheet1: [[0, 0.05, 0, 0]]  // A1=seed, B1=rate, C1, D1
  }, { licenseKey: 'gpl-v3' });

  const MAX_ITER = 100;
  const TOLERANCE = 1e-8;
  let a1Val = 1000; // initial guess

  for (let i = 0; i < MAX_ITER; i++) {
    // Set A1 = value, then formulas for C1 and D1
    hf.setCellContents({ sheet: 0, row: 0, col: 0 }, [[a1Val]]);
    hf.setCellContents({ sheet: 0, row: 0, col: 2 }, [['=A1*B1']]);   // C1 = interest
    hf.setCellContents({ sheet: 0, row: 0, col: 3 }, [['=A1+C1']]);   // D1 = total owed

    const d1 = hf.getCellValue({ sheet: 0, row: 0, col: 3 });
    const newA1 = d1 - 500; // "circular" part: new balance = total - payment

    const delta = Math.abs(newA1 - a1Val);
    a1Val = newA1;

    if (i < 5 || i % 10 === 0) {
      const c1 = hf.getCellValue({ sheet: 0, row: 0, col: 2 });
      console.log(`Iter ${i}: A1(balance)=${a1Val.toFixed(4)}, C1(interest)=${c1.toFixed(4)}, D1(total)=${d1.toFixed(4)}, delta=${delta.toExponential(2)}`);
    }

    if (delta < TOLERANCE) {
      const c1 = hf.getCellValue({ sheet: 0, row: 0, col: 2 });
      console.log(`Converged at iteration ${i}!`);
      console.log(`Final: balance=${a1Val}, interest=${c1}, total=${d1}`);
      console.log(`Analytical: balance=10000, interest=500, total=10500`);
      break;
    }
  }
  hf.destroy();
}

// --- Test 6: Detect #CYCLE! errors programmatically ---
console.log('\n=== Test 6: Detect CYCLE errors via getCellValue ===');
{
  const hf = HyperFormula.buildFromSheets({
    Sheet1: [
      ['=B1+1', '=A1+1', 42],  // A1,B1 circular; C1 normal
      ['=C1*2', '=A2+1', '=B2+1']  // A2,B2,C2 chain (not circular)
    ]
  }, { licenseKey: 'gpl-v3' });

  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 3; col++) {
      const val = hf.getCellValue({ sheet: 0, row, col });
      const cellRef = String.fromCharCode(65 + col) + (row + 1);
      const isCycle = val && typeof val === 'object' && val.type === 'CYCLE';
      console.log(`${cellRef}: value=${JSON.stringify(val)}, isCycle=${isCycle}`);
    }
  }
  hf.destroy();
}

// --- Test 7: Performance — how fast is setCellContents iteration? ---
console.log('\n=== Test 7: Performance of iterative approach ===');
{
  const hf = HyperFormula.buildFromSheets({
    Sheet1: [[0, 0]]
  }, { licenseKey: 'gpl-v3' });

  const start = performance.now();
  const ITERS = 1000;
  let val = 0;

  for (let i = 0; i < ITERS; i++) {
    hf.setCellContents({ sheet: 0, row: 0, col: 0 }, [[val]]);
    hf.setCellContents({ sheet: 0, row: 0, col: 1 }, [['=A1*0.3+5']]);
    val = hf.getCellValue({ sheet: 0, row: 0, col: 1 });
  }

  const elapsed = performance.now() - start;
  console.log(`${ITERS} iterations in ${elapsed.toFixed(1)}ms (${(elapsed/ITERS).toFixed(3)}ms/iter)`);
  hf.destroy();
}

console.log('\n=== Done ===');
