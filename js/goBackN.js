/* ============================================================
   goBackN.js  -  Go-Back-N ARQ (sender recovery + receiver rules)
   ------------------------------------------------------------
   RECEIVER rule : accepts ONLY the packet it expects next.
                   Anything else (corrupted / out of order) is
                   discarded and NOT acknowledged.
   SENDER rule   : if the oldest unacknowledged packet (base) is
                   never ACKed, a timeout occurs and the sender
                   "goes back" to base and resends base, base+1, ...
   ============================================================ */

class GoBackNReceiver {
  constructor() {
    this.expectedSeq = 1;   // next in-order packet the receiver wants
    this.delivered = [];    // packets accepted in order
  }

  // crcOk comes from a REAL CRC check done by the caller
  receive(seq, crcOk) {
    if (!crcOk) return 'REJECT_CRC';                 // corrupted -> reject
    if (seq === this.expectedSeq) {                  // correct packet -> accept
      this.delivered.push(seq);
      this.expectedSeq++;
      return 'ACCEPT';
    }
    if (seq < this.expectedSeq) return 'DISCARD_DUPLICATE';
    return 'DISCARD_OUT_OF_ORDER';                   // a gap exists -> discard
  }
}

const GoBackNSender = {
  // Timeout condition: window is stuck (cannot send more), nothing is
  // travelling in the network, yet some packets are still un-ACKed.
  shouldTimeout(window, network) {
    return !window.allAcked() && !window.canSend() && network.isEmpty();
  },

  // GO BACK: move nextSeq back to base so base..oldNext-1 are sent again.
  trigger(window, packets) {
    const from = window.base;
    const to = window.nextSeq - 1;
    for (let s = from; s <= to; s++) packets[s - 1].status = 'Queued';
    window.nextSeq = from;           // <-- this single line IS "go back N"
    return { from, to };
  }
};
