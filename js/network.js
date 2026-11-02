/* ============================================================
   network.js  -  The simulated unreliable network
   ------------------------------------------------------------
   Everything is local random numbers - nothing touches the
   real Internet.  A packet's fate (OK / LOST / CORRUPT) is a
   function of (seed, sequence number, attempt number), so the
   window-size comparison faces the SAME bad luck for every window.
   ============================================================ */

// Small, fast seeded random number generator (returns 0..1)
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Network {
  constructor(opts) {
    this.lossProb = opts.lossProb;         // 0..1
    this.corruptProb = opts.corruptProb;   // 0..1
    this.delayMs = opts.delayMs;           // one-way delay
    this.seed = opts.seed;
    this.scenario = opts.scenario || null; // e.g. {'3:1':'LOST'} for Demo Mode
    this.frames = [];                      // packets currently travelling (FIFO)
  }

  rngFor(seq, attempt) {
    const mixed = (this.seed ^ Math.imul(seq, 0x9E3779B1) ^ Math.imul(attempt, 0x85EBCA6B)) >>> 0;
    const rng = mulberry32(mixed);
    rng(); rng();                          // warm up
    return rng;
  }

  decideFate(seq, attempt, rng) {
    if (this.scenario) return this.scenario[seq + ':' + attempt] || 'OK';
    if (rng() < this.lossProb) return 'LOST';
    if (rng() < this.corruptProb) return 'CORRUPT';
    return 'OK';
  }

  // Flip 1-3 random bits of the transmitted codeword (data + CRC bits)
  corruptBits(bits, rng) {
    const arr = bits.split('');
    const flips = 1 + Math.floor(rng() * 3);
    const positions = new Set();
    while (positions.size < Math.min(flips, arr.length)) positions.add(Math.floor(rng() * arr.length));
    positions.forEach(i => { arr[i] = arr[i] === '1' ? '0' : '1'; });
    return arr.join('');
  }

  // Put a packet on the wire; returns the "frame" that will reach the receiver
  transmit(packet, sentAt) {
    const attempt = packet.attempts;
    const rng = this.rngFor(packet.seq, attempt);
    const fate = this.decideFate(packet.seq, attempt, rng);

    let wire = packet.codeword;
    if (fate === 'CORRUPT') wire = this.corruptBits(wire, rng);

    const frame = {
      packet,
      fate,
      attempt,
      sentAt,
      arriveAt: sentAt + this.delayMs,
      rxData: wire.slice(0, packet.data.length),     // data bits as received
      rxCrcBits: wire.slice(packet.data.length),     // CRC bits as received
      stage: 'transit',
      trace: null
    };
    this.frames.push(frame);
    return frame;
  }

  isEmpty() { return this.frames.length === 0; }
  head() { return this.frames[0]; }
  removeHead() { this.frames.shift(); }
}
