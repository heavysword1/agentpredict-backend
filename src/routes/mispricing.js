const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const router = express.Router();
const cache = new NodeCache({ stdTTL: 120 }); // 2min cache

const { parseWeatherQuestion, verifyWeatherOutcome } = require('../parsers/weather_parser');

router.get('/', async (req, res) => {
  try {
    const cacheKey = 'mispricing';
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const opportunities = [];
    const checked = [];

    // Fetch Polymarket weather markets
    const { data: polyData } = await axios.get(
      'https://gamma-api.polymarket.com/markets?limit=200&active=true&closed=false',
      { timeout: 12000 }
    );
    const polyMarkets = Array.isArray(polyData) ? polyData : [];
    
    // Filter weather-related markets
    const weatherMarkets = polyMarkets.filter(m => 
      /(temperature|degrees|°F|°C|rain|snow|storm|weather|highest temp|lowest temp)/i.test(m.question || '')
    );

    // Check each weather market
    for (const market of weatherMarkets.slice(0, 30)) {
      try {
        const parsed = parseWeatherQuestion(market.question);
        if (!parsed) continue;
        
        const verification = await verifyWeatherOutcome(parsed);
        if (!verification) continue;
        
        const marketProb = parseFloat(market.lastTradePrice || 0);
        const volume = parseFloat(market.volumeNum || 0);
        
        checked.push({
          question: market.question?.substring(0, 80),
          market_prob: marketProb,
          actual_temp: verification.actual,
          threshold: verification.threshold,
          outcome: verification.outcome,
          is_past: verification.isPast,
          date: verification.date
        });
        
        if (verification.isPast && verification.outcome !== null) {
          const expectedProb = verification.outcome ? 0.97 : 0.03;
          const priceDiff = Math.abs(expectedProb - marketProb);
          
          if (priceDiff > 0.15 && volume > 50) {
            opportunities.push({
              type: 'weather_outcome',
              question: market.question?.substring(0, 100),
              platform: 'Polymarket',
              market_prob: marketProb,
              expected_prob: expectedProb,
              price_diff: Math.round(priceDiff * 100) / 100,
              outcome: verification.outcome ? 'YES' : 'NO',
              actual: `${verification.actual}°${verification.unit || 'C'}`,
              threshold: `${verification.threshold}°${verification.unit || 'C'}`,
              date: verification.date,
              volume_usd: volume,
              action: verification.outcome ? `BUY YES (market at ${(marketProb*100).toFixed(1)}%, outcome is YES)` : `BUY NO (market at ${(marketProb*100).toFixed(1)}%, outcome is NO)`,
              edge_pct: Math.round(priceDiff * 100)
            });
          }
        }
        
        // Small delay to be nice to APIs
        await new Promise(r => setTimeout(r, 200));
      } catch(e) {
        // Skip individual market errors
      }
    }

    // Sort by edge
    opportunities.sort((a, b) => b.price_diff - a.price_diff);

    const result = {
      success: true,
      markets_checked: checked.length,
      opportunities_found: opportunities.length,
      opportunities,
      all_checked: checked.slice(0, 10),
      source: 'Polymarket + Open-Meteo weather verification',
      disclaimer: 'Not financial advice. Verify independently before trading.'
    };

    cache.set(cacheKey, result);
    res.json(result);
  } catch (err) {
    console.error('[mispricing]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
