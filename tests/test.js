// Run with:  node tests/test.js
// Loads the same JS modules the browser uses and checks the required scenarios.
const fs = require('fs');
const path = require('path');
const files = ['crc', 'packet', 'slidingWindow', 'goBackN', 'network', 'statistics', 'simulation'];
const code = files.map(f => fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8')).join('\n');
const { CRC, Simulation, Statistics } = new Function(code + '\nreturn { CRC, Simulation, Statistics };')();

let failed = 0;
function check(name, cond, info) {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (info ? '  (' + info + ')' : ''));
  if (!cond) failed++;
}
function run(cfg) {
  const sim = new Simulation(Object.assign({ packets: 10, window: 4, loss: 0, corrupt: 0, delay: 500, crc: 'CRC-16', seed: 7 }, cfg));
  sim.runToCompletion();
  return sim;
}

// CRC known-answer tests (ASCII "123456789")
const bits = CRC.textToBits('123456789');
check('CRC-CCITT check value 0x29B1', CRC.computeBits(bits, 'CRC-CCITT') === 0x29B1);
check('CRC-16 check value 0xFEE8', CRC.computeBits(bits, 'CRC-16') === 0xFEE8);
check('CRC-12 check value 0xF5B', CRC.computeBits(bits, 'CRC-12') === 0xF5B);

// Every 1-, 2- and 3-bit error in an 8-bit data + CRC codeword must be detected
for (const name of Object.keys(CRC.algorithms)) {
  const w = CRC.algorithms[name].width;
  const data = '10110101';
  const word = data + CRC.toBinary(CRC.computeBits(data, name), w);
  let missed = 0;
  const n = word.length;
  const flip = (s, idx) => s.split('').map((c, i) => idx.includes(i) ? (c === '1' ? '0' : '1') : c).join('');
  for (let a = 0; a < n; a++) for (let b = a; b < n; b++) for (let c = b; c < n; c++) {
    const idx = [...new Set([a, b, c])];
    const bad = flip(word, idx);
    if (CRC.verify(bad.slice(0, 8), parseInt(bad.slice(8), 2), name)) missed++;
  }
  check(name + ' detects all 1-3 bit errors', missed === 0, 'missed ' + missed);
}

// TEST 1: no loss, no corruption
let s = run({});
let sm = s.summary();
check('TEST 1: all packets delivered', sm.delivered === 10);
check('TEST 1: no retransmission, no Go-Back-N', sm.retransmissions === 0 && sm.gbnEvents === 0 && sm.transmissions === 10);

// TEST 2: Demo mode, P3 lost
s = run({ mode: 'demo' });
sm = s.summary();
const resent = s.log.filter(l => /retransmitted/.test(l.text)).map(l => l.text.slice(0, 2));
check('TEST 2: Go-Back-N triggered once', sm.gbnEvents === 1);
check('TEST 2: P3, P4, P5 retransmitted', resent.join() === 'P3,P4,P5', resent.join());
check('TEST 2: one lost, two out of order, all 5 delivered', sm.lost === 1 && sm.outOfOrder === 2 && sm.delivered === 5);

// TEST 3: P4 corrupted on first transmission
s = run({ packets: 8, scenario: { '4:1': 'CORRUPT' } });
sm = s.summary();
check('TEST 3: CRC detected the corrupted packet', sm.corrupted === 1);
check('TEST 3: recovery happened and all delivered', sm.gbnEvents >= 1 && sm.delivered === 8 && sm.retransmissions >= 1);

// TEST 4 / 5: window size behaviour
s = run({ window: 1, loss: 20, corrupt: 10 });
check('TEST 4: window 1 never has more than 1 packet in flight (stop-and-wait)', s.stats.maxInFlight === 1);
s = run({ window: 4 });
check('TEST 5: window 4 has multiple packets in flight', s.stats.maxInFlight === 4);

// TEST 6: high loss reduces throughput and raises retransmissions
const low = Statistics.runBatch({ packets: 10, window: 4, loss: 0, corrupt: 0, delay: 500, crc: 'CRC-16' }, 20);
const high = Statistics.runBatch({ packets: 10, window: 4, loss: 50, corrupt: 0, delay: 500, crc: 'CRC-16' }, 20);
check('TEST 6: retransmissions increase with loss', high.retransmissions > low.retransmissions,
  low.retransmissions.toFixed(1) + ' -> ' + high.retransmissions.toFixed(1));
check('TEST 6: throughput decreases with loss', high.throughputKbps < low.throughputKbps,
  low.throughputKbps.toFixed(2) + ' -> ' + high.throughputKbps.toFixed(2) + ' Kbps');

// Bigger windows are faster on a clean link
const w1 = Statistics.runBatch({ packets: 10, window: 1, loss: 0, corrupt: 0, delay: 500, crc: 'CRC-16' }, 5);
const w8 = Statistics.runBatch({ packets: 10, window: 8, loss: 0, corrupt: 0, delay: 500, crc: 'CRC-16' }, 5);
check('Window 8 faster than window 1 on a clean link', w8.throughputKbps > w1.throughputKbps);

console.log(failed ? '\n' + failed + ' test(s) FAILED' : '\nAll tests passed');
process.exit(failed ? 1 : 0);
