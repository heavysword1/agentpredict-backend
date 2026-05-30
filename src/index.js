require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), override: true });
const express = require('express');
const cors = require('cors');
const { paymentMiddleware, x402ResourceServer } = require('@x402/express');
const { bazaarResourceServerExtension } = require('@x402/extensions');
const { ExactEvmScheme } = require('@x402/evm/exact/server');
const { HTTPFacilitatorClient } = require('@x402/core/server');

const marketsRouter = require('./routes/markets');
const marketRouter = require('./routes/market');
const trendingRouter = require('./routes/trending');
const mcpRouter = require('./routes/mcp');
const sportsArbRouter = require('./routes/sports_arb');
const platformArbRouter = require('./routes/platform_arb');

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3030;
const PAY_TO = process.env.PAY_TO_ADDRESS || '0x24FAcafEB49b4e3FACF0B3e69604A2F4640c9bf2';
const X402_NETWORK = process.env.X402_NETWORK || 'eip155:8453';
const FACILITATOR_URL = process.env.FACILITATOR_URL || 'https://x402.org/facilitator';

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'agentpredict', port: PORT }));
app.get('/.well-known/oauth-protected-resource', (req, res) => {
  res.json({ resource: 'https://predict.memoryapi.org/mcp', authorization_servers: [], bearer_methods_supported: [], resource_documentation: 'https://memoryapi.org' });
});
app.get('/.well-known/oauth-authorization-server', (req, res) => {
  res.status(404).json({ error: 'No OAuth required.' });
});

app.use('/mcp', mcpRouter);

try {
  const { createFacilitatorConfig } = require('@coinbase/x402');
  const rawConfig = createFacilitatorConfig(process.env.CDP_API_KEY_NAME, process.env.CDP_API_KEY_PRIVATE_KEY);
  const facilitatorClient = new HTTPFacilitatorClient({ url: rawConfig.url, createAuthHeaders: rawConfig.createAuthHeaders });
  const x402Server = new x402ResourceServer(facilitatorClient)
    .register(X402_NETWORK, new ExactEvmScheme())
    .registerExtension(bazaarResourceServerExtension);

  app.use(paymentMiddleware(
    {
      'GET /x402/predict/markets': {
        accepts: [{ scheme: 'exact', price: '$0.001', network: X402_NETWORK, payTo: PAY_TO }],
        description: 'Browse Polymarket prediction markets. Filter by category (crypto, politics, sports, economics, science, entertainment, pop-culture), search by keyword, or set limit.',
        extensions: { bazaar: { info: {
          description: 'Polymarket prediction markets browser. Free API with optional tag filtering and keyword search.',
          input: { type: 'http', method: 'GET',
            queryParams: { tag: 'crypto', q: 'bitcoin', limit: '20' },
            schema: { properties: {
              tag: { type: 'string', description: 'Category filter: crypto, politics, sports, economics, science, entertainment, pop-culture' },
              q: { type: 'string', description: 'Keyword search in question field' },
              limit: { type: 'number', description: 'Results count (default 20, max 50)' }
            }, required: [] }
          },
          output: { example: { success: true, count: 3, total_volume_usd: 15000000, markets: [{ id: 'market1', question: 'Will Bitcoin reach $100k by 2025?', category: 'crypto', volume_usd: 5000000, price: 0.65, outcomes: [{ name: 'Yes', price: 0.65 }, { name: 'No', price: 0.35 }] }], source: 'Polymarket' } }
        }}}
      },

      'GET /x402/predict/market': {
        accepts: [{ scheme: 'exact', price: '$0.001', network: X402_NETWORK, payTo: PAY_TO }],
        description: 'Get detailed information for a specific Polymarket prediction market including prices, outcomes, and trading volume.',
        extensions: { bazaar: { info: {
          description: 'Single market details from Polymarket. Returns prices, outcomes, volume, resolution status.',
          input: { type: 'http', method: 'GET',
            queryParams: { id: 'market-id' },
            schema: { properties: {
              id: { type: 'string', description: 'Market ID or condition_id. If not provided, returns highest volume market.' }
            }, required: [] }
          },
          output: { example: { success: true, id: 'market1', question: 'Will Bitcoin reach $100k?', volume_usd: 5000000, yes_price: 0.65, no_price: 0.35, outcomes_detail: [{ name: 'Yes', price: 0.65 }, { name: 'No', price: 0.35 }] } }
        }}}
      },

      'GET /x402/predict/trending': {
        accepts: [{ scheme: 'exact', price: '$0.001', network: X402_NETWORK, payTo: PAY_TO }],
        description: 'Get what prediction markets are betting on right now. Trending markets from Polymarket and Manifold by volume/liquidity.',
        extensions: { bazaar: { info: {
          description: 'Trending prediction markets - top markets by volume/liquidity. Combine Polymarket and Manifold.',
          input: { type: 'http', method: 'GET',
            queryParams: { source: 'all', limit: '10' },
            schema: { properties: {
              source: { type: 'string', description: 'polymarket, manifold, or all (default: all)' },
              limit: { type: 'number', description: 'Results count (default 10, max 50)' }
            }, required: [] }
          },
          output: { example: { success: true, trending: [{ question: 'Will Bitcoin reach $100k?', source: 'Polymarket', volume_or_liquidity: 5000000, probability: 0.65 }] } }
        }}}
      },

      'GET /x402/predict/sports_arb': {
        accepts: [{ scheme: 'exact', price: '$0.005', network: X402_NETWORK, payTo: PAY_TO }],
        description: 'Find sports betting arbitrage opportunities from The Odds API.',
        extensions: { bazaar: { info: {
          description: 'Sports betting arbitrage detection. Returns opportunities where implied probabilities < 100%.',
          input: { type: 'http', method: 'GET',
            queryParams: { sport: 'basketball_nba', regions: 'us', markets: 'h2h' },
            schema: { properties: {
              sport: { type: 'string', description: 'basketball_nba, americanfootball_nfl, baseball_mlb, icehockey_nhl, soccer_epl, mma_mixed_martial_arts, tennis_atp_wimbledon, golf_masters_tournament_winner' },
              regions: { type: 'string', description: 'us, uk, eu, au (default: us)' },
              markets: { type: 'string', description: 'h2h, spreads, totals (default: h2h)' }
            }, required: [] }
          },
          output: { example: { success: true, sport: 'basketball_nba', arb_count: 1, opportunities: [{ game: 'Team A vs Team B', profit_margin_pct: 2.5, bets: [] }] } }
        }}}
      },

      'GET /x402/predict/platform_arb': {
        accepts: [{ scheme: 'exact', price: '$0.001', network: X402_NETWORK, payTo: PAY_TO }],
        description: 'Find prediction market arbitrage across Polymarket, Kalshi, and Manifold.',
        extensions: { bazaar: { info: {
          description: 'Cross-platform prediction market arbitrage. Fuzzy-matches events and detects mispricings.',
          input: { type: 'http', method: 'GET',
            schema: { properties: {}, required: [] }
          },
          output: { example: { success: true, arb_opportunities: 2, pairs: [{ event_topic: 'event words', spread_pct: 5.2, signal: 'ARB' }] } }
        }}}
      }
    },
    x402Server,
    { afterSettle: (req, res, next, s) => { const e = s?.extensionResponses; if (e) console.log('[CDP] EXTENSION-RESPONSES:', JSON.stringify(e)); next(); } },
    null, true
  ));

  console.log('✅ x402 payment middleware registered');
} catch (err) {
  console.warn('⚠️  x402 middleware skipped:', err.message);
}

app.use('/x402/predict/markets', marketsRouter);
app.use('/x402/predict/market', marketRouter);
app.use('/x402/predict/trending', trendingRouter);
app.use('/x402/predict/sports_arb', sportsArbRouter);
app.use('/x402/predict/platform_arb', platformArbRouter);

app.get('/openapi.json', (req, res) => {
  const spec = {
    openapi: '3.1.0',
    info: {
      title: 'AgentPredict x402 API',
      description: 'Prediction markets API - browse and track Polymarket and Manifold markets. All endpoints support x402 HTTP 402 payment protocol.',
      version: '1.0.0'
    },
    servers: [
      { url: 'https://predict.memoryapi.org', description: 'Production' },
      { url: 'http://localhost:3030', description: 'Local development' }
    ],
    paths: {
      '/x402/predict/markets': {
        get: {
          summary: 'Browse Polymarket prediction markets',
          description: 'Search and filter prediction markets by category, keyword, or volume',
          'x-price': '$0.001',
          parameters: [
            { name: 'tag', in: 'query', schema: { type: 'string' }, description: 'Category: crypto, politics, sports, economics, science, entertainment, pop-culture' },
            { name: 'q', in: 'query', schema: { type: 'string' }, description: 'Keyword search' },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20, maximum: 50 } }
          ],
          responses: {
            '200': {
              description: 'Markets list',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean' },
                      count: { type: 'integer' },
                      total_volume_usd: { type: 'number' },
                      markets: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            id: { type: 'string' },
                            question: { type: 'string' },
                            category: { type: 'string' },
                            volume_usd: { type: 'number' },
                            price: { type: 'number', description: 'Probability (0-1)' },
                            outcomes: { type: 'array' }
                          }
                        }
                      },
                      source: { type: 'string' }
                    }
                  }
                }
              }
            },
            '402': { description: 'Payment required' }
          }
        }
      },
      '/x402/predict/market': {
        get: {
          summary: 'Get market details',
          description: 'Fetch detailed information for a specific market',
          'x-price': '$0.001',
          parameters: [
            { name: 'id', in: 'query', schema: { type: 'string' }, description: 'Market ID (optional - defaults to top market)' }
          ],
          responses: {
            '200': {
              description: 'Market details',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      question: { type: 'string' },
                      volume_usd: { type: 'number' },
                      yes_price: { type: 'number' },
                      no_price: { type: 'number' },
                      outcomes_detail: { type: 'array' }
                    }
                  }
                }
              }
            },
            '402': { description: 'Payment required' }
          }
        }
      },
      '/x402/predict/trending': {
        get: {
          summary: 'Get trending markets',
          description: 'Fetch top prediction markets by volume/liquidity',
          'x-price': '$0.001',
          parameters: [
            { name: 'source', in: 'query', schema: { type: 'string', enum: ['polymarket', 'manifold', 'all'], default: 'all' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 10, maximum: 50 } }
          ],
          responses: {
            '200': {
              description: 'Trending markets',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean' },
                      trending: { type: 'array' },
                      source: { type: 'string' },
                      updated_at: { type: 'string' }
                    }
                  }
                }
              }
            },
            '402': { description: 'Payment required' }
          }
        }
      },
      '/mcp': {
        get: {
          summary: 'MCP protocol endpoint',
          security: [],
          responses: { '200': { description: 'MCP server info' } }
        },
        post: {
          summary: 'MCP tools execution',
          security: [],
          requestBody: {
            content: { 'application/json': { schema: { type: 'object' } } }
          },
          responses: { '200': { description: 'Tool result' } }
        }
      }
    }
  };
  res.json(spec);
});

app.listen(PORT, () => console.log(`AgentPredict running on port ${PORT}`));
