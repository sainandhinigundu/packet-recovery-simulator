# 1. Project Title
**Reliable Data Transmission and Packet Recovery Simulator using Sliding Window and Go-Back-N**

# 2. Introduction
The Internet is unreliable: packets can be lost, damaged or arrive out of order. Protocols such as TCP hide this from applications using acknowledgements, retransmission and error detection. This project is an interactive browser simulation of that idea. A Sender sends packets through a simulated Network to a Receiver. The simulation is purely local (JavaScript random numbers); no real network traffic is sent or modified.

# 3. Problem Statement
Design and simulate a protocol that delivers a stream of packets reliably and in order over a channel that randomly loses and corrupts packets, and measure its performance.

# 4. Objectives
- Demonstrate the Sliding Window protocol and Go-Back-N ARQ.
- Detect corruption with real CRC-12, CRC-16 and CRC-CCITT calculations.
- Recover from loss and corruption using ACKs, timeouts and retransmission.
- Measure throughput, delay, loss percentage and retransmissions, and compare window sizes.

# 5. Features
- Real CRC computed at the sender and re-checked at the receiver (never a fake "CRC error").
- Sliding window with base / next sequence number shown live.
- Random loss and corruption with user-set probabilities (Normal mode) and a fixed, repeatable Demo mode.
- Next Step button: one meaningful event per click. Start / Pause / Resume / Reset.
- Live log, "How it works" explanations, status colours, receiver and recovery panels.
- Statistics computed from the actual run, five Chart.js charts, window-size comparison table.

# 6. Technologies Used
HTML, CSS, JavaScript (no backend, no database), Chart.js (loaded from a CDN).

# 7. System Architecture
```
+----------+     +-----------+     +------------+
|  SENDER  | --> |  NETWORK  | --> |  RECEIVER  |
| window,  | <-- | loss,     |     | expected   |
| timer,   |     | corruption|     | seq, CRC   |
| GBN      | ACK | delay     |     | check      |
+----------+     +-----------+     +------------+
```
`simulation.js` drives all modules; `app.js` only draws the screen.

# 8. Project Workflow
Data -> packet generation (data + CRC) -> sliding window -> simulated network (OK / lost / corrupted) -> receiver CRC + sequence check -> ACK -> window slides. If the oldest packet is never ACKed -> timeout -> Go-Back-N -> retransmission -> delivery -> statistics.

# 9. Sliding Window Explanation
The sender may have at most `W` unacknowledged packets. `base` is the oldest unacknowledged packet, `nextSeq` the next to send. A packet can be sent only if `nextSeq < base + W`. When ACK `n` arrives, `base = n + 1` and the window slides. With `W = 1` this is stop-and-wait.

# 10. Go-Back-N Explanation
The receiver accepts only the packet it expects and discards everything else. If P3 is lost, P4 and P5 are discarded as out of order and not acknowledged. The sender's timer for P3 expires, so it goes back (`nextSeq = base`) and resends P3, P4, P5. That is why Go-Back-N retransmits several packets.
*Simulation note:* the sender evaluates its timeout once the network is quiet (nothing left in flight), and the simulated clock jumps to the expiry time.

# 11. CRC Explanation
The data bits are divided (modulo-2, using XOR) by a generator polynomial; the remainder is the CRC.

| Algorithm | Width | Polynomial | Init |
|---|---|---|---|
| CRC-12 | 12 bit | x^12+x^11+x^3+x^2+x+1 (0x80F) | 0x000 |
| CRC-16 | 16 bit | x^16+x^15+x^2+1 (0x8005) | 0x0000 |
| CRC-CCITT | 16 bit | x^16+x^12+x^5+1 (0x1021) | 0xFFFF |

The sender sends `data + CRC`. The receiver recomputes the CRC on the received data and compares. Known-answer tests (`"123456789"` gives 0xF5B, 0xFEE8, 0x29B1) are in `tests/test.js`.

# 12. Packet Loss Simulation
For every transmission the network draws a random number; if it is below the loss probability, the packet is destroyed and the receiver never sees it. Fates depend on (seed, sequence number, attempt), so comparisons between window sizes face identical bad luck.

# 13. Packet Corruption Simulation
If a packet is corrupted, 1 to 3 random bits of the transmitted data + CRC bits are flipped. The receiver's real CRC check then fails and the packet is rejected.

# 14. ACK Mechanism
ACKs are cumulative: ACK n means all packets up to n arrived in order. ACKs are sent only for accepted packets. They are assumed reliable and take one delay to return.

# 15. Retransmission Mechanism
After a Go-Back-N trigger the sender sets `nextSeq = base`, and the normal send logic resends those packets (marked "Retransmitting"). Retransmitted packets can be lost or corrupted again.

# 16. Performance Metrics
- Packet loss % = lost packets / total packets x 100
- Success rate = delivered / total packets x 100
- Average delay = total delay / delivered packets (delay = time from first send to receipt)
- Throughput = delivered bits / total simulated time (each packet represents 1000 bytes; bits per ms = Kbps)
- Also: transmissions, retransmissions, ACKs, Go-Back-N events, out-of-order discards, completion time.

# 17. Folder Structure
```
packet-recovery-simulator/
├── index.html
├── css/style.css
├── js/
│   ├── crc.js            real CRC-12 / CRC-16 / CRC-CCITT
│   ├── packet.js         Packet class and generation
│   ├── slidingWindow.js  base / nextSeq / window rules
│   ├── goBackN.js        GBN receiver rules and sender go-back
│   ├── network.js        seeded loss and corruption
│   ├── statistics.js     counters, formulas, batch runs
│   ├── simulation.js     step engine (ties all together)
│   ├── charts.js         five Chart.js charts
│   └── app.js            buttons and drawing
├── tests/test.js         automated tests (Node)
└── README.md
```

# 18. How to Run
1. Unzip the folder and open it in VS Code.
2. Open `index.html` in a browser (double-click, or use the *Live Server* extension).
3. An internet connection is needed once per load for Chart.js (CDN). For offline use, download `chart.umd.min.js` into a new `assets/` folder and change the `<script src>` in `index.html` to `assets/chart.umd.min.js`.
4. Optional automated tests: `node tests/test.js`.

# 19. Test Cases
| Test | Setup | Expected |
|---|---|---|
| 1 | Loss 0%, corruption 0% | All delivered, 0 retransmissions |
| 2 | Demo mode (P3 lost) | Go-Back-N once, P3-P5 resent |
| 3 | P4 corrupted | CRC error, packet rejected, recovery |
| 4 | Window 1 | Never more than 1 packet in flight |
| 5 | Window 4 | 4 packets in flight |
| 6 | Loss 50% vs 0% | More retransmissions, lower throughput |

# 20. Sample Output
Demo mode (5 packets, window 4, CRC-16, delay 500 ms):
```
[Step 2]  P1 sent (data 10110101, CRC-16 0x83BD)
[Step 7]  CRC VALID for P1. Receiver now expects P2.
[Step 8]  ACK 1 received by the sender. Window slides: base = P2.
[Step 13] P3 was lost in the network. The receiver is still waiting for P3.
[Step 15] CRC valid for P4, but the receiver expected P3. Discarded.
[Step 18] GO-BACK-N RETRANSMISSION TRIGGERED: back to P3, resend P3 to P5.
[Step 19-21] P3, P4, P5 retransmitted
[Step 30] All 5 packets delivered in order (2520 ms simulated).
```
Statistics: 5 delivered, 1 lost, 0 corrupted, 3 retransmissions, 8 transmissions, 5 ACKs, 1 Go-Back-N event, loss 20%, success 100%, average delay 1196 ms, throughput 15.87 Kbps.

# 21. Future Scope
Selective Repeat and a protocol comparison, lost ACKs, true packet reordering, adaptive timeout (RTT estimation), congestion control, bandwidth settings, exporting results to CSV.
