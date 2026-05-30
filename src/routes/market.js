const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const router = express.Router();

const cache = new NodeCache({ stdTTL: 60 }); // 1 minute for single market (prices change fast)

const POLYMARKET_API = 'https://gamma-api.polymarket.com/markets';
const CLOB_API = 'https://clob.polymarket.com/book';

async function fetchMarketDetails(id) {
  let market = null;

  // Try to fetch by ID first
  try {
    const { data } = await axios.get(`${POLYMARKET_API}/${id}`, { timeout: 15000 });
    market = data;
  } catch (err) {
    // Try by conditionId
    try {
      const { data } = await axios.get(POLYMARKET_API, {
        params: { conditionId: id, limit: 1 },
        timeout: 15000
      });
      if (data && data.length > 0) {
        market = data[0];
      }
    } catch (e) {
      // Fall back to top market by volume
      const { data } = await axios.get(POLYMARKET_API, {
        params: { limit: 1, active: true, closed: false, order: 'volume', ascending: false },
        timeout: 15000
      });
      if (data && data.length > 0) {
        market = data[0];
      }
    }
  }

  if (!market) {
    throw new Error('Market not found');
  }

  // Fetch orderbook for detailed pricing
  let orderbook = null;
  if (market.tokens && market.tokens.length > 0) {
    const token_id = market.tokens[0].token_id;
    try {
      const { data } = await axios.get(CLOB_API, {
        params: { token_id },
        timeout: 10000
      });
      orderbook = data;
    } catch (err) {
      // Continue without orderbook
      console.warn('Could not fetch orderbook for', token_id);
    }
  }

  // Extract prices from tokens or orderbook
  let yes_price = 0, no_price = 0;
  const outcomes_detail = [];
  
  if (market.tokens && market.tokens.length > 0) {
    for (const token of market.tokens) {
      const outcome = {
        name: token.outcome,
        price: token.price || 0,
        token_id: token.token_id
      };
      outcomes_detail.push(outcome);
      
      if (token.outcome === 'Yes' || token.outcome === 'YES') {
        yes_price = token.price || 0;
      } else if (token.outcome === 'No' || token.outcome === 'NO') {
        no_price = token.price || 0;
      }
    }
  }

  // Build response
  const response = {
    id: market.id,
    question: market.question,
    description: market.description || '',
    volume_usd: market.volumeNum || 0,
    yes_price,
    no_price,
    end_date: market.endDate,
    category: market.category,
    resolved: market.resolved || false,
    outcome_if_resolved: market.outcomePrices ? Object.keys(market.outcomePrices)[0] : null,
    outcomes_detail,
    source: 'Polymarket'
  };

  return response;
}

router.get('/', async (req, res) => {
  try {
    const { id } = req.query;

    const cacheKey = `market:${id || 'trending'}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const response = await fetchMarketDetails(id || 'trending');
    
    cache.set(cacheKey, response);
    res.json(response);
  } catch (err) {
    console.error('Error fetching market:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
