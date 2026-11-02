/* ============================================================
   packet.js  -  Packet structure and packet generation
   ============================================================ */

// Fixed data used in Demo Mode so the demo is always identical
const DEMO_DATA = ['10110101', '01101100', '11100010', '00111001', '10001111'];

class Packet {
  constructor(seq, data, crcName) {
    this.id = 'P' + seq;          // Packet ID
    this.seq = seq;               // Sequence number
    this.data = data;             // 8-bit data
    this.crcName = crcName;
    this.crc = CRC.computeBits(data, crcName);   // REAL CRC computed by the sender
    this.status = 'Waiting';      // Waiting/Sent/Received/Lost/Corrupted/Retransmitting/ACKed...

    // Bookkeeping used for statistics
    this.attempts = 0;            // how many times it was transmitted
    this.firstSentAt = null;      // simulated time (ms) of first transmission
    this.lastSentAt = null;
    this.receivedAt = null;
    this.ackedAt = null;
    this.lostCount = 0;
    this.corruptCount = 0;
    this.retransmitCount = 0;
  }

  get crcWidth() { return CRC.algorithms[this.crcName].width; }
  get crcBits() { return CRC.toBinary(this.crc, this.crcWidth); }
  get crcHex() { return CRC.toHex(this.crc, this.crcWidth); }
  // What actually travels on the wire: data bits followed by CRC bits
  get codeword() { return this.data + this.crcBits; }
}

function createPackets(count, crcName, rng, useDemoData) {
  const packets = [];
  for (let seq = 1; seq <= count; seq++) {
    let data;
    if (useDemoData && DEMO_DATA[seq - 1]) {
      data = DEMO_DATA[seq - 1];
    } else {
      data = '';
      for (let i = 0; i < 8; i++) data += rng() < 0.5 ? '0' : '1';
    }
    packets.push(new Packet(seq, data, crcName));
  }
  return packets;
}
