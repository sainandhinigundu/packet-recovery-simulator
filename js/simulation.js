/* ============================================================
   simulation.js  -  The engine that ties everything together
   ------------------------------------------------------------
   Each call to step() performs exactly ONE meaningful event.
   Priority of events on every step:
     1. Packets not generated yet      -> generate packets
     2. Window has room                -> SEND next packet
     3. Packets travelling in network  -> advance the oldest one
           (arrive -> CRC/sequence check -> ACK)
     4. Window stuck & network empty   -> TIMEOUT -> GO-BACK-N
   The same step() is used by Next Step, Start/Pause/Resume and by
   the headless batch runs used for charts and comparison.
   ============================================================ */

const SEND_GAP_MS = 10;                  // time to push one packet onto the wire
const DEMO_SCENARIO = { '3:1': 'LOST' }; // Demo Mode: first transmission of P3 is lost

class Simulation {
  constructor(cfg) {
    this.cfg = Object.assign({}, cfg);
    if (this.cfg.mode === 'demo') {      // Demo Mode always uses the same scenario
      Object.assign(this.cfg, { packets: 5, window: 4, loss: 0, corrupt: 0 });
    }
    this.seed = cfg.seed !== undefined ? cfg.seed : Math.floor(Math.random() * 2147483647);
    this.rng = mulberry32(this.seed);

    this.window = new SlidingWindow(this.cfg.window, this.cfg.packets);
    this.receiver = new GoBackNReceiver();
    this.network = new Network({
      lossProb: this.cfg.loss / 100,
      corruptProb: this.cfg.corrupt / 100,
      delayMs: this.cfg.delay,
      seed: this.seed,
      scenario: this.cfg.scenario || (this.cfg.mode === 'demo' ? DEMO_SCENARIO : null)
    });
    this.stats = new Statistics();

    this.packets = [];
    this.log = [];
    this.traces = [];            // one row per transmission, for the network view
    this.receiverEvents = [];    // one row per receiver decision
    this.stepNo = 0;
    this.clock = 0;              // simulated time in ms
    this.lastActivityAt = 0;     // latest time any packet/ACK was still on its way
    this.timeoutMs = 2 * this.cfg.delay + 100;   // round trip + safety margin
    this.generated = false;
    this.finished = false;
    this.aborted = false;
    this.recovery = { active: false, triggered: false, from: 0, to: 0, resent: [] };
    this.lastCheck = null;       // details of the latest CRC check
    this.explain = 'Press Start or Next Step. The sender will first generate the packets.';
  }

  addLog(type, text) {
    if (this.cfg.quiet) return;
    this.log.push({ step: this.stepNo, wall: new Date().toTimeString().slice(0, 8), simMs: this.clock, type, text });
  }

  addReceiverEvent(id, cls, text) {
    this.receiverEvents.push({ id, cls, text });
    if (this.receiverEvents.length > 40) this.receiverEvents.shift();
  }

  // ---------------- one simulation step ----------------
  step() {
    if (this.finished) return null;
    this.stepNo++;
    if (!this.generated) return this.doGenerate();
    if (this.window.canSend()) return this.doSend();
    if (!this.network.isEmpty()) return this.doAdvance();
    if (GoBackNSender.shouldTimeout(this.window, this.network)) return this.doTimeout();
    this.complete();                    // safety net, normally unreachable
    return 'complete';
  }

  runToCompletion(maxSteps = 500000) {
    let n = 0;
    while (!this.finished && n++ < maxSteps) this.step();
    if (!this.finished) this.aborted = true;
  }

  // ---------------- 1. packet generation ----------------
  doGenerate() {
    this.packets = createPackets(this.cfg.packets, this.cfg.crc, this.rng, this.cfg.mode === 'demo');
    this.stats.totalPackets = this.packets.length;
    this.generated = true;
    const n = this.packets.length;
    this.addLog('info', `P1 to P${n} generated. Each has 8-bit data and a ${this.cfg.crc} checksum calculated by the sender.`);
    this.addLog('info', `Example: P1 data = ${this.packets[0].data}, ${this.cfg.crc} = ${this.packets[0].crcHex}`);
    this.explain = `The sender splits the data into ${n} packets. Every packet gets a sequence number and a ${this.cfg.crc} checksum calculated from its data bits.`;
    return 'generate';
  }

  // ---------------- 2. sending (first send and retransmission) ----------------
  doSend() {
    const seq = this.window.nextSeq;
    const p = this.packets[seq - 1];
    const isRetx = p.attempts > 0;

    p.attempts++;
    if (!isRetx) {
      p.firstSentAt = this.clock;
    } else {
      p.retransmitCount++;
      this.stats.retransmissions++;
      if (this.recovery.active) this.recovery.resent.push(p.id);
    }
    p.lastSentAt = this.clock;
    p.status = isRetx ? 'Retransmitting' : 'Sent';
    this.stats.transmissions++;

    const frame = this.network.transmit(p, this.clock);
    const trace = { id: p.id, retx: isRetx, outcome: 'transit' };
    frame.trace = trace;
    this.traces.push(trace);
    if (this.traces.length > 60) this.traces.shift();

    this.window.nextSeq++;
    this.stats.maxInFlight = Math.max(this.stats.maxInFlight, this.window.inFlightCount());
    this.clock += SEND_GAP_MS;

    const w = this.window;
    this.addLog(isRetx ? 'recovery' : 'info',
      `${p.id} ${isRetx ? 'retransmitted' : 'sent'} (data ${p.data}, ${p.crcName} ${p.crcHex}). Window now holds ${w.inFlightCount()} un-ACKed packet(s).`);
    this.explain = isRetx
      ? `The sender is retransmitting ${p.id}. After a Go-Back-N timeout it resends everything from the oldest unacknowledged packet.`
      : `The sender transmits ${p.id}. It may keep up to ${w.size} packets unacknowledged (base = P${w.base}), so it does not have to wait for each ACK.`;
    return 'send';
  }

  // ---------------- 3. network -> receiver -> ACK (one stage per step) ----------------
  doAdvance() {
    const frame = this.network.head();
    const p = frame.packet;
    this.lastActivityAt = Math.max(this.lastActivityAt, frame.arriveAt);

    // ---- stage A: the packet reaches the end of the network (or is lost) ----
    if (frame.stage === 'transit') {
      if (frame.fate === 'LOST') {
        p.status = 'Lost';
        p.lostCount++;
        this.stats.lostEvents++;
        frame.trace.outcome = 'lost';
        this.addReceiverEvent(p.id, 'lost', '❌ never arrived');
        this.addLog('bad', `${p.id} was lost in the network. The receiver is still waiting for P${this.receiver.expectedSeq}.`);
        this.explain = `Packet ${p.id} was lost during transmission. The receiver never sees it, so nothing is acknowledged for it. The receiver is still waiting for P${this.receiver.expectedSeq}.`;
        this.network.removeHead();
        return 'lost';
      }
      frame.stage = 'arrived';
      frame.trace.outcome = 'delivered';
      this.addLog('info', `${p.id} reached the receiver (received data ${frame.rxData}).`);
      this.explain = `${p.id} survived the network and reached the receiver. Next the receiver verifies it with the ${p.crcName} checksum.`;
      return 'arrive';
    }

    // ---- stage B: receiver checks CRC and sequence number ----
    if (frame.stage === 'arrived') {
      const rxCrc = parseInt(frame.rxCrcBits, 2);
      const calc = CRC.computeBits(frame.rxData, p.crcName);   // receiver recalculates CRC
      const crcOk = CRC.verify(frame.rxData, rxCrc, p.crcName); // REAL check, not random
      const expected = this.receiver.expectedSeq;
      const action = this.receiver.receive(p.seq, crcOk);
      const w = p.crcWidth;
      this.lastCheck = {
        id: p.id, original: p.data, received: frame.rxData, crcName: p.crcName,
        calc: CRC.toHex(calc, w), got: CRC.toHex(rxCrc, w), ok: crcOk, action
      };

      if (action === 'REJECT_CRC') {
        p.status = 'Corrupted';
        p.corruptCount++;
        this.stats.corruptedEvents++;
        frame.trace.outcome = 'crcerror';
        this.addReceiverEvent(p.id, 'corrupt', '✗ CRC ERROR');
        this.addLog('bad', `✗ CRC ERROR on ${p.id}: sent data ${p.data}, received ${frame.rxData}; calculated ${CRC.toHex(calc, w)} but packet carried ${CRC.toHex(rxCrc, w)}. Packet rejected, receiver still waits for P${expected}.`);
        this.explain = `The receiver recalculated the CRC of ${p.id} and it did not match the CRC carried in the packet, so the data was damaged. The packet is rejected and not acknowledged.`;
        this.network.removeHead();
        return 'crcerror';
      }
      if (action === 'ACCEPT') {
        p.status = 'Received';
        p.receivedAt = frame.arriveAt;
        this.stats.totalDelayMs += frame.arriveAt - p.firstSentAt;
        frame.stage = 'accepted';
        frame.trace.outcome = 'ok';
        this.addReceiverEvent(p.id, 'ok', '✓ accepted');
        this.addLog('ok', `✓ CRC VALID for ${p.id}. It is the expected packet, so it is accepted. Receiver now expects P${this.receiver.expectedSeq}.`);
        this.explain = `CRC verification confirms that ${p.id} is valid and it is the packet the receiver expected, so it is accepted and an ACK will be sent.`;
        return 'accept';
      }
      // out of order (or duplicate): CRC is fine, but there is a gap
      p.status = 'Out of order';
      this.stats.outOfOrder++;
      frame.trace.outcome = 'ooo';
      this.addReceiverEvent(p.id, 'ooo', '⚠ OUT OF ORDER');
      this.addLog('warn', `✓ CRC valid for ${p.id}, but the receiver expected P${expected}. ${p.id} is out of order, so it is discarded and not acknowledged.`);
      this.explain = `The receiver is waiting for P${expected}, so ${p.id} cannot be accepted in order. Go-Back-N receivers simply discard such packets; they will be sent again later.`;
      this.network.removeHead();
      return 'ooo';
    }

    // ---- stage C: ACK travels back and the window slides ----
    const ackAt = frame.arriveAt + this.cfg.delay;
    this.clock = Math.max(this.clock, ackAt);
    this.lastActivityAt = Math.max(this.lastActivityAt, ackAt);
    this.window.slideTo(p.seq);
    p.status = 'ACKed';
    p.ackedAt = ackAt;
    this.stats.acks++;
    this.stats.delivered++;
    frame.trace.outcome = 'acked';
    this.network.removeHead();
    this.addLog('ok', `ACK ${p.seq} received by the sender. Window slides: base = P${Math.min(this.window.base, this.cfg.packets)}${this.window.allAcked() ? ' (all done)' : ''}.`);
    this.explain = `The sender received ACK ${p.seq}, which confirms everything up to ${p.id}. The window slides forward so new packets can be sent.`;

    if (this.recovery.active && this.window.base > this.recovery.to) {
      this.recovery.active = false;
      this.addLog('recovery', 'Go-Back-N recovery complete: all packets that were sent again have been acknowledged.');
    }
    if (this.window.allAcked()) this.complete();
    return 'ack';
  }

  // ---------------- 4. timeout -> Go-Back-N ----------------
  doTimeout() {
    const base = this.window.base;
    const baseP = this.packets[base - 1];
    // The timer of the oldest un-ACKed packet expires (we wait until the network is quiet)
    const expiry = Math.max(baseP.lastSentAt + this.timeoutMs, this.lastActivityAt);
    this.clock = Math.max(this.clock, expiry);

    const r = GoBackNSender.trigger(this.window, this.packets);   // go back to base
    this.stats.gbnEvents++;
    this.recovery = { active: true, triggered: true, from: r.from, to: r.to, resent: [] };

    this.addLog('bad', `Timeout: no ACK received for P${base}.`);
    this.addLog('recovery', `GO-BACK-N RETRANSMISSION TRIGGERED: the sender goes back to P${r.from} and will resend P${r.from} to P${r.to}.`);
    this.explain = `The ACK for P${base} never came, so its timer expired. Go-Back-N retransmission has been triggered: the sender goes back to P${base} and resends it and every packet after it (P${r.from} to P${r.to}).`;
    return 'timeout';
  }

  complete() {
    this.finished = true;
    this.addLog('ok', `All ${this.cfg.packets} packets were delivered in order. Simulation finished at ${Math.round(this.clock)} ms of simulated time.`);
    this.explain = 'Every packet was delivered in order and acknowledged. Check the performance statistics and charts.';
  }

  summary() { return this.stats.summary(this.clock); }
}
