const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const router = express.Router();
const cache = new NodeCache({ stdTTL: 300 });

const STOP_WORDS = new Set(['the','a','an','will','be','to','in','on','of','for','and','or','is','at','by','from','with']);

function extractKeywords(text) {
  return (text || '').toLowerCase().replace(/[^a-z0-9 ]/g,'').split(' ').filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

function overlap(kw1, kw2) {
  const s1 = new Set(kw1), s2 = new Set(kw2);
  const inter = [...s1].filter(x => s2.has(x)).length;
  const union = new Set([...s1,...s2]).size;
  return union > 0 ? inter/union : 0;
}

router.get('/', async (req, res) => {
  try {
    const cacheKey = 'platform_arb';
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    // Fetch all 3 sources in parallel
    const [polyRes, kalshiRes, manifoldRes] = await Promise.allSettled([
      axios.get('https://gamma-api.polymarket.com/markets?limit=50&active=true&closed=false&order=volume&ascending=false', { timeout: 12000 }),
      axios.get('https://api.elections.kalshi.com/trade-api/v2/markets?limit=50&status=open', { timeout: 12000 }),
      axios.get('https://api.manifold.markets/v0/markets?limit=50&sort=liquidity', { timeout: 12000 })
    ]);

    const polyMarkets = polyRes.status === 'fulfilled' ? (Array.isArray(polyRes.value.data) ? polyRes.value.data : Object.values(polyRes.value.data)) : [];
    const kalshiMarkets = kalshiRes.status === 'fulfilled' ? (kalshiRes.value.data?.markets || []) : [];
    const manifoldMarkets = manifoldRes.status === 'fulfilled' ? (Array.isArray(manifoldRes.value.data) ? manifoldRes.value.data : []) : [];

    const pairs = [];

    polyMarkets.slice(0, 30).forEach(poly => {
      const polyProb = parseFloat(poly.lastTradePrice) || 0;
      if (polyProb === 0 || polyProb === 1) return;
      const polyKw = extractKeywords(poly.question || '');

      // Compare vs Kalshi
      kalshiMarkets.forEach(k => {
        const kKw = extractKeywords(k.title || '');
        const score = overlap(polyKw, kKw);
        if (score < 0.25) return;
        const kProb = (k.yes_bid || k.yes_ask || 0) / 100;
        if (kProb === 0) return;
        const spread = Math.abs(polyProb - kProb) * 100;
        const implied = polyProb + (1 - kProb);
        pairs.push({
          event_topic: poly.question?.substring(0, 80),
          match_score: Math.round(score * 100),
          polymarket: { question: poly.question?.substring(0,80), probability: polyProb, volume_usd: poly.volumeNum || 0, url: `https://polymarket.com/event/${poly.slug}` },
          other: { question: k.title?.substring(0,80), probability: kProb, platform: 'Kalshi', url: `https://kalshi.com/markets/${k.ticker}` },
          spread_pct: Math.round(spread * 100) / 100,
          implied_sum: Math.round(implied * 1000) / 1000,
          signal: implied < 0.98 ? 'ARB' : spread > 5 ? 'WATCH' : 'ALIGNED'
        });
      });

      // Compare vs Manifold
      manifoldMarkets.forEach(m => {
        if (m.outcomeType !== 'BINARY') return;
        const mKw = extractKeywords(m.question || '');
        const score = overlap(polyKw, mKw);
        if (score < 0.25) return;
        const mProb = m.probability || 0;
        if (mProb === 0) return;
        const spread = Math.abs(polyProb - mProb) * 100;
        const implied = polyProb + (1 - mProb);
        pairs.push({
          event_topic: poly.question?.substring(0, 80),
          match_score: Math.round(score * 100),
          polymarket: { question: poly.question?.substring(0,80), probability: polyProb, volume_usd: poly.volumeNum || 0 },
          other: { question: m.question?.substring(0,80), probability: mProb, platform: 'Manifold', url: m.url },
          spread_pct: Math.round(spread * 100) / 100,
          implied_sum: Math.round(implied * 1000) / 1000,
          signal: implied < 0.98 ? 'ARB' : spread > 5 ? 'WATCH' : 'ALIGNED'
        });
      });
    });

    pairs.sort((a, b) => b.spread_pct - a.spread_pct);
    const arbs = pairs.filter(p => p.signal === 'ARB');

    const result = {
      success: true,
      platforms_checked: { polymarket: polyMarkets.length, kalshi: kalshiMarkets.length, manifold: manifoldMarkets.length },
      matches_found: pairs.length,
      arb_opportunities: arbs.length,
      pairs: pairs.slice(0, 20),
      source: 'Polymarket + Kalshi + Manifold',
      disclaimer: 'Cross-platform prediction market data. Verify independently before trading.'
    };

    cache.set(cacheKey, result);
    res.json(result);
  } catch (err) {
    console.error('platform_arb error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
