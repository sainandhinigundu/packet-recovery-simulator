/* ============================================================
   slidingWindow.js  -  Sender-side Sliding Window
   ------------------------------------------------------------
   base    = oldest packet that is still NOT acknowledged
   nextSeq = next packet that has never been sent in this round
   The sender may have at most `size` unacknowledged packets:
        base <= packets that may be sent < base + size
   The window only slides when an ACK arrives.
   ============================================================ */

class SlidingWindow {
  constructor(size, totalPackets) {
    this.size = size;
    this.total = totalPackets;
    this.base = 1;
    this.nextSeq = 1;
  }

  // Is there room in the window and a packet left to send?
  canSend() {
    return this.nextSeq <= this.total && this.nextSeq < this.base + this.size;
  }

  allAcked() { return this.base > this.total; }

  // Cumulative ACK n means "all packets up to n arrived": slide the window.
  slideTo(ackSeq) {
    if (ackSeq >= this.base) this.base = ackSeq + 1;
  }

  // Sequence numbers currently covered by the window, e.g. [3,4,5,6]
  seqsInWindow() {
    const list = [];
    for (let s = this.base; s < this.base + this.size && s <= this.total; s++) list.push(s);
    return list;
  }

  // Packets sent but not yet acknowledged
  inFlightCount() { return this.nextSeq - this.base; }
}
