const fs = require('fs');
const crypto = require('crypto');
const axios = require('axios');

const KEY_ID = process.env.KALSHI_API_KEY_ID;
const KEY_PATH = process.env.KALSHI_PRIVATE_KEY_PATH || '/root/kalshi_private_key.pem';

function sign(method, path) {
  const pk = fs.readFileSync(KEY_PATH, 'utf8');
  const ts = Date.now().toString();
  const s = crypto.createSign('SHA256');
  s.update(ts + method.toUpperCase() + path);
  s.end();
  const sig = s.sign({ key: pk, padding: crypto.constants.RSA_PKCS1_PSS_PADDING }, 'base64');
  return { ts, sig };
}

async function kalshiRequest(method, path, query = '') {
  if (!KEY_ID) return null;
  const { ts, sig } = sign(method, path);
  const { data } = await axios({
    method,
    url: `https://api.elections.kalshi.com${path}${query ? '?' + query : ''}`,
    headers: {
      'KALSHI-ACCESS-KEY': KEY_ID,
      'KALSHI-ACCESS-TIMESTAMP': ts,
      'KALSHI-ACCESS-SIGNATURE': sig
    },
    timeout: 10000
  });
  return data;
}

async function getLiquidMarkets(limit = 100) {
  const data = await kalshiRequest('GET', '/trade-api/v2/markets', `limit=${limit}&status=open`);
  const markets = (data?.markets || []).map(m => ({
    ticker: m.ticker,
    title: m.title,
    event_ticker: m.event_ticker,
    yes_bid: parseFloat(m.yes_bid_dollars || 0),
    yes_ask: parseFloat(m.yes_ask_dollars || 0),
    no_bid: parseFloat(m.no_bid_dollars || 0),
    no_ask: parseFloat(m.no_ask_dollars || 0),
    last_price: parseFloat(m.last_price_dollars || 0),
    volume: parseFloat(m.volume_fp || 0),
    close_time: m.close_time
  }));
  // Return all with any non-zero price data
  return markets.filter(m => m.yes_ask > 0 || m.yes_bid > 0 || m.last_price > 0);
}

module.exports = { kalshiRequest, getLiquidMarkets };
