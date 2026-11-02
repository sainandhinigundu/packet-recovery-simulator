/* ============================================================
   app.js  -  Connects the buttons / screen to the Simulation
   (This file only draws things; all algorithms live in the
    other modules.)
   ============================================================ */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);

  // How each packet status looks on screen
  const STATUS_META = {
    'Waiting':        { cls: 's-waiting',  icon: '⏳' },
    'Queued':         { cls: 's-queued',   icon: '⏳' },
    'Sent':           { cls: 's-sent',     icon: '→' },
    'Retransmitting': { cls: 's-retx',     icon: '↻' },
    'Lost':           { cls: 's-lost',     icon: '❌' },
    'Corrupted':      { cls: 's-corrupt',  icon: '⚠' },
    'Out of order':   { cls: 's-ooo',      icon: '⚠' },
    'Received':       { cls: 's-received', icon: '✓' },
    'ACKed':          { cls: 's-acked',    icon: '✓ ACK' }
  };
  const TRACE_TEXT = {
    transit: '→ in transit', delivered: '→ arrived', lost: '✗ LOST', crcerror: '✗ CRC ERROR',
    ooo: '⚠ OUT OF ORDER', ok: '✓ accepted', acked: '✓ ACK received'
  };
  const FIELDS = ['numPackets', 'windowSize', 'lossProb', 'corruptProb'];

  let sim = null, running = false, timer = null, locked = false, savedNormal = null;

  // ---------- reading the form ----------
  function clamp(v, min, max, def) { v = parseInt(v, 10); if (isNaN(v)) v = def; return Math.min(max, Math.max(min, v)); }
  function readForm() {
    return {
      packets: clamp($('numPackets').value, 1, 50, 10),
      window: clamp($('windowSize').value, 1, 16, 4),
      loss: clamp($('lossProb').value, 0, 90, 20),
      corrupt: clamp($('corruptProb').value, 0, 90, 10),
      delay: clamp($('delayMs').value, 10, 2000, 500),
      crc: $('crcAlgo').value,
      mode: $('simMode').value
    };
  }
  function writeForm(c) {
    $('numPackets').value = c.packets; $('windowSize').value = c.window;
    $('lossProb').value = c.loss; $('corruptProb').value = c.corrupt;
  }
  function refreshDisabled() {
    const demo = $('simMode').value === 'demo';
    FIELDS.forEach(id => { $(id).disabled = locked || demo; });
    ['delayMs', 'crcAlgo', 'simMode'].forEach(id => { $(id).disabled = locked; });
  }
  function applyModeUI() {
    const demo = $('simMode').value === 'demo';
    if (demo && !savedNormal) {                     // Demo Mode fixes the scenario values
      savedNormal = readForm();
      writeForm({ packets: 5, window: 4, loss: 0, corrupt: 0 });
    } else if (!demo && savedNormal) {
      writeForm(savedNormal); savedNormal = null;
    }
    refreshDisabled();
    updateCrcInfo();
  }
  function updateCrcInfo() {
    const a = CRC.algorithms[$('crcAlgo').value];
    $('crcInfo').textContent = `${$('crcAlgo').value}: ${a.width}-bit checksum, generator polynomial ${a.text} (0x${a.poly.toString(16).toUpperCase()}).` +
      ($('simMode').value === 'demo' ? ' Demo mode: 5 packets, window 4, P3 is lost on its first transmission.' : '');
  }

  // ---------- run control ----------
  function newSim() { sim = new Simulation(readForm()); locked = true; refreshDisabled(); }
  function stopTimer() { running = false; clearTimeout(timer); }
  function tick() {
    if (!running) return;
    sim.step(); render();
    if (sim.finished) { stopTimer(); locked = false; refreshDisabled(); updateButtons(); return; }
    timer = setTimeout(tick, parseInt($('speed').value, 10));
  }
  function start() { stopTimer(); newSim(); running = true; updateButtons(); tick(); }
  function pause() { stopTimer(); updateButtons(); }
  function resume() { if (sim && !sim.finished) { running = true; updateButtons(); tick(); } }
  function nextStep() {
    stopTimer();
    if (!sim || sim.finished) newSim();
    sim.step(); render();
    if (sim.finished) { locked = false; refreshDisabled(); }
    updateButtons();
  }
  function reset() {
    stopTimer(); sim = null; locked = false; refreshDisabled();
    ChartManager.reset();
    $('compareTable').querySelector('tbody').innerHTML = '<tr><td colspan="6" class="muted">Click "Run comparison and analysis".</td></tr>';
    render(); updateButtons();
  }
  function updateButtons() {
    const inProgress = sim && !sim.finished;
    $('btnStart').disabled = inProgress;
    $('btnPause').disabled = !running;
    $('btnResume').disabled = !(inProgress && !running);
    $('btnNext').disabled = false;
  }

  // ---------- analysis: window comparison + loss sweep ----------
  function runAnalysis() {
    const base = savedNormal || readForm();       // always use the Normal-mode values
    const RUNS = 20;
    const windows = [1, 2, 4, 8].map(w => Object.assign({ window: w }, Statistics.runBatch(Object.assign({}, base, { window: w }), RUNS)));
    const losses = [0, 10, 20, 30, 40, 50].map(l => Object.assign({ loss: l }, Statistics.runBatch(Object.assign({}, base, { loss: l }), RUNS)));
    $('compareTable').querySelector('tbody').innerHTML = windows.map(r =>
      `<tr><td>${r.window}</td><td>${r.transmissions.toFixed(1)}</td><td>${r.retransmissions.toFixed(1)}</td>` +
      `<td>${r.throughputKbps.toFixed(2)}</td><td>${r.avgDelayMs.toFixed(0)}</td><td>${r.completionMs.toFixed(0)}</td></tr>`).join('');
    $('analysisNote').textContent = `Averages of ${RUNS} seeded runs: ${base.packets} packets, loss ${base.loss}%, corruption ${base.corrupt}%, delay ${base.delay} ms, ${base.crc}. Loss sweep (charts 3-4) uses window ${base.window}.`;
    ChartManager.setWindowSweep(windows);
    ChartManager.setLossSweep(losses);
  }

  // ---------- drawing ----------
  function meta(status) { return STATUS_META[status] || STATUS_META['Waiting']; }

  function render() {
    renderHeader(); renderSender(); renderNetwork(); renderReceiver();
    renderRecovery(); renderLog(); renderStats();
    $('explainPanel').hidden = !$('showExplain').checked;
    $('explainText').textContent = sim ? sim.explain : 'Press Start or Next Step to begin.';
    ChartManager.updateLive(sim);
  }

  function renderHeader() {
    $('chipStep').textContent = 'Step ' + (sim ? sim.stepNo : 0);
    $('chipTime').textContent = 'Simulated time ' + (sim ? Math.round(sim.clock) : 0) + ' ms';
    $('chipSeed').textContent = 'Seed ' + (sim ? sim.seed : '-');
    $('chipState').textContent = !sim ? 'Not started' : sim.finished ? 'Finished' : running ? 'Running' : 'Paused / stepping';
  }

  function renderSender() {
    if (!sim || !sim.generated) {
      $('senderFacts').innerHTML = '';
      $('senderStrip').innerHTML = '<p class="muted">Press Start or Next Step to generate the packets.</p>';
      return;
    }
    const w = sim.window;
    $('senderFacts').innerHTML =
      `<span>Window size: <b>${w.size}</b></span><span>Current base: <b>P${Math.min(w.base, w.total)}</b></span>` +
      `<span>Next sequence number: <b>${w.nextSeq <= w.total ? 'P' + w.nextSeq : 'none left'}</b></span>` +
      `<span>Un-ACKed in flight: <b>${w.inFlightCount()}</b></span><span>ACKs received: <b>${sim.stats.acks}</b></span>` +
      `<span>Window: <b>[${w.seqsInWindow().map(s => 'P' + s).join(' ')}]</b></span>`;
    const inWin = new Set(w.seqsInWindow());
    $('senderStrip').innerHTML = sim.packets.map(p => {
      const m = meta(p.status);
      const mark = p.seq === w.base && !w.allAcked() ? 'BASE' : (p.seq === w.nextSeq ? 'NEXT' : '');
      return `<div class="pkt ${m.cls} ${inWin.has(p.seq) ? 'in-window' : ''}">` +
        `<span class="mark">${mark}</span><strong>${p.id}</strong><small>${m.icon} ${p.status}</small></div>`;
    }).join('');
  }

  function renderNetwork() {
    if (!sim || !sim.traces.length) { $('networkLanes').innerHTML = '<p class="muted">No packets sent yet.</p>'; return; }
    $('networkLanes').innerHTML = sim.traces.slice(-9).map(t =>
      `<div class="lane"><span class="lane-id">${t.id}${t.retx ? ' ↻' : ''}</span>` +
      `<div class="lane-line ${t.outcome}">${TRACE_TEXT[t.outcome]}</div></div>`).join('');
  }

  function renderReceiver() {
    if (!sim || !sim.generated) {
      $('receiverFacts').innerHTML = ''; $('receiverEvents').innerHTML = '';
      $('crcCheck').innerHTML = '<span class="muted">No packet checked yet.</span>'; return;
    }
    const exp = sim.receiver.expectedSeq;
    $('receiverFacts').innerHTML = `<span>Expected packet: <b>${exp <= sim.cfg.packets ? 'P' + exp : 'none (all received)'}</b></span>` +
      `<span>Accepted in order: <b>${sim.receiver.delivered.length}</b></span>`;
    const c = sim.lastCheck;
    $('crcCheck').innerHTML = c
      ? `<b>${c.id}</b> sent data <code>${c.original}</code>, received <code>${c.received}</code><br>` +
        `${c.crcName} recalculated <code>${c.calc}</code> vs carried <code>${c.got}</code> ` +
        (c.ok ? '<span class="crc-ok">✓ CRC VALID</span>' : '<span class="crc-bad">✗ CRC ERROR</span>') +
        (c.action === 'DISCARD_OUT_OF_ORDER' ? ' <span class="tag s-ooo">out of order, discarded</span>' : '')
      : '<span class="muted">No packet checked yet.</span>';
    const cls = { ok: 's-ok', lost: 's-lost', corrupt: 's-corrupt', ooo: 's-ooo' };
    $('receiverEvents').innerHTML = sim.receiverEvents.slice(-12).map(e =>
      `<span class="tag ${cls[e.cls]}">${e.id} ${e.text}</span>`).join('');
  }

  function renderRecovery() {
    const box = $('recoveryBox');
    if (!sim || !sim.recovery.triggered) { box.className = 'recovery idle'; box.textContent = 'No recovery needed so far.'; return; }
    const r = sim.recovery;
    box.className = 'recovery ' + (r.active ? 'active' : 'done');
    box.innerHTML = (r.active ? '⚠ <b>GO-BACK-N RETRANSMISSION TRIGGERED</b>' : '✓ <b>Last Go-Back-N recovery finished</b>') +
      `<br>Went back to P${r.from}. Retransmitting: P${r.from} → P${r.to}` +
      `<br>Already resent: ${r.resent.length ? r.resent.join(', ') : 'none yet'}` +
      `<br>Go-Back-N events so far: ${sim.stats.gbnEvents}`;
  }

  function renderLog() {
    const el = $('log');
    if (!sim) { el.innerHTML = ''; return; }
    el.innerHTML = sim.log.slice(-250).map(l =>
      `<div class="${l.type}"><span class="t">[${l.wall}]</span> [Step ${l.step}] ${l.text}</div>`).join('');
    el.scrollTop = el.scrollHeight;
  }

  function renderStats() {
    const el = $('stats');
    if (!sim || !sim.generated) { el.innerHTML = '<p class="muted">Statistics appear once the simulation starts.</p>'; $('statsTag').textContent = ''; return; }
    const s = sim.summary();
    $('statsTag').textContent = sim.finished ? '(final)' : '(live)';
    const items = [
      ['Total packets', s.totalPackets], ['Successfully received', s.delivered], ['Lost packets', s.lost],
      ['Corrupted packets (CRC errors)', s.corrupted], ['Out-of-order discards', s.outOfOrder],
      ['Retransmissions', s.retransmissions], ['Total transmissions', s.transmissions], ['ACKs', s.acks],
      ['Go-Back-N events', s.gbnEvents], ['Packet loss', s.lossPct.toFixed(1) + ' %'],
      ['Success rate', s.successRate.toFixed(1) + ' %'], ['Average delay', s.avgDelayMs.toFixed(0) + ' ms'],
      ['Throughput', s.throughputKbps.toFixed(2) + ' Kbps'], ['Total time', Math.round(s.completionMs) + ' ms']
    ];
    el.innerHTML = items.map(i => `<div class="stat"><span>${i[0]}</span><b>${i[1]}</b></div>`).join('');
  }

  function renderLegend() {
    const items = [['✓ Received', 's-received'], ['✓ ACK received', 's-acked'], ['❌ Lost', 's-lost'], ['⚠ Corrupted', 's-corrupt'],
      ['⚠ Out of order', 's-ooo'], ['→ Transmitting', 's-sent'], ['↻ Retransmitting', 's-retx'], ['⏳ Waiting', 's-waiting']];
    $('legend').innerHTML = items.map(i => `<span class="tag ${i[1]}">${i[0]}</span>`).join('');
  }

  // ---------- wiring ----------
  $('btnStart').addEventListener('click', start);
  $('btnPause').addEventListener('click', pause);
  $('btnResume').addEventListener('click', resume);
  $('btnNext').addEventListener('click', nextStep);
  $('btnReset').addEventListener('click', reset);
  $('btnAnalysis').addEventListener('click', runAnalysis);
  $('simMode').addEventListener('change', applyModeUI);
  $('crcAlgo').addEventListener('change', updateCrcInfo);
  $('showExplain').addEventListener('change', render);

  renderLegend();
  if (!ChartManager.init()) $('chartWarning').hidden = false;
  applyModeUI();
  render();
  updateButtons();
})();
