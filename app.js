/**
 * BLOCK PRESSURE — Bitcoin Mempool Live Visualization
 * RoxomTV — Broadcast-only, zero interaction
 */

const CONFIG = {
  WS_URL: 'wss://mempool.space/api/v1/ws',
  USE_MOCK_DATA: false,
  RECONNECT_BASE_DELAY: 1000,
  RECONNECT_MAX_DELAY: 30000,
  CHART_WINDOW_MINUTES: 20,
  CHART_BUCKET_SECONDS: 10,
  TICKER_BASE_SPEED: 100,
  TICKER_MAX_SPEED: 180,
  TICKER_MIN_SPEED: 60,
  TICKER_BUFFER_SIZE: 500,
  ORDER_BOOK_TIERS: [
    { min: 300, max: Infinity, label: '300+' },
    { min: 200, max: 299, label: '200-299' },
    { min: 150, max: 199, label: '150-199' },
    { min: 100, max: 149, label: '100-149' },
    { min: 80, max: 99, label: '80-99' },
    { min: 60, max: 79, label: '60-79' },
    { min: 50, max: 59, label: '50-59' },
    { min: 40, max: 49, label: '40-49' },
    { min: 30, max: 39, label: '30-39' },
    { min: 20, max: 29, label: '20-29' },
    { min: 0, max: 19, label: '<20' },
  ],
  BLOCK_CAPACITY_VBYTES: 4_000_000,
  WHALE_THRESHOLD_SATS: 10_000_000_000,
  SUPER_WHALE_THRESHOLD_SATS: 100_000_000_000,
  CONGESTION_FEE_THRESHOLD: 100,
  SLOW_BLOCK_THRESHOLD_MINUTES: 20,
  DOM_UPDATE_INTERVAL: 250,
  MEMPOOL_REST_FETCH_INTERVAL: 5000,
  HUD_TOTAL_BTC_UPDATE_INTERVAL: 5000,
  TOAST_DURATION: 5000,
  TOAST_FADE_DURATION: 300,
  GRAIN_OPACITY: 0.03,
  GRAIN_REFRESH_INTERVAL: 2000,
  MOCK_TXS_PER_SEC: { min: 5, max: 12 },
  CHART_CONFIRMED_BASELINE_BTC: 0.04,
  MOCK_BLOCK_INTERVAL_MS: 120000,
};

const FEE_COLORS = {
  veryHigh: '#ff3333',
  high: '#ff6b00',
  mediumHigh: '#f0a500',
  medium: '#c8b800',
  lowMedium: '#4a9eff',
  low: '#2a6aaa',
  veryLow: '#1a3a6b',
};

function getFeeColor(feeRate) {
  if (feeRate >= 200) return FEE_COLORS.veryHigh;
  if (feeRate >= 100) return FEE_COLORS.high;
  if (feeRate >= 60) return FEE_COLORS.mediumHigh;
  if (feeRate >= 40) return FEE_COLORS.medium;
  if (feeRate >= 20) return FEE_COLORS.lowMedium;
  if (feeRate >= 10) return FEE_COLORS.low;
  return FEE_COLORS.veryLow;
}

function satsToBtc(sats) {
  return sats / 100_000_000;
}

function shortTxid(txid) {
  if (!txid || txid.length < 16) return txid || '—';
  return txid.slice(0, 8) + '···' + txid.slice(-4);
}

function formatBtc(value) {
  if (value >= 1) return `${value.toFixed(3)}`;
  if (value >= 0.001) return `${value.toFixed(6)}`;
  return `${Math.round(value * 100_000_000)} sats`;
}

function logNormal(mean, sigma) {
  const u = Math.random();
  const v = Math.random();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return Math.exp(mean + sigma * z);
}

// ========== WebSocketManager ==========
class WebSocketManager {
  constructor(onMessage, onStateChange) {
    this.onMessage = onMessage;
    this.onStateChange = onStateChange;
    this.ws = null;
    this.reconnectDelay = CONFIG.RECONNECT_BASE_DELAY;
    this.reconnectTimer = null;
  }

  connect() {
    if (CONFIG.USE_MOCK_DATA) return;
    this.onStateChange('connecting');
    try {
      this.ws = new WebSocket(CONFIG.WS_URL);
      this.ws.onopen = () => {
        this.reconnectDelay = CONFIG.RECONNECT_BASE_DELAY;
        this.ws.send(JSON.stringify({ action: 'want', data: ['live-2h-chart', 'stats', 'mempool-blocks', 'blocks', 'transactions'] }));
        this.onStateChange('connected');
      };
      this.ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          this.onMessage(data);
        } catch (_) {}
      };
      this.ws.onclose = () => {
        this.onStateChange('disconnected');
        this.scheduleReconnect();
      };
      this.ws.onerror = () => {};
    } catch (e) {
      this.onStateChange('error');
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, CONFIG.RECONNECT_MAX_DELAY);
    }, this.reconnectDelay);
  }

  disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) this.ws.close();
  }
}

// ========== MempoolState ==========
class MempoolState {
  constructor() {
    this.blockHeight = 0;
    this.lastBlockTime = Date.now();
    this.mempoolCount = 0;
    this.mempoolSize = 0;
    this.feeMedian = 0;
    this.hashrate = 0;
    this.lastBlockTxCount = 0;
    this.lastBlockReward = 0;
    this.transactions = [];
    this.feeHistogram = [];
    this.recommendedFees = {};
    this.minFeeForBlock = 0;
    this.totalBtcInMempool = 0;
    this.tierData = {};
  }

  processMessage(data) {
    // --- blocks: only update lastBlockTime on NEW blocks (height increase) ---
    if (data.blocks) {
      const blocks = data.blocks;
      let newHeight = 0;
      let blockObj = null;
      if (typeof blocks === 'number') {
        newHeight = blocks;
      } else if (Array.isArray(blocks) && blocks.length > 0) {
        const b = blocks[blocks.length - 1];
        if (b && typeof b === 'object' && b.height) {
          newHeight = b.height;
          blockObj = b;
        } else if (typeof b === 'number') {
          newHeight = b;
        }
      } else if (typeof blocks === 'object' && !Array.isArray(blocks) && blocks.height) {
        newHeight = blocks.height;
        blockObj = blocks;
      }
      if (newHeight > 0) {
        const isNewBlock = newHeight > this.blockHeight && this.blockHeight > 0;
        this.blockHeight = newHeight;
        if (isNewBlock) {
          this.lastBlockTime = Date.now();
        }
        if (blockObj) {
          this.lastBlockTxCount = blockObj.tx_count || 0;
          this.lastBlockReward = blockObj.extras?.reward || 3.125;
          if (blockObj.timestamp && !isNewBlock) {
            this.lastBlockTime = blockObj.timestamp * 1000;
          }
        }
      }
    }

    // --- mempoolInfo ---
    if (data.mempoolInfo) {
      this.mempoolCount = data.mempoolInfo.size || data.mempoolInfo.count || 0;
      this.mempoolSize = data.mempoolInfo.bytes || data.mempoolInfo.vsize || 0;
    }

    // --- live-2h-chart (blocks only, txs handled in handleWsMessage) ---
    if (data['live-2h-chart']) {
      const chart = data['live-2h-chart'];
      if (chart.blocks) this.blockHeight = chart.blocks[chart.blocks.length - 1]?.height || this.blockHeight;
    }

    // --- stats ---
    if (data.stats) {
      this.mempoolCount = data.stats.count || data.stats.mempool_count || this.mempoolCount;
      this.mempoolSize = data.stats.vsize || data.stats.mempool_size || data.stats.size || this.mempoolSize;
      this.feeMedian = data.stats.medianFee || data.stats.fee_median || data.stats.avgFee_median || this.feeMedian;
      this.hashrate = data.stats.hashrate || data.stats.hashrate_24h || 0;
    }
    if (data.avgFee_median !== undefined) this.feeMedian = data.avgFee_median;
    if (data.medianFee !== undefined) this.feeMedian = data.medianFee;

    // --- mempool-blocks ---
    if (data['mempool-blocks']) {
      const mb = data['mempool-blocks'];
      const blocks = Array.isArray(mb) ? mb : [mb];
      if (blocks.length > 0) {
        const first = blocks[0];
        this.minFeeForBlock = first.medianFee || first.feeRange?.[0] || this.minFeeForBlock;
      }
    }

    if (data.fee_histogram) this.feeHistogram = data.fee_histogram;
    if (data.recommendedFees) this.recommendedFees = data.recommendedFees;
    this.recomputeTiers();
  }

  addTx(tx) {
    const txid = tx.txid || tx.id;
    const value = tx.value ?? tx.amount ?? 0;
    const feeRate = tx.feeRate ?? tx.fee_rate ?? tx.rate ?? 0;
    const vsize = tx.vsize ?? tx.vSize ?? tx.size ?? 250;
    const firstSeen = tx.firstSeen ?? tx.first_seen ?? Date.now() / 1000;
    const t = { txid, value, feeRate, vsize, firstSeen, btc: satsToBtc(value) };
    const existing = this.transactions.findIndex(x => x.txid === txid);
    if (existing >= 0) this.transactions.splice(existing, 1);
    this.transactions.push(t);
    if (this.transactions.length > CONFIG.TICKER_BUFFER_SIZE * 2) {
      this.transactions = this.transactions.slice(-CONFIG.TICKER_BUFFER_SIZE);
    }
    return t;
  }

  recomputeTiers() {
    if (this.transactions.length === 0 && Object.values(this.tierData).some(t => t.vbytes > 0)) return;
    const tiers = {};
    for (const tier of CONFIG.ORDER_BOOK_TIERS) {
      tiers[tier.label] = { vbytes: 0, btc: 0 };
    }
    let totalVbytes = 0;
    for (const tx of this.transactions) {
      for (const tier of CONFIG.ORDER_BOOK_TIERS) {
        if (tx.feeRate >= tier.min && tx.feeRate <= tier.max) {
          tiers[tier.label].vbytes += tx.vsize;
          tiers[tier.label].btc += tx.btc;
          totalVbytes += tx.vsize;
          break;
        }
      }
    }
    this.tierData = tiers;
    this.totalBtcInMempool = Object.values(tiers).reduce((s, t) => s + t.btc, 0);
    let acc = 0;
    for (const tier of CONFIG.ORDER_BOOK_TIERS) {
      acc += tiers[tier.label].vbytes;
      if (acc >= CONFIG.BLOCK_CAPACITY_VBYTES) {
        this.minFeeForBlock = tier.min;
        break;
      }
    }
    if (!this.minFeeForBlock && this.feeMedian) this.minFeeForBlock = Math.round(this.feeMedian);
  }

  getTiersForBlock() {
    let acc = 0;
    const above = [];
    const below = [];
    for (const tier of CONFIG.ORDER_BOOK_TIERS) {
      const d = this.tierData[tier.label] || { vbytes: 0, btc: 0 };
      const row = { ...tier, ...d };
      if (acc < CONFIG.BLOCK_CAPACITY_VBYTES) {
        above.push(row);
        acc += d.vbytes;
      } else {
        below.push(row);
      }
    }
    return { above, below };
  }

  getBlockCapacityPercent() {
    return Math.min(100, (this.mempoolSize / CONFIG.BLOCK_CAPACITY_VBYTES) * 100);
  }

  getBlocksBacklog() {
    return this.mempoolSize > 0 ? Math.ceil(this.mempoolSize / CONFIG.BLOCK_CAPACITY_VBYTES) : 0;
  }

  applyFeeHistogram(feeHistogram, totalVsize, totalFee) {
    if (!feeHistogram || !Array.isArray(feeHistogram)) return;
    const tiers = {};
    for (const tier of CONFIG.ORDER_BOOK_TIERS) {
      tiers[tier.label] = { vbytes: 0, btc: 0 };
    }
    for (const entry of feeHistogram) {
      const feerate = Number(entry[0]);
      const vsize = Number(entry[1]) || 0;
      const rate = feerate < 10 ? Math.round(feerate * 100) : Math.round(feerate);
      for (const tier of CONFIG.ORDER_BOOK_TIERS) {
        if (rate >= tier.min && rate <= tier.max) {
          tiers[tier.label].vbytes += vsize;
          break;
        }
      }
    }
    const totalVbytes = Object.values(tiers).reduce((s, t) => s + t.vbytes, 0);
    const btcPerVbyte = totalVsize > 0 && totalVbytes > 0 ? (totalVsize * 1e-6) / totalVbytes : 1e-6;
    for (const label of Object.keys(tiers)) {
      tiers[label].btc = tiers[label].vbytes * btcPerVbyte;
    }
    this.tierData = tiers;
    this.totalBtcInMempool = totalVsize > 0 ? totalVsize * 1e-6 : Object.values(tiers).reduce((s, t) => s + t.btc, 0);
    let acc = 0;
    for (const tier of CONFIG.ORDER_BOOK_TIERS) {
      acc += tiers[tier.label].vbytes;
      if (acc >= CONFIG.BLOCK_CAPACITY_VBYTES) {
        this.minFeeForBlock = tier.min;
        break;
      }
    }
  }
}

// ========== Mock Data Generator ==========
class MockDataGenerator {
  constructor(mempoolState, onBlock, onTx) {
    this.state = mempoolState;
    this.onBlock = onBlock;
    this.onTx = onTx;
    this.interval = null;
    this.blockInterval = null;
    this.blockHeight = 892000;
  }

  start() {
    if (!CONFIG.USE_MOCK_DATA) return;
    this.state.blockHeight = this.blockHeight;
    this.state.lastBlockTime = Date.now();
    const run = () => {
      const count = CONFIG.MOCK_TXS_PER_SEC.min + Math.floor(Math.random() * (CONFIG.MOCK_TXS_PER_SEC.max - CONFIG.MOCK_TXS_PER_SEC.min + 1));
      for (let i = 0; i < count; i++) {
        const feeRate = Math.max(1, Math.round(logNormal(Math.log(35), 1.2)));
        const r = Math.random();
        let value;
        if (r < 0.7) value = Math.floor(Math.random() * 100_000_000);
        else if (r < 0.95) value = Math.floor(100_000_000 + Math.random() * 99_000_000_000);
        else if (r < 0.99) value = Math.floor(1_000_000_000 + Math.random() * 99_000_000_000);
        else value = Math.floor(100_000_000_000 + Math.random() * 900_000_000_000);
        const txid = Array(64).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('');
        const tx = { txid, value, feeRate, vsize: 100 + Math.floor(Math.random() * 400), firstSeen: Date.now() / 1000 };
        const t = this.state.addTx(tx);
        this.onTx?.(t);
      }
      this.state.mempoolCount = this.state.transactions.length;
      this.state.mempoolSize = this.state.transactions.reduce((s, t) => s + t.vsize, 0);
      this.state.feeMedian = this.state.transactions.length ? Math.round(
        this.state.transactions.slice().sort((a, b) => a.feeRate - b.feeRate)[Math.floor(this.state.transactions.length / 2)].feeRate
      ) : 35;
      this.state.hashrate = 620;
    };
    this.interval = setInterval(run, 1000);
    this.blockInterval = setInterval(() => {
      this.blockHeight++;
      this.state.blockHeight = this.blockHeight;
      this.state.lastBlockTime = Date.now();
      this.state.transactions = this.state.transactions.slice(-Math.floor(this.state.transactions.length / 2));
      this.state.mempoolCount = this.state.transactions.length;
      this.state.mempoolSize = this.state.transactions.reduce((s, t) => s + t.vsize, 0);
      this.onBlock?.();
    }, CONFIG.MOCK_BLOCK_INTERVAL_MS);
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
    if (this.blockInterval) clearInterval(this.blockInterval);
  }
}

// ========== AreaChart ==========
class AreaChart {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.buckets = [];
    this.scrollOffset = 0;
    this.whaleSpikes = [];
    this.minFeeLine = 0;
    this.scannerX = -1;
    this.scannerActive = false;
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(dpr, dpr);
    this.width = rect.width;
    this.height = rect.height;
  }

  addBucket(totalBtc, feeHighBtc, feeLowBtc, confirmedBtc) {
    const t = Date.now();
    this.buckets.push(t, totalBtc || 0, feeHighBtc || 0, feeLowBtc || 0, confirmedBtc || 0);
    const maxBuckets = (CONFIG.CHART_WINDOW_MINUTES * 60) / CONFIG.CHART_BUCKET_SECONDS;
    while (this.buckets.length / 5 > maxBuckets) this.buckets.splice(0, 5);
  }

  addTx(tx) {
    const btc = tx.btc ?? satsToBtc(tx.value ?? 0);
    if (btc >= 50) {
      this.whaleSpikes.push({ time: Date.now(), btc, x: this.width });
    }
  }

  addWhaleSpike(btc) {
    this.whaleSpikes.push({ time: Date.now(), btc, x: this.width });
  }

  setMinFee(fee) {
    this.minFeeLine = fee;
  }

  triggerScanner() {
    this.scannerActive = true;
    this.scannerX = this.width;
  }

  update(delta) {
    const scrollSpeed = this.width / (CONFIG.CHART_WINDOW_MINUTES * 60 * 1000);
    this.scrollOffset += delta * scrollSpeed;
    this.whaleSpikes = this.whaleSpikes.filter(s => Date.now() - s.time < 8000);
    if (this.scannerActive) {
      this.scannerX -= (this.width / 2000) * delta;
      if (this.scannerX < 0) {
        this.scannerActive = false;
        this.scannerX = -1;
      }
    }
  }

  render() {
    if (!this.width || !this.height) return;
    const ctx = this.ctx;
    ctx.fillStyle = '#070f1c';
    ctx.fillRect(0, 0, this.width, this.height);
    const padding = { left: 60, right: 20, top: 30, bottom: 40 };
    const chartW = this.width - padding.left - padding.right;
    const chartH = this.height - padding.top - padding.bottom;
    const now = Date.now();
    const windowMs = CONFIG.CHART_WINDOW_MINUTES * 60 * 1000;
    const bucketMs = CONFIG.CHART_BUCKET_SECONDS * 1000;
    const bucketCount = Math.floor(windowMs / bucketMs);
    const data = [];
    for (let i = 0; i < bucketCount; i++) {
      const idx = (this.buckets.length / 5) - 1 - i;
      if (idx >= 0) {
        const ts = this.buckets[idx * 5];
        const total = this.buckets[idx * 5 + 1] || 0;
        const feeHigh = this.buckets[idx * 5 + 2] || 0;
        const feeLow = this.buckets[idx * 5 + 3] || 0;
        const confirmed = this.buckets[idx * 5 + 4] || 0;
        data.push({ ts, total, feeHigh, feeLow, confirmed });
      }
    }
    data.reverse();
    const sum = (d) => (d.confirmed || 0) + (d.total || 0);
    const maxY = Math.max(0.15, ...(data.length ? data.map(sum) : [0.15]));
    const scaleY = chartH / maxY;
    const bucketWidth = chartW / bucketCount;
    const offsetX = (this.scrollOffset % bucketWidth);
    const baseX = padding.left + chartW - offsetX;

    // Y-axis grid + labels
    for (let i = 0; i < 5; i++) {
      ctx.strokeStyle = '#1e2d3d';
      ctx.lineWidth = 1;
      ctx.beginPath();
      const y = padding.top + chartH - (i / 4) * chartH;
      ctx.moveTo(padding.left, y);
      ctx.lineTo(this.width - padding.right, y);
      ctx.stroke();
      ctx.fillStyle = '#445566';
      ctx.font = '13px "Space Mono"';
      const label = maxY < 1 ? (maxY * (i / 4)).toFixed(2) : (maxY * (i / 4)).toFixed(1);
      ctx.fillText(label + ' BTC', padding.left - 55, y + 4);
    }

    // X-axis time labels
    ctx.fillStyle = '#445566';
    ctx.font = '13px "Space Mono"';
    const timeLabels = [
      { min: CONFIG.CHART_WINDOW_MINUTES, text: `-${CONFIG.CHART_WINDOW_MINUTES}m` },
      { min: CONFIG.CHART_WINDOW_MINUTES * 0.75, text: `-${Math.round(CONFIG.CHART_WINDOW_MINUTES * 0.75)}m` },
      { min: CONFIG.CHART_WINDOW_MINUTES * 0.5, text: `-${Math.round(CONFIG.CHART_WINDOW_MINUTES * 0.5)}m` },
      { min: CONFIG.CHART_WINDOW_MINUTES * 0.25, text: `-${Math.round(CONFIG.CHART_WINDOW_MINUTES * 0.25)}m` },
      { min: 0, text: 'NOW' },
    ];
    for (const tl of timeLabels) {
      const frac = 1 - (tl.min / CONFIG.CHART_WINDOW_MINUTES);
      const x = padding.left + frac * chartW;
      ctx.fillText(tl.text, x - ctx.measureText(tl.text).width / 2, padding.top + chartH + 25);
      if (tl.min > 0 && tl.min < CONFIG.CHART_WINDOW_MINUTES) {
        ctx.strokeStyle = '#1a2838';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, padding.top);
        ctx.lineTo(x, padding.top + chartH);
        ctx.stroke();
      }
    }

    // NOW line (right edge)
    ctx.strokeStyle = '#2a3a4a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding.left + chartW, padding.top);
    ctx.lineTo(padding.left + chartW, padding.top + chartH);
    ctx.stroke();

    // Stacked areas
    if (data.length > 0) {
      const drawAreaFromBase = (baseY, topPoints, color, alpha = 1) => {
        if (topPoints.length < 2) return;
        ctx.fillStyle = color;
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.moveTo(topPoints[0].x, baseY);
        for (const p of topPoints) ctx.lineTo(p.x, p.y);
        ctx.lineTo(topPoints[topPoints.length - 1].x, baseY);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
      };
      const drawStackedArea = (basePoints, topPoints, color, alpha = 1) => {
        if (basePoints.length < 2 || topPoints.length < 2) return;
        ctx.fillStyle = color;
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.moveTo(basePoints[0].x, basePoints[0].y);
        for (const p of topPoints) ctx.lineTo(p.x, p.y);
        ctx.lineTo(basePoints[basePoints.length - 1].x, basePoints[basePoints.length - 1].y);
        for (let i = basePoints.length - 1; i >= 0; i--) ctx.lineTo(basePoints[i].x, basePoints[i].y);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
      };
      const bottomY = padding.top + chartH;
      const confirmedPoints = [];
      const feeLowPoints = [];
      const feeHighPoints = [];
      for (let i = 0; i < data.length; i++) {
        const d = data[i];
        const x = baseX - (data.length - 1 - i) * bucketWidth;
        const confirmedH = d.confirmed * scaleY;
        const feeLowH = d.feeLow * scaleY;
        const feeHighH = d.feeHigh * scaleY;
        const y1 = bottomY - confirmedH;
        const y2 = y1 - feeLowH;
        const y3 = y2 - feeHighH;
        confirmedPoints.push({ x, y: y1 });
        feeLowPoints.push({ x, y: y2 });
        feeHighPoints.push({ x, y: y3 });
      }
      drawAreaFromBase(bottomY, confirmedPoints, '#0d2137');
      const gradLow = ctx.createLinearGradient(0, bottomY, 0, padding.top);
      gradLow.addColorStop(0, 'rgba(26,74,122,0.9)');
      gradLow.addColorStop(1, 'rgba(30,95,154,0.4)');
      drawStackedArea(confirmedPoints, feeLowPoints, gradLow, 0.7);
      const gradHigh = ctx.createLinearGradient(0, bottomY, 0, padding.top);
      gradHigh.addColorStop(0, 'rgba(240,165,0,0.9)');
      gradHigh.addColorStop(1, 'rgba(255,107,0,0.6)');
      drawStackedArea(feeLowPoints, feeHighPoints, gradHigh, 0.8);
    }

    // NOW edge glow
    ctx.strokeStyle = '#00d4ff';
    ctx.lineWidth = 1.5;
    ctx.shadowColor = 'rgba(0,212,255,0.5)';
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.moveTo(padding.left + chartW, padding.top + chartH);
    ctx.lineTo(padding.left + chartW, padding.top);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Whale spikes
    for (const spike of this.whaleSpikes) {
      const age = (now - spike.time) / 1000;
      if (age > 8) continue;
      const alpha = 1 - age / 8;
      const x = padding.left + chartW - (now - spike.time) * (chartW / windowMs);
      if (x < padding.left) continue;
      ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, padding.top + chartH);
      ctx.lineTo(x, padding.top - 40);
      ctx.stroke();
      ctx.fillStyle = 'white';
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(x, padding.top - 40, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Scanner line (block event)
    if (this.scannerActive && this.scannerX > padding.left) {
      ctx.strokeStyle = 'rgba(0,212,255,0.6)';
      ctx.lineWidth = 2;
      ctx.shadowColor = 'rgba(0,212,255,0.8)';
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.moveTo(this.scannerX, padding.top);
      ctx.lineTo(this.scannerX, padding.top + chartH);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  }
}

// ========== OrderBook ==========
class OrderBook {
  constructor(container, cutEl, capacityFill, capacityLabel) {
    this.container = container;
    this.cutEl = cutEl;
    this.capacityFill = capacityFill;
    this.capacityLabel = capacityLabel;
    this.flashRows = new Set();
    this.sweepRows = new Set();
    this.rowElements = new Map();
    this.maxVbytes = 0;
  }

  update(state) {
    const { above, below } = state.getTiersForBlock();
    const allRows = [...above, { isCut: true, minFee: state.minFeeForBlock }, ...below];
    this.maxVbytes = Math.max(1, ...above.map(r => r.vbytes || 0), ...below.map(r => r.vbytes || 0));

    const existingKeys = new Set(this.rowElements.keys());
    const newKeys = new Set();

    let insertBefore = this.container.firstChild;
    for (const row of allRows) {
      const key = row.isCut ? '__cut__' : row.label;
      newKeys.add(key);

      if (this.rowElements.has(key)) {
        const el = this.rowElements.get(key);
        if (row.isCut) {
          el.textContent = `MIN FEE: ${row.minFee || '—'} sat/vB`;
        } else {
          this._updateRowContent(el, row);
        }
        if (el !== insertBefore) {
          this.container.insertBefore(el, insertBefore);
        } else {
          insertBefore = el.nextSibling;
        }
      } else {
        let el;
        if (row.isCut) {
          el = document.createElement('div');
          el.className = 'orderbook-cut';
          el.textContent = `MIN FEE: ${row.minFee || '—'} sat/vB`;
          el.style.cssText = 'position:relative;border-top:1px solid #00d4ff;padding:4px 16px;font-size:13px;color:#00d4ff;box-shadow:0 0 8px rgba(0,212,255,0.4);';
        } else {
          el = this._createRow(row);
        }
        this.container.insertBefore(el, insertBefore);
        this.rowElements.set(key, el);
      }
    }

    for (const key of existingKeys) {
      if (!newKeys.has(key)) {
        this.rowElements.get(key).remove();
        this.rowElements.delete(key);
      }
    }

    const pct = state.getBlockCapacityPercent();
    this.capacityFill.style.width = `${Math.min(100, pct)}%`;
    const backlog = state.getBlocksBacklog();
    this.capacityLabel.textContent = backlog > 1 ? `${backlog} BLOCKS QUEUED` : `NEXT BLOCK ${Math.round(pct)}%`;
    if (pct > 90) {
      this.capacityFill.classList.add('pulse');
    } else {
      this.capacityFill.classList.remove('pulse');
    }
  }

  _createRow(row) {
    const tr = document.createElement('div');
    tr.className = 'orderbook-row';
    const color = this._getTierColor(row);

    const depthBar = document.createElement('div');
    depthBar.className = 'depth-bar';
    depthBar.style.background = color;
    tr.appendChild(depthBar);

    const tierSpan = document.createElement('span');
    tierSpan.className = 'tier';
    tierSpan.style.color = color;
    tr.appendChild(tierSpan);

    const vbytesSpan = document.createElement('span');
    vbytesSpan.className = 'vbytes';
    tr.appendChild(vbytesSpan);

    const btcSpan = document.createElement('span');
    btcSpan.className = 'btc';
    tr.appendChild(btcSpan);

    tr.dataset.label = row.label;
    this._updateRowContent(tr, row);
    return tr;
  }

  _updateRowContent(tr, row) {
    const color = this._getTierColor(row);
    const tierSpan = tr.querySelector('.tier');
    const vbytesSpan = tr.querySelector('.vbytes');
    const btcSpan = tr.querySelector('.btc');
    const depthBar = tr.querySelector('.depth-bar');

    if (tierSpan) {
      tierSpan.textContent = row.label;
      tierSpan.style.color = color;
    }
    if (vbytesSpan) vbytesSpan.textContent = row.vbytes?.toLocaleString() || '0';
    if (btcSpan) btcSpan.textContent = (row.btc || 0).toFixed(2);

    const depthPct = this.maxVbytes > 0 ? Math.min(100, ((row.vbytes || 0) / this.maxVbytes) * 100) : 0;
    if (depthBar) {
      depthBar.style.width = depthPct + '%';
      depthBar.style.background = color;
    }

    tr.style.background = `rgba(${this._hexToRgb(color)},0.08)`;

    if (this.flashRows.has(row.label)) {
      tr.classList.add('flash');
      this.flashRows.delete(row.label);
      setTimeout(() => tr.classList.remove('flash'), 300);
    }
    if (this.sweepRows.has(row.label)) {
      tr.classList.add('sweep');
      this.sweepRows.delete(row.label);
      setTimeout(() => tr.classList.remove('sweep'), 600);
    }
  }

  flashRow(label) {
    this.flashRows.add(label);
  }

  triggerBlockSweep() {
    const labels = CONFIG.ORDER_BOOK_TIERS.map(t => t.label);
    labels.forEach((label, i) => {
      setTimeout(() => this.sweepRows.add(label), i * 80);
    });
  }

  _getTierColor(row) {
    const mid = (row.min + Math.min(row.max, 999)) / 2;
    return getFeeColor(mid);
  }

  _hexToRgb(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `${r},${g},${b}`;
  }
}

// ========== TickerTape ==========
class TickerTape {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.items = [];
    this.pixelOffset = 0;
    this.speed = CONFIG.TICKER_BASE_SPEED;
    this.whaleSlowdownUntil = 0;
    // Fixed-width slot system: each tx gets exactly SLOT_WIDTH pixels
    this.SLOT_WIDTH = 420;
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(dpr, dpr);
    this.width = rect.width;
    this.height = rect.height;
  }

  addTx(tx) {
    const btc = tx.btc ?? satsToBtc(tx.value ?? 0);
    const feeRate = tx.feeRate ?? 0;
    const txid = tx.txid || '';
    this.items.push({ txid, btc, feeRate, whale: btc >= 50 });
    if (this.items.length > CONFIG.TICKER_BUFFER_SIZE) this.items.shift();
  }

  triggerWhaleSlowdown() {
    this.whaleSlowdownUntil = Date.now() + 2000;
  }

  update(delta, feeMedian) {
    // Cap delta to avoid jumps on tab switch / GC pause
    const dt = Math.min(delta, 50);
    let targetSpeed = CONFIG.TICKER_BASE_SPEED;
    if (feeMedian > 200) targetSpeed = CONFIG.TICKER_MAX_SPEED;
    else if (feeMedian > 100) targetSpeed = CONFIG.TICKER_BASE_SPEED * 1.4;
    else if (feeMedian < 10) targetSpeed = CONFIG.TICKER_MIN_SPEED;
    if (Date.now() < this.whaleSlowdownUntil) targetSpeed *= 0.5;
    this.speed += (targetSpeed - this.speed) * 0.03;
    this.pixelOffset += (dt / 1000) * this.speed;
  }

  render() {
    if (!this.width || !this.height) return;
    const ctx = this.ctx;
    ctx.fillStyle = '#050d18';
    ctx.fillRect(0, 0, this.width, this.height);
    if (this.items.length === 0) return;

    ctx.font = '16px "Space Mono"';
    const centerY = Math.round(this.height / 2 + 5);
    const n = this.items.length;
    const totalW = n * this.SLOT_WIDTH;

    // How far into the cycle we are
    const cycle = ((this.pixelOffset % totalW) + totalW) % totalW;
    // Starting item index and pixel position
    const startIdx = Math.floor(cycle / this.SLOT_WIDTH);
    const startFrac = cycle - startIdx * this.SLOT_WIDTH;

    let x = -startFrac;
    let idx = startIdx;
    while (x < this.width) {
      const item = this.items[idx % n];
      if (x + this.SLOT_WIDTH > 0) {
        const btcStr = item.btc >= 1 ? `₿${item.btc.toFixed(3)}` : `₿${item.btc.toFixed(6)}`;
        const feeStr = `${item.feeRate} s/vB`;

        let dx = Math.round(x + 8);

        // Txid
        ctx.fillStyle = item.whale ? '#ffffff' : '#556677';
        if (item.whale) { ctx.shadowColor = 'rgba(255,255,255,0.5)'; ctx.shadowBlur = 4; }
        const txPart = shortTxid(item.txid);
        ctx.fillText(txPart, dx, centerY);
        dx += ctx.measureText(txPart).width + 12;
        ctx.shadowBlur = 0;

        // BTC
        ctx.fillStyle = item.whale ? '#ffffff' : '#e0e8f0';
        ctx.fillText(btcStr, dx, centerY);
        dx += ctx.measureText(btcStr).width + 12;

        // Fee
        ctx.fillStyle = getFeeColor(item.feeRate);
        ctx.fillText(feeStr, dx, centerY);
        dx += ctx.measureText(feeStr).width + 12;

        // Separator
        ctx.fillStyle = '#2a3a4a';
        ctx.fillText('◆', dx, centerY);
      }
      x += this.SLOT_WIDTH;
      idx++;
    }
  }
}

// ========== HUDController ==========
class HUDController {
  constructor(elements) {
    this.el = elements;
    this.blockFlashUntil = 0;
    this.displayMempoolCount = 0;
    this.targetMempoolCount = 0;
    this.slowBlockWarningShown = false;
  }

  update(state, connectionState) {
    const now = Date.now();
    this.el.blockNumber.textContent = state.blockHeight ? state.blockHeight.toLocaleString() : '—';
    this.el.blockNumber.style.color = now < this.blockFlashUntil ? '#f0a500' : '#e0e8f0';

    // Odometer: smooth interpolation for mempool count
    this.targetMempoolCount = state.mempoolCount;
    const diff = this.targetMempoolCount - this.displayMempoolCount;
    this.displayMempoolCount += diff * 0.15;
    if (Math.abs(diff) < 1) this.displayMempoolCount = this.targetMempoolCount;
    this.el.mempoolCount.textContent = Math.round(this.displayMempoolCount).toLocaleString();

    this.el.feeMedian.textContent = state.feeMedian || '—';
    this.el.feeMedian.style.color = getFeeColor(state.feeMedian || 0);
    this.el.hashrate.textContent = state.hashrate ? `${Number(state.hashrate).toLocaleString()} EH/s` : '—';

    const elapsed = Math.floor((now - state.lastBlockTime) / 1000);
    const m = Math.floor(elapsed / 60);
    const s = elapsed % 60;
    this.el.timeSinceBlock.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

    const slowThreshold = CONFIG.SLOW_BLOCK_THRESHOLD_MINUTES * 60;
    if (elapsed > slowThreshold) {
      this.el.timeSinceBlock.style.color = '#ff3333';
      this.el.timeSinceBlock.style.animation = 'pulse 2s infinite';
    } else if (elapsed > 900) {
      this.el.timeSinceBlock.style.color = '#ff3333';
      this.el.timeSinceBlock.style.animation = '';
    } else {
      this.el.timeSinceBlock.style.color = '#e0e8f0';
      this.el.timeSinceBlock.style.animation = '';
    }

    this.el.totalBtc.textContent = state.totalBtcInMempool.toFixed(2);
    this.el.minFeeHud.textContent = state.minFeeForBlock || '—';
    this.el.minFeeHud.style.color = getFeeColor(state.minFeeForBlock || 0);
    this.el.connectionStatus.className = 'connection-status' + (connectionState === 'disconnected' ? ' disconnected' : connectionState === 'connecting' ? ' connecting' : '');

    return { elapsed, slowThreshold };
  }

  flashBlock() {
    this.blockFlashUntil = Date.now() + 1000;
    this.slowBlockWarningShown = false;
  }
}

// ========== EventSystem ==========
class EventSystem {
  constructor(areaChart, orderBook, tickerTape, hudController, infoZone, congestionOverlay) {
    this.areaChart = areaChart;
    this.orderBook = orderBook;
    this.tickerTape = tickerTape;
    this.hudController = hudController;
    this.infoZone = infoZone;
    this.congestionOverlay = congestionOverlay;
    this.blockEventActive = false;
    this.slowBlockToastShown = false;
    this.idleToastActive = false;
    this.lastIdleRotation = 0;
    this.idleIndex = 0;
  }

  onBlock(state) {
    if (this.blockEventActive) return;
    this.blockEventActive = true;
    this.slowBlockToastShown = false;
    this.hudController.flashBlock();
    this.areaChart.triggerScanner();
    this.orderBook.triggerBlockSweep();

    const toast = document.createElement('div');
    toast.className = 'toast block-event';
    toast.innerHTML = `
      BLOCK #${state.blockHeight.toLocaleString()} MINED<br>
      <span class="detail">${state.lastBlockTxCount} txs confirmed • Reward: ${state.lastBlockReward} BTC</span>
    `;
    this.infoZone.innerHTML = '';
    this.infoZone.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s';
      setTimeout(() => toast.remove(), 300);
      this.blockEventActive = false;
    }, 7000);
  }

  onWhale(tx) {
    this.areaChart.addWhaleSpike(tx.btc);
    this.tickerTape.triggerWhaleSlowdown();
    const tier = CONFIG.ORDER_BOOK_TIERS.find(t => tx.feeRate >= t.min && tx.feeRate <= t.max);
    if (tier) this.orderBook.flashRow(tier.label);
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `⚡ LARGE TX<br>₿ ${tx.btc.toFixed(2)} • ${tx.feeRate} sat/vB`;
    this.infoZone.innerHTML = '';
    this.infoZone.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s';
      setTimeout(() => toast.remove(), 300);
    }, 5000);
  }

  onSuperWhale(tx) {
    const flash = document.createElement('div');
    flash.className = 'super-whale-flash';
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 800);
  }

  updateCongestion(feeMedian) {
    if (feeMedian > CONFIG.CONGESTION_FEE_THRESHOLD) {
      this.congestionOverlay.classList.add('active');
    } else {
      this.congestionOverlay.classList.remove('active');
    }
  }

  checkSlowBlock(elapsed) {
    if (elapsed > CONFIG.SLOW_BLOCK_THRESHOLD_MINUTES * 60 && !this.slowBlockToastShown && !this.blockEventActive) {
      this.slowBlockToastShown = true;
      this.idleToastActive = false;
      const toast = document.createElement('div');
      toast.className = 'toast slow-block';
      toast.textContent = `LATE BLOCK — ${Math.floor(elapsed / 60)}+ min without block`;
      this.infoZone.innerHTML = '';
      this.infoZone.appendChild(toast);
      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s';
        setTimeout(() => toast.remove(), 300);
      }, 8000);
    }
  }

  showIdleInfo() {}
}

// ========== Grain Canvas ==========
function initGrain() {
  const canvas = document.getElementById('grainCanvas');
  const ctx = canvas.getContext('2d');
  let imgData = null;
  let lastW = 0, lastH = 0;
  const draw = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w !== lastW || h !== lastH) {
      canvas.width = w;
      canvas.height = h;
      imgData = ctx.createImageData(w, h);
      lastW = w;
      lastH = h;
    }
    for (let i = 0; i < imgData.data.length; i += 4) {
      const v = Math.random() > 0.5 ? 255 : 0;
      imgData.data[i] = imgData.data[i + 1] = imgData.data[i + 2] = v;
      imgData.data[i + 3] = 8;
    }
    ctx.putImageData(imgData, 0, 0);
  };
  draw();
  setInterval(draw, CONFIG.GRAIN_REFRESH_INTERVAL);
}

// ========== Main ==========
function main() {
  const state = new MempoolState();
  const areaChart = new AreaChart(document.getElementById('areaChart'));
  const orderBook = new OrderBook(
    document.getElementById('orderbookRows'),
    null,
    document.getElementById('capacityFill'),
    document.getElementById('capacityLabel')
  );
  const tickerTape = new TickerTape(document.getElementById('tickerTape'));
  const hudController = new HUDController({
    blockNumber: document.getElementById('blockNumber'),
    mempoolCount: document.getElementById('mempoolCount'),
    feeMedian: document.getElementById('feeMedian'),
    hashrate: document.getElementById('hashrate'),
    timeSinceBlock: document.getElementById('timeSinceBlock'),
    totalBtc: document.getElementById('totalBtc'),
    minFeeHud: document.getElementById('minFeeHud'),
    connectionStatus: document.getElementById('connectionStatus'),
  });
  const congestionOverlay = document.getElementById('congestionOverlay');
  const infoZone = document.getElementById('infoZone');
  const eventSystem = new EventSystem(areaChart, orderBook, tickerTape, hudController, infoZone, congestionOverlay);
  const stateOverlay = document.getElementById('stateOverlay');
  const stateMessage = document.getElementById('stateMessage');

  let connectionState = 'connecting';
  let lastDOMUpdate = 0;
  let lastChartUpdate = 0;
  let infoRotateIdx = 0;
  let lastInfoRotate = 0;
  // Large tx log for info zone
  const largeTxLog = [];

  const processTx = (t) => {
    areaChart.addTx(t);
    tickerTape.addTx(t);
    if ((t.value || 0) >= CONFIG.WHALE_THRESHOLD_SATS) {
      eventSystem.onWhale(t);
      largeTxLog.push({ btc: t.btc, feeRate: t.feeRate, time: Date.now() });
      if (largeTxLog.length > 10) largeTxLog.shift();
      if ((t.value || 0) >= CONFIG.SUPER_WHALE_THRESHOLD_SATS) {
        eventSystem.onSuperWhale(t);
      }
    }
  };

  const handleWsMessage = (data) => {
    const hadBlock = state.blockHeight;
    state.processMessage(data);
    if (state.blockHeight > hadBlock && hadBlock > 0) {
      eventSystem.onBlock(state);
    }
    if (data.transactions) {
      for (const tx of data.transactions) {
        processTx(state.addTx(tx));
      }
    }
    if (data['live-2h-chart']?.transactions) {
      for (const tx of data['live-2h-chart'].transactions) {
        processTx(state.addTx(tx));
      }
    }
  };

  const wsManager = new WebSocketManager(handleWsMessage, (s) => {
    connectionState = s;
    if (s === 'connected') {
      stateOverlay.classList.add('hidden');
    } else if (s === 'error') {
      stateOverlay.classList.remove('hidden');
      stateOverlay.className = 'state-overlay error';
      stateMessage.textContent = 'BITCOIN NETWORK UNAVAILABLE';
    } else if (s === 'disconnected') {
      stateMessage.textContent = 'RECONNECTING...';
    }
  });

  const onMockTx = (t) => { processTx(t); };
  const mockGen = new MockDataGenerator(state, () => eventSystem.onBlock(state), onMockTx);

  if (CONFIG.USE_MOCK_DATA) {
    stateOverlay.classList.add('hidden');
    mockGen.start();
    state.blockHeight = 892000;
    state.hashrate = 620;
  } else {
    fetch('https://mempool.space/api/v1/blocks')
      .then(r => r.json())
      .then(blocks => {
        if (blocks?.[0]) {
          state.blockHeight = blocks[0].height;
          state.lastBlockTime = blocks[0].timestamp * 1000;
          state.lastBlockTxCount = blocks[0].tx_count || 0;
        }
      })
      .catch(() => {
        fetch('https://mempool.space/api/v1/blocks/tip/height')
          .then(r => r.json())
          .then(h => { state.blockHeight = h; })
          .catch(() => {});
      });
    fetch('https://mempool.space/api/v1/mining/hashrate/3d')
      .then(r => r.json())
      .then(d => { if (d?.currentHashrate) state.hashrate = Math.round(d.currentHashrate / 1e18); })
      .catch(() => {});
    wsManager.connect();
    const fetchMempoolRest = () => {
      if (CONFIG.USE_MOCK_DATA) return;
      fetch('https://mempool.space/api/mempool')
        .then(r => r.json())
        .then(d => {
          state.mempoolCount = d.count ?? state.mempoolCount;
          state.mempoolSize = d.vsize ?? state.mempoolSize;
          if (d.fee_histogram) state.applyFeeHistogram(d.fee_histogram, d.vsize, d.total_fee);
        })
        .catch(() => {});
      fetch('https://mempool.space/api/v1/fees/recommended')
        .then(r => r.json())
        .then(d => {
          if (d.fastestFee != null) state.minFeeForBlock = d.fastestFee;
          if (d.halfHourFee != null && !state.feeMedian) state.feeMedian = d.halfHourFee;
        })
        .catch(() => {});
      fetch('https://mempool.space/api/v1/fees/mempool-blocks')
        .then(r => r.json())
        .then(blocks => {
          if (blocks?.[0]) {
            const fb = blocks[0];
            // feeRange[0] is the actual minimum fee to get into the next block
            if (fb.feeRange?.[0] != null) {
              state.minFeeForBlock = Math.round(fb.feeRange[0]);
            } else if (fb.medianFee != null) {
              state.minFeeForBlock = Math.round(fb.medianFee);
            }
            if (!state.feeMedian && fb.medianFee) state.feeMedian = Math.round(fb.medianFee);
          }
        })
        .catch(() => {});
    };
    fetchMempoolRest();
    setInterval(fetchMempoolRest, CONFIG.MEMPOOL_REST_FETCH_INTERVAL);
    setTimeout(() => {
      if (connectionState === 'connecting') {
        stateOverlay.classList.remove('hidden');
        stateMessage.textContent = 'Loading data...';
      }
    }, 3000);
    setTimeout(() => {
      if (state.blockHeight > 0 || state.mempoolCount > 0) stateOverlay.classList.add('hidden');
    }, 8000);
    setTimeout(() => {
      // Fallback: hide after 15s regardless (except error)
      if (connectionState !== 'error') stateOverlay.classList.add('hidden');
    }, 15000);
  }

  document.querySelector('.chart-title').textContent = `BTC ENTERING MEMPOOL • ${CONFIG.CHART_WINDOW_MINUTES} min window`;

  const resize = () => {
    areaChart.resize();
    tickerTape.resize();
  };
  window.addEventListener('resize', resize);
  resize();

  setInterval(() => {
    const recent = state.transactions.filter(t => Date.now() / 1000 - (t.firstSeen || 0) < CONFIG.CHART_BUCKET_SECONDS);
    let total = 0, feeHigh = 0, feeLow = 0;
    for (const t of recent) {
      const btc = t.btc ?? satsToBtc(t.value ?? 0);
      total += btc;
      if ((t.feeRate ?? 0) >= 20) feeHigh += btc;
      else feeLow += btc;
    }
    const confirmed = CONFIG.CHART_CONFIRMED_BASELINE_BTC ?? 0.04;
    areaChart.addBucket(total, feeHigh, feeLow, confirmed);
  }, CONFIG.CHART_BUCKET_SECONDS * 1000);

  function loop(timestamp) {
    const rawDelta = timestamp - (lastChartUpdate || timestamp);
    lastChartUpdate = timestamp;
    const delta = Math.min(rawDelta, 50); // Cap to ~20fps equivalent to avoid jumps

    areaChart.setMinFee(state.minFeeForBlock);
    areaChart.update(delta);
    areaChart.render();

    tickerTape.update(delta, state.feeMedian);
    tickerTape.render();

    if (timestamp - lastDOMUpdate > CONFIG.DOM_UPDATE_INTERVAL) {
      orderBook.update(state);
      const { elapsed } = hudController.update(state, connectionState);
      eventSystem.updateCongestion(state.feeMedian);
      eventSystem.checkSlowBlock(elapsed);
      // Info zone: rotate large txs + halving + mempool stats
      const now2 = Date.now();
      if (now2 - lastInfoRotate > 6000) {
        lastInfoRotate = now2;
        const msgs = [];
        // Large txs (most recent first)
        for (let i = largeTxLog.length - 1; i >= Math.max(0, largeTxLog.length - 3); i--) {
          const lt = largeTxLog[i];
          const ago = Math.floor((now2 - lt.time) / 60000);
          msgs.push(`₿ ${lt.btc.toFixed(2)} — ${lt.feeRate} sat/vB${ago > 0 ? ` — ${ago}m ago` : ''}`);
        }
        // Halving countdown: block 1,050,000, ~10 min/block
        const halvingBlock = 1_050_000;
        const blocksLeft = halvingBlock - (state.blockHeight || 0);
        if (blocksLeft > 0) {
          const daysLeft = Math.floor(blocksLeft * 10 / 1440);
          msgs.push(`HALVING in ~${blocksLeft.toLocaleString()} blocks (~${daysLeft} days)`);
        }
        // Mempool stats
        if (state.mempoolCount > 0) msgs.push(`${state.mempoolCount.toLocaleString()} txs pending`);
        if (msgs.length > 0 && !infoZone.querySelector('.toast')) {
          infoRotateIdx = (infoRotateIdx + 1) % msgs.length;
          infoZone.textContent = msgs[infoRotateIdx];
        }
      }
      lastDOMUpdate = timestamp;
    }

    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

document.addEventListener('DOMContentLoaded', () => {
  initGrain();
  // Wait for Space Mono font to load before starting canvas rendering
  if (document.fonts?.ready) {
    document.fonts.ready.then(() => main());
  } else {
    main();
  }
});
