const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const router = express.Router();

const cache = new NodeCache({ stdTTL: 300 });

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'as', 'is', 'are', 'was', 'were', 'be',
  'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
  'would', 'should', 'could', 'may', 'might', 'must', 'can', 'this',
  'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they'
]);

/**
 * Extract keywords from text, removing stopwords
 */
function extractKeywords(text) {
  return text
    .toLowerCase()
    .split(/\s+/)
    .filter(word => word.length > 2 && !STOPWORDS.has(word))
    .slice(0, 10);
}

/**
 * Calculate word overlap score between two keyword sets
 */
function calculateOverlapScore(keywords1, keywords2) {
  const set1 = new Set(keywords1);
  const set2 = new Set(keywords2);
  const intersection = [...set1].filter(w => set2.has(w)).length;
  const union = new Set([...set1, ...set2]).size;
  return union > 0 ? (intersection / union) * 100 : 0;
}

/**
 * Fetch Polymarket markets
 */
async function fetchPolymarkets() {
  const url = 'https://gamma-api.polymarket.com/markets?limit=50&active=true&closed=false&order=volume&ascending=false';
  const response = await axios.get(url, { timeout: 15000 });
  return response.data;
}

/**
 * Fetch Kalshi markets
 */
async function fetchKalshiMarkets() {
  const url = 'https://api.elections.kalshi.com/trade-api/v2/markets?limit=50&status=open';
  const response = await axios.get(url, { timeout: 15000 });
  return response.data.markets || [];
}

/**
 * Fetch Manifold markets
 */
async function fetchManifoldMarkets() {
  const url = 'https://api.manifold.markets/v0/markets?limit=50&sort=liquidity';
  const response = await axios.get(url, { timeout: 15000 });
  return response.data;
}

/**
 * Find arbitrage pairs between prediction markets
 */
async function findArbPairs() {
  try {
    // Fetch all platform data
    const [polymarkets, kalshiMarkets, manifoldMarkets] = await Promise.all([
      fetchPolymarkets(),
      fetchKalshiMarkets(),
      fetchManifoldMarkets()
    ]);

    const pairs = [];
    const matchedEvents = new Set();

    // Process Polymarket vs Kalshi
    polymarkets.forEach(poly => {
      if (!poly.question) return;
      const polyKeywords = extractKeywords(poly.question);

      kalshiMarkets.forEach(kalshi => {
        if (!kalshi.title || matchedEvents.has(`${poly.id}_${kalshi.id}`)) return;
        const kalshiKeywords = extractKeywords(kalshi.title);
        const overlapScore = calculateOverlapScore(polyKeywords, kalshiKeywords);

        if (overlapScore > 40) {
          const polyProb = poly.lastTradePrice || 0.5;
          const kalshiProb = (kalshi.yes_ask || 50) / 100;

          const spreadPct = Math.abs(polyProb - kalshiProb) * 100;
          let signal = 'ALIGNED';
          let hasArb = false;

          // Check for arbitrage: if probabilities on opposite sides sum < 1
          if (polyProb + (1 - kalshiProb) < 1.0) {
            signal = 'ARB';
            hasArb = true;
          } else if (spreadPct > 5) {
            signal = 'WATCH';
          }

          pairs.push({
            event_topic: polyKeywords.slice(0, 3).join(' '),
            polymarket: {
              question: poly.question.substring(0, 100),
              probability: parseFloat(polyProb.toFixed(3)),
              volume_usd: poly.volume24h || 0,
              url: `https://polymarket.com/market/${poly.id}`
            },
            kalshi: {
              question: kalshi.title.substring(0, 100),
              probability: parseFloat(kalshiProb.toFixed(3)),
              platform: 'kalshi',
              url: `https://kalshi.com/markets/${kalshi.id}`
            },
            spread_pct: parseFloat(spreadPct.toFixed(2)),
            signal,
            has_arb: hasArb
          });

          matchedEvents.add(`${poly.id}_${kalshi.id}`);
        }
      });
    });

    // Process Polymarket vs Manifold
    polymarkets.forEach(poly => {
      if (!poly.question) return;
      const polyKeywords = extractKeywords(poly.question);

      manifoldMarkets.forEach(manifold => {
        if (!manifold.question || matchedEvents.has(`${poly.id}_${manifold.id}`)) return;
        const manifoldKeywords = extractKeywords(manifold.question);
        const overlapScore = calculateOverlapScore(polyKeywords, manifoldKeywords);

        if (overlapScore > 40) {
          const polyProb = poly.lastTradePrice || 0.5;
          const manifoldProb = (manifold.probability || 0.5);

          const spreadPct = Math.abs(polyProb - manifoldProb) * 100;
          let signal = 'ALIGNED';
          let hasArb = false;

          if (polyProb + (1 - manifoldProb) < 1.0) {
            signal = 'ARB';
            hasArb = true;
          } else if (spreadPct > 5) {
            signal = 'WATCH';
          }

          pairs.push({
            event_topic: polyKeywords.slice(0, 3).join(' '),
            polymarket: {
              question: poly.question.substring(0, 100),
              probability: parseFloat(polyProb.toFixed(3)),
              volume_usd: poly.volume24h || 0,
              url: `https://polymarket.com/market/${poly.id}`
            },
            manifold: {
              question: manifold.question.substring(0, 100),
              probability: parseFloat(manifoldProb.toFixed(3)),
              platform: 'manifold',
              url: `https://manifold.markets/${manifold.slug}`
            },
            spread_pct: parseFloat(spreadPct.toFixed(2)),
            signal,
            has_arb: hasArb
          });

          matchedEvents.add(`${poly.id}_${manifold.id}`);
        }
      });
    });

    const arbOpportunities = pairs.filter(p => p.has_arb).length;

    return {
      success: true,
      matches_found: pairs.length,
      arb_opportunities: arbOpportunities,
      pairs: pairs.slice(0, 20), // Return top 20
      source: 'Polymarket + Kalshi + Manifold'
    };
  } catch (error) {
    console.error('platform_arb error:', error);
    throw error;
  }
}

/**
 * GET /x402/predict/platform_arb
 */
router.get('/', async (req, res) => {
  try {
    const cacheKey = 'platform_arb_all';
    const cached = cache.get(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const result = await findArbPairs();
    cache.set(cacheKey, result);
    res.json(result);
  } catch (error) {
    console.error('platform_arb error:', error.message);
    const statusCode = error.response?.status || 500;
    res.status(statusCode).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
