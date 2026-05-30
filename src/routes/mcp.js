const express = require('express');
const axios = require('axios');
const router = express.Router();

const POLYMARKET_API = 'https://gamma-api.polymarket.com/markets';
const MANIFOLD_API = 'https://api.manifold.markets/v0/markets';

const TOOLS = [
  {
    name: 'browse_prediction_markets',
    description: 'Browse prediction markets from Polymarket and Manifold. Filter by category (crypto, politics, sports, economics, science, entertainment, pop-culture) or search by keyword.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'polymarket, manifold, or all (default: all)', default: 'all' },
        tag: { type: 'string', description: 'Category filter (crypto, politics, sports, economics, science, entertainment, pop-culture)' },
        q: { type: 'string', description: 'Keyword search' },
        limit: { type: 'number', description: 'Number of results (default 20, max 50)', default: 20 }
      }
    }
  },
  {
    name: 'get_market_details',
    description: 'Get detailed information for a specific prediction market including prices, outcomes, and trading volume.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Market ID or condition_id. If not provided, returns the highest volume active market.' },
        source: { type: 'string', description: 'polymarket or manifold (default: polymarket)', default: 'polymarket' }
      }
    }
  },
  {
    name: 'get_trending_predictions',
    description: 'Get what the prediction markets are betting on right now. Fetches top markets by volume/liquidity.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'polymarket, manifold, or all (default: all)', default: 'all' },
        limit: { type: 'number', description: 'Number of results (default 10, max 50)', default: 10 }
      }
    }
  }
];

async function executeTool(name, args) {
  switch (name) {
    case 'browse_prediction_markets': {
      const { source = 'all', tag, q, limit = 20 } = args;
      const markets = [];

      if (source === 'polymarket' || source === 'all') {
        try {
          const params = {
            limit: Math.min(limit, 50),
            active: true,
            closed: false,
            order: 'volume',
            ascending: false
          };
          if (tag) params.tag_slug = tag;
          if (q) params.search = q;

          const { data } = await axios.get(POLYMARKET_API, { params, timeout: 15000 });
          if (data && Array.isArray(data)) {
            markets.push(...data.map(m => ({
              id: m.id,
              question: m.question,
              source: 'Polymarket',
              category: m.category,
              volume_usd: m.volumeNum || 0,
              probability: m.lastTradePrice || 0,
              end_date: m.endDate,
              url: `https://polymarket.com/market/${m.id}`
            })));
          }
        } catch (err) {
          console.warn('Error fetching Polymarket:', err.message);
        }
      }

      if (source === 'manifold' || source === 'all') {
        try {
          const params = { limit: Math.min(limit, 50) };
          if (q) params.searchTerm = q;

          const { data } = await axios.get(MANIFOLD_API, { params, timeout: 15000 });
          if (data && Array.isArray(data)) {
            markets.push(...data.map(m => ({
              id: m.id,
              question: m.question,
              source: 'Manifold',
              category: m.category || 'general',
              volume_usd: m.volume || 0,
              probability: m.probability || 0,
              end_date: m.closeTime ? new Date(m.closeTime).toISOString() : null,
              url: `https://manifold.markets/${m.creatorUsername}/${m.slug}`
            })));
          }
        } catch (err) {
          console.warn('Error fetching Manifold:', err.message);
        }
      }

      return {
        success: true,
        count: markets.length,
        markets: markets.slice(0, limit),
        source
      };
    }

    case 'get_market_details': {
      const { id, source = 'polymarket' } = args;

      if (source === 'polymarket') {
        try {
          let market = null;
          
          if (id) {
            try {
              const { data } = await axios.get(`${POLYMARKET_API}/${id}`, { timeout: 15000 });
              market = data;
            } catch (err) {
              const { data } = await axios.get(POLYMARKET_API, {
                params: { conditionId: id, limit: 1 },
                timeout: 15000
              });
              if (data && data.length > 0) market = data[0];
            }
          } else {
            // Get top market by volume
            const { data } = await axios.get(POLYMARKET_API, {
              params: { limit: 1, active: true, closed: false, order: 'volume', ascending: false },
              timeout: 15000
            });
            if (data && data.length > 0) market = data[0];
          }

          if (!market) throw new Error('Market not found');

          const outcomes = (market.tokens || []).map(t => ({
            name: t.outcome,
            price: t.price || 0
          }));

          const yes_outcome = outcomes.find(o => o.name === 'Yes' || o.name === 'YES');
          const no_outcome = outcomes.find(o => o.name === 'No' || o.name === 'NO');

          return {
            success: true,
            id: market.id,
            question: market.question,
            description: market.description || '',
            volume_usd: market.volumeNum || 0,
            yes_price: yes_outcome?.price || 0,
            no_price: no_outcome?.price || 0,
            end_date: market.endDate,
            category: market.category,
            resolved: market.resolved || false,
            outcomes,
            url: `https://polymarket.com/market/${market.id}`,
            source: 'Polymarket'
          };
        } catch (err) {
          throw new Error(`Polymarket error: ${err.message}`);
        }
      }

      if (source === 'manifold') {
        try {
          if (!id) throw new Error('Market ID required for Manifold');

          const { data } = await axios.get(`${MANIFOLD_API}/${id}`, { timeout: 15000 });

          return {
            success: true,
            id: data.id,
            question: data.question,
            description: data.description || '',
            volume_usd: data.volume || 0,
            probability: data.probability || 0,
            yes_price: data.probability || 0,
            no_price: (1 - (data.probability || 0)) || 0,
            end_date: data.closeTime ? new Date(data.closeTime).toISOString() : null,
            category: data.category || 'general',
            resolved: data.isResolved || false,
            url: `https://manifold.markets/${data.creatorUsername}/${data.slug}`,
            source: 'Manifold'
          };
        } catch (err) {
          throw new Error(`Manifold error: ${err.message}`);
        }
      }

      throw new Error('Invalid source');
    }

    case 'get_trending_predictions': {
      const { source = 'all', limit = 10 } = args;
      const trending = [];

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
              url: `https://polymarket.com/market/${m.id}`
            })));
          }
        } catch (err) {
          console.warn('Error fetching Polymarket trending:', err.message);
        }
      }

      if (source === 'manifold' || source === 'all') {
        try {
          const { data } = await axios.get(MANIFOLD_API, {
            params: { limit: Math.min(limit, 50), sort: 'liquidity' },
            timeout: 15000
          });

          if (data && Array.isArray(data)) {
            trending.push(...data.slice(0, limit).map(m => ({
              question: m.question,
              source: 'Manifold',
              volume_or_liquidity: m.liquidity || m.volume || 0,
              probability: m.probability || 0,
              url: `https://manifold.markets/${m.creatorUsername}/${m.slug}`
            })));
          }
        } catch (err) {
          console.warn('Error fetching Manifold trending:', err.message);
        }
      }

      const sorted = trending
        .sort((a, b) => (b.volume_or_liquidity || 0) - (a.volume_or_liquidity || 0))
        .slice(0, limit);

      return {
        success: true,
        count: sorted.length,
        trending: sorted,
        source
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

router.get('/', (req, res) => {
  res.json({
    name: 'AgentPredict',
    version: '1.0.0',
    transport: 'http',
    protocol: 'mcp',
    tools: TOOLS.map(t => t.name)
  });
});

router.post('/', async (req, res) => {
  const { method, params, id } = req.body;
  try {
    let result;
    switch (method) {
      case 'initialize':
        result = {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'AgentPredict', version: '1.0.0' }
        };
        break;
      case 'tools/list':
        result = { tools: TOOLS };
        break;
      case 'tools/call': {
        const { name, arguments: args = {} } = params;
        const toolResult = await executeTool(name, args);
        result = { content: [{ type: 'text', text: JSON.stringify(toolResult, null, 2) }] };
        break;
      }
      default:
        return res.json({
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: 'Method not found' }
        });
    }
    res.json({ jsonrpc: '2.0', id, result });
  } catch (err) {
    res.json({ jsonrpc: '2.0', id, error: { code: -32000, message: err.message } });
  }
});

module.exports = router;
