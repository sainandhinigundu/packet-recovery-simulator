/* ============================================================
   statistics.js  -  Counters, formulas and batch experiments
   ============================================================ */

class Statistics {
  // Each packet represents a 1000-byte frame for throughput purposes
  // (the 8-bit string is the sample data the CRC is computed on).
  static PACKET_BYTES = 1000;

  constructor() {
    this.totalPackets = 0;
    this.delivered = 0;        // packets accepted in order AND acknowledged
    this.lostEvents = 0;       // packets destroyed by the network
    this.corruptedEvents = 0;  // packets rejected by the CRC check
    this.outOfOrder = 0;       // packets discarded because of a gap
    this.transmissions = 0;    // every send (first sends + resends)
    this.retransmissions = 0;  // sends that were repeats
    this.acks = 0;
    this.gbnEvents = 0;
    this.totalDelayMs = 0;     // sum of (receive time - first send time)
    this.maxInFlight = 0;      // largest number of un-ACKed packets seen
  }

  // timeMs = total simulated transmission time so far
  summary(timeMs) {
    const T = this.totalPackets;
    return {
      totalPackets: T,
      delivered: this.delivered,
      lost: this.lostEvents,
      corrupted: this.corruptedEvents,
      outOfOrder: this.outOfOrder,
      retransmissions: this.retransmissions,
      transmissions: this.transmissions,
      acks: this.acks,
      gbnEvents: this.gbnEvents,
      // Packet Loss % = (Lost / Total Packets) x 100
      lossPct: T ? (this.lostEvents / T) * 100 : 0,
      lossPerTxPct: this.transmissions ? (this.lostEvents / this.transmissions) * 100 : 0,
      // Success Rate = (Delivered / Total Packets) x 100
      successRate: T ? (this.delivered / T) * 100 : 0,
      // Average Delay = Total Delay / Delivered packets   (ms)
      avgDelayMs: this.delivered ? this.totalDelayMs / this.delivered : 0,
      completionMs: timeMs,
      // Throughput = delivered bits / time.  bits per ms == Kbps
      throughputKbps: timeMs > 0 ? (this.delivered * Statistics.PACKET_BYTES * 8) / timeMs : 0
    };
  }

  // Run many headless simulations (same settings, different seeds) and average them.
  static runBatch(cfg, runs) {
    const sum = { transmissions: 0, retransmissions: 0, throughputKbps: 0, avgDelayMs: 0, completionMs: 0, lost: 0 };
    for (let i = 0; i < runs; i++) {
      const sim = new Simulation(Object.assign({}, cfg, { mode: 'normal', seed: 1000 + i * 7919, quiet: true }));
      sim.runToCompletion();
      const s = sim.summary();
      for (const key in sum) sum[key] += s[key];
    }
    for (const key in sum) sum[key] /= runs;
    return sum;
  }
}
