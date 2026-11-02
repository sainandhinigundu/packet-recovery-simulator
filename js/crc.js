/* ============================================================
   crc.js  -  REAL Cyclic Redundancy Check (bit-by-bit division)
   ------------------------------------------------------------
   A CRC treats the data bits as one long binary polynomial and
   divides it by a fixed "generator polynomial" using XOR
   (modulo-2 division).  The remainder is the CRC.
   Sender : appends CRC to the data.
   Receiver: recomputes CRC on the received data and compares.
   ============================================================ */

const CRC = {
  // width = number of CRC bits, poly = generator polynomial
  // (the leading x^width term is implied), init = starting register value
  algorithms: {
    'CRC-12':    { width: 12, poly: 0x80F,  init: 0x000,  text: 'x^12 + x^11 + x^3 + x^2 + x + 1' },
    'CRC-16':    { width: 16, poly: 0x8005, init: 0x0000, text: 'x^16 + x^15 + x^2 + 1' },
    'CRC-CCITT': { width: 16, poly: 0x1021, init: 0xFFFF, text: 'x^16 + x^12 + x^5 + 1' }
  },

  // Compute the CRC of a string of '0'/'1' characters.
  computeBits(bitString, algoName) {
    const a = this.algorithms[algoName];
    const mask = (1 << a.width) - 1;       // keeps the register at 'width' bits
    const topBit = 1 << (a.width - 1);     // the bit that is shifted out
    let reg = a.init;

    for (const ch of bitString) {
      const inputBit = ch === '1' ? 1 : 0;
      const feedback = ((reg & topBit) ? 1 : 0) ^ inputBit; // MSB XOR next data bit
      reg = (reg << 1) & mask;                              // shift left by one
      if (feedback) reg ^= a.poly;                          // "subtract" generator (XOR)
    }
    return reg;
  },

  // Receiver side: recalculate CRC on the received data and compare.
  verify(receivedDataBits, receivedCrcValue, algoName) {
    return this.computeBits(receivedDataBits, algoName) === receivedCrcValue;
  },

  toBinary(value, width) { return value.toString(2).padStart(width, '0'); },
  toHex(value, width) { return '0x' + value.toString(16).toUpperCase().padStart(Math.ceil(width / 4), '0'); },
  textToBits(text) { return [...text].map(c => c.charCodeAt(0).toString(2).padStart(8, '0')).join(''); }
};
