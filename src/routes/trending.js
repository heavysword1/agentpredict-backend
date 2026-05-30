const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const router = express.Router();

const cache = new NodeCache({ stdTTL: 600 }); // 10 minutes

const POLYMARKET_API = 'https://gamma-api.polymarket.com/markets';
const MANIFOLD_API = 'https://api.manifold.markets/v0/markets';

async function fetchTrendingMarkets(source = 'all', limit = 10) {
  const trending = [];
  const now = new Date().toISOString();

  if (source === 'polymarket' || source === 'all') {
    try {
      const { data } = await axios.get(POLYMARKET_API, {
        params: {
          limit: Math.min(limit, 50),
          active: true,
          closed: false,
          order: 'volume',
          ascending: false
        },
        timeout: 15000
      });

      if (data && Array.isArray(data)) {
        trending.push(...data.slice(0, limit).map(m => ({
          question: m.question,
          source: 'Polymarket',
          volume_or_liquidity: m.volumeNum || 0,
          probability: m.lastTradePrice || 0,
          url: `https://polymarket.com/market/${m.id}`,
          category: m.category,
          end_date: m.endDate
        })));
      }
    } catch (err) {
      console.warn('Error fetching Polymarket trending:', err.message);
    }
  }

  if (source === 'manifold' || source === 'all') {
    try {
      const { data } = await axios.get(MANIFOLD_API, {
        params: {
          limit: Math.min(limit, 50),
          sort: 'liquidity'
        },
        timeout: 15000
      });

      if (data && Array.isArray(data)) {
        trending.push(...data.slice(0, limit).map(m => ({
          question: m.question,
          source: 'Manifold',
          volume_or_liquidity: m.volume || m.liquidity || 0,
          probability: m.probability || 0,
          url: `https://manifold.markets/${m.creatorUsername}/${m.slug}`,
          category: m.category || 'general',
          end_date: m.closeTime ? new Date(m.closeTime).toISOString() : null
        })));
      }
    } catch (err) {
      console.warn('Error fetching Manifold trending:', err.message);
    }
  }

  // Sort by volume/liquidity and return top N
  return trending
    .sort((a, b) => (b.volume_or_liquidity || 0) - (a.volume_or_liquidity || 0))
    .slice(0, limit);
}

router.get('/', async (req, res) => {
  try {
    const { source = 'all', limit = 10 } = req.query;

    // Validate source
    if (!['polymarket', 'manifold', 'all'].includes(source)) {
      return res.status(400).json({ error: 'Invalid source. Use polymarket, manifold, or all.' });
    }

    const cacheKey = `trending:${source}:${limit}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const limitNum = Math.min(parseInt(limit) || 10, 50);
    const markets = await fetchTrendingMarkets(source, limitNum);

    const response = {
      success: true,
      updated_at: new Date().toISOString(),
      source,
      count: markets.length,
      trending: markets
    };

    cache.set(cacheKey, response);
    res.json(response);
  } catch (err) {
    console.error('Error fetching trending:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
