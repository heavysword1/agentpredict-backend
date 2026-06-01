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
      'https://gamma-api.polymarket.com/markets?limit=200&order=volume&ascending=false',
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


    // === SUREBET DETECTION ===
    // When YES_ask + NO_ask < 1.00, buying both guarantees profit
    const allMarkets = Array.isArray(polyData) ? polyData : [];
    
    for (const market of allMarkets) {
      const yesAsk = parseFloat(market.bestAsk || market.lastTradePrice || 0);
      const noAsk = 1 - parseFloat(market.bestBid || market.lastTradePrice || 1);
      
      // Try with outcomeTokens if available
      const tokens = market.tokens || [];
      let yesToken = tokens.find(t => (t.outcome || t.title || '').toUpperCase().includes('YES'));
      let noToken = tokens.find(t => (t.outcome || t.title || '').toUpperCase().includes('NO'));
      
      const yesPrice = yesToken ? parseFloat(yesToken.price || 0) : yesAsk;
      const noPrice = noToken ? parseFloat(noToken.price || 0) : noAsk;
      
      if (yesPrice <= 0 || noPrice <= 0 || yesPrice >= 1 || noPrice >= 1) continue;
      
      const sumProb = yesPrice + noPrice;
      if (sumProb < 0.98) { // Less than 98¢ total = at least 2% guaranteed profit
        const profitPct = Math.round((1 - sumProb) * 10000) / 100;
        const vol = parseFloat(market.volumeNum || 0);
        
        if (profitPct >= 2 && vol > 100) { // At least 2% and $100 volume
          opportunities.push({
            type: 'surebet',
            question: market.question?.substring(0, 100),
            platform: 'Polymarket',
            yes_price: yesPrice,
            no_price: noPrice,
            sum_probability: Math.round(sumProb * 100) / 100,
            guaranteed_profit_pct: profitPct,
            price_diff: Math.round((1 - sumProb) * 100) / 100,
            edge_pct: profitPct,
            volume_usd: vol,
            action: `BUY YES at $${yesPrice.toFixed(3)} AND BUY NO at $${noPrice.toFixed(3)} — guaranteed $${(1-sumProb).toFixed(3)} profit per $${sumProb.toFixed(3)} invested`,
            example_100: `Invest $${(sumProb*100).toFixed(2)}: Buy $${(yesPrice*100).toFixed(2)} YES + $${(noPrice*100).toFixed(2)} NO → one side pays $100 → profit $${((1-sumProb)*100).toFixed(2)}`
          });
        }
      }
    }
    opportunities.sort((a, b) => b.edge_pct - a.edge_pct);



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
