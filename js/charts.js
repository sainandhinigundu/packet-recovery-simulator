/* ============================================================
   charts.js  -  The five Chart.js charts (real simulation data)
   ============================================================ */

const ChartManager = {
  charts: {},

  available() { return typeof Chart !== 'undefined'; },

  make(canvasId, type, datasets, labels, xTitle, yTitle) {
    const scales = (type === 'doughnut') ? {} : {
      x: { title: { display: !!xTitle, text: xTitle } },
      y: { beginAtZero: true, title: { display: !!yTitle, text: yTitle } }
    };
    return new Chart(document.getElementById(canvasId), {
      type,
      data: { labels, datasets },
      options: { responsive: true, maintainAspectRatio: false, animation: false, scales }
    });
  },

  init() {
    if (!this.available()) return false;
    const C = this.charts;
    C.status = this.make('chartStatus', 'doughnut',
      [{ data: [0, 0, 0, 0], backgroundColor: ['#2f9e44', '#e03131', '#f08c00', '#7048e8'] }],
      ['Successful', 'Lost', 'Corrupted', 'Retransmitted']);
    C.perPacket = this.make('chartPerPacket', 'bar', [
      { label: 'Lost / corrupted events', data: [], backgroundColor: '#e03131' },
      { label: 'Retransmissions', data: [], backgroundColor: '#7048e8' }
    ], [], 'Packet', 'Count');
    C.lossThroughput = this.make('chartLossThroughput', 'line',
      [{ label: 'Throughput (Kbps)', data: [], borderColor: '#1c7ed6', backgroundColor: '#1c7ed6' }], [],
      'Packet loss probability (%)', 'Throughput (Kbps)');
    C.lossRetx = this.make('chartLossRetx', 'line',
      [{ label: 'Retransmissions', data: [], borderColor: '#7048e8', backgroundColor: '#7048e8' }], [],
      'Packet loss probability (%)', 'Retransmissions');
    C.windowThroughput = this.make('chartWindowThroughput', 'bar',
      [{ label: 'Throughput (Kbps)', data: [], backgroundColor: '#1c7ed6' }], [],
      'Window size', 'Throughput (Kbps)');
    return true;
  },

  set(chart, labels, ...series) {
    chart.data.labels = labels;
    series.forEach((d, i) => { chart.data.datasets[i].data = d; });
    chart.update('none');
  },

  // Charts 1 and 2 follow the running simulation
  updateLive(sim) {
    if (!this.available() || !sim) return;
    const s = sim.stats;
    this.set(this.charts.status, this.charts.status.data.labels,
      [s.delivered, s.lostEvents, s.corruptedEvents, s.retransmissions]);
    this.set(this.charts.perPacket, sim.packets.map(p => p.id),
      sim.packets.map(p => p.lostCount + p.corruptCount),
      sim.packets.map(p => p.retransmitCount));
  },

  // Charts 3 and 4 (loss sweep) and 5 (window sweep) come from "Run analysis"
  setLossSweep(rows) {
    if (!this.available()) return;
    const labels = rows.map(r => r.loss + '%');
    this.set(this.charts.lossThroughput, labels, rows.map(r => +r.throughputKbps.toFixed(2)));
    this.set(this.charts.lossRetx, labels, rows.map(r => +r.retransmissions.toFixed(2)));
  },

  setWindowSweep(rows) {
    if (!this.available()) return;
    this.set(this.charts.windowThroughput, rows.map(r => r.window), rows.map(r => +r.throughputKbps.toFixed(2)));
  },

  reset() {
    if (!this.available()) return;
    const C = this.charts;
    this.set(C.status, C.status.data.labels, [0, 0, 0, 0]);
    this.set(C.perPacket, [], [], []);
    this.set(C.lossThroughput, [], []);
    this.set(C.lossRetx, [], []);
    this.set(C.windowThroughput, [], []);
  }
};
