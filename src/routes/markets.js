const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const router = express.Router();

const cache = new NodeCache({ stdTTL: 300 }); // 5 minutes for markets

const POLYMARKET_API = 'https://gamma-api.polymarket.com/markets';

const VALID_TAGS = [
  'crypto', 'politics', 'sports', 'economics', 'science', 'entertainment', 'pop-culture'
];

async function fetchMarkets(params) {
  const queryParams = {
    limit: Math.min(parseInt(params.limit) || 20, 50),
    active: true,
    closed: false,
    order: 'volume',
    ascending: false
  };

  if (params.tag && VALID_TAGS.includes(params.tag)) {
    queryParams.tag_slug = params.tag;
  }

  if (params.q) {
    queryParams.search = params.q;
  }

  const { data } = await axios.get(POLYMARKET_API, { params: queryParams, timeout: 15000 });
  return data;
}

router.get('/', async (req, res) => {
  try {
    const cacheKey = `markets:${JSON.stringify(req.query)}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const markets = await fetchMarkets(req.query);
    
    const total_volume_usd = (markets || []).reduce((sum, m) => sum + (m.volumeNum || 0), 0);

    const response = {
      success: true,
      count: (markets || []).length,
      total_volume_usd,
      markets: (markets || []).map(m => ({
        id: m.id,
        question: m.question,
        category: m.category,
        volume_usd: m.volumeNum || 0,
        price: m.lastTradePrice || 0,
        end_date: m.endDate,
        active: m.active !== false,
        outcomes: (m.tokens || []).map(t => ({
          name: t.outcome,
          price: t.price
        }))
      })),
      source: 'Polymarket'
    };

    cache.set(cacheKey, response);
    res.json(response);
  } catch (err) {
    console.error('Error fetching markets:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
