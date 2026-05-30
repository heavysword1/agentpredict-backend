const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const router = express.Router();

const cache = new NodeCache({ stdTTL: 60 });
// Key loaded at request time

const AVAILABLE_SPORTS = [
  'basketball_nba',
  'americanfootball_nfl',
  'baseball_mlb',
  'icehockey_nhl',
  'soccer_epl',
  'mma_mixed_martial_arts',
  'tennis_atp_wimbledon',
  'golf_masters_tournament_winner'
];

/**
 * Calculate arbitrage opportunities for a given list of games
 */
function findArbitrageOpportunities(games) {
  const opportunities = [];
  const allGames = [];

  games.forEach(game => {
    const outcomes = {};
    let hasArb = false;
    let bestOddsPerOutcome = {};
    let impliedSum = 0;

    // For each outcome, find the best (highest) odds across all bookmakers
    game.bookmakers.forEach(bookmaker => {
      bookmaker.markets[0].outcomes.forEach(outcome => {
        if (!outcomes[outcome.name]) {
          outcomes[outcome.name] = [];
        }
        outcomes[outcome.name].push({
          bookmaker: bookmaker.title,
          odds: outcome.price
        });
      });
    });

    // Calculate implied probabilities and find best odds per outcome
    Object.keys(outcomes).forEach(outcomeName => {
      const bets = outcomes[outcomeName];
      const best = bets.reduce((prev, curr) =>
        curr.odds > prev.odds ? curr : prev
      );
      bestOddsPerOutcome[outcomeName] = best.odds;
      const impliedProb = 1 / best.odds;
      impliedSum += impliedProb;
    });

    allGames.push({
      game: `${game.home_team} vs ${game.away_team}`,
      best_odds_per_outcome: bestOddsPerOutcome,
      implied_sum: parseFloat(impliedSum.toFixed(4)),
      has_arb: impliedSum < 1.0
    });

    // If implied sum < 1.0, there's an arbitrage opportunity
    if (impliedSum < 1.0) {
      hasArb = true;
      const profitMargin = (1 - impliedSum) * 100;

      // Calculate optimal stakes for a $100 budget
      const budget = 100;
      const bets = [];
      const example100Budget = [];

      Object.keys(bestOddsPerOutcome).forEach(outcomeName => {
        const odds = bestOddsPerOutcome[outcomeName];
        const impliedProb = 1 / odds;

        // Find bookmaker for this outcome
        let bookmaker = '';
        game.bookmakers.forEach(b => {
          b.markets[0].outcomes.forEach(o => {
            if (o.name === outcomeName && o.price === odds) {
              bookmaker = b.title;
            }
          });
        });

        const stakePct = impliedProb / impliedSum;
        const stake = budget * stakePct;
        const returns = stake * odds;

        bets.push({
          outcome: outcomeName,
          bookmaker,
          odds: parseFloat(odds.toFixed(2)),
          implied_prob: parseFloat(impliedProb.toFixed(4)),
          recommended_stake_pct_of_budget: parseFloat((stakePct * 100).toFixed(2))
        });

        example100Budget.push({
          outcome: outcomeName,
          bookmaker,
          odds: parseFloat(odds.toFixed(2)),
          stake_usd: parseFloat(stake.toFixed(2)),
          return_usd: parseFloat(returns.toFixed(2))
        });
      });

      opportunities.push({
        game: `${game.home_team} vs ${game.away_team}`,
        commence_time: game.commence_time,
        profit_margin_pct: parseFloat(profitMargin.toFixed(2)),
        bets,
        example_100_budget
      });
    }
  });

  return { opportunities, allGames };
}

/**
 * GET /x402/predict/sports_arb
 * Query params: sport, regions, markets
 */
router.get('/', async (req, res) => {
  try {
    const sport = req.query.sport || 'basketball_nba';
    const regions = req.query.regions || 'us';
    const markets = req.query.markets || 'h2h';

    const ODDS_API_KEY = process.env.ODDS_API_KEY;
    if (!ODDS_API_KEY) {
      return res.status(500).json({
        success: false,
        error: 'ODDS_API_KEY not configured'
      });
    }

    if (!AVAILABLE_SPORTS.includes(sport)) {
      return res.status(400).json({
        success: false,
        error: `Invalid sport. Available: ${AVAILABLE_SPORTS.join(', ')}`
      });
    }

    const cacheKey = `sports_arb_${sport}_${regions}_${markets}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const url = `https://api.the-odds-api.com/v4/sports/${sport}/odds/?apiKey=${ODDS_API_KEY}&regions=${regions}&markets=${markets}&oddsFormat=decimal`;
    const response = await axios.get(url, { timeout: 15000 });
    const data = response.data;
    const requestsRemaining = response.headers['x-requests-remaining'] || 'unknown';

    if (!data) {
      return res.status(500).json({
        success: false,
        error: data.message || 'Failed to fetch odds'
      });
    }

    const games = Array.isArray(data) ? data : (data.data || []);
    const { opportunities, allGames } = findArbitrageOpportunities(games);

    const result = {
      success: true,
      sport,
      markets_checked: games.length,
      arb_count: opportunities.length,
      opportunities,
      all_games: allGames,
      disclaimer: 'Sports betting involves risk. Lines change rapidly. Verify odds before placing bets.',
      source: 'The Odds API',
      requests_remaining: requestsRemaining
    };

    cache.set(cacheKey, result);
    res.json(result);
  } catch (error) {
    console.error('sports_arb error:', error.message);
    const statusCode = error.response?.status || 500;
    res.status(statusCode).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
