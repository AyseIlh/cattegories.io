// Player analytics: append-only JSONL event log + in-memory daily aggregates.
//
// Every event is one JSON line in `events-YYYY-MM-DD.jsonl` (UTC day) inside
// ANALYTICS_DIR (default ./analytics). On boot, today's and yesterday's files
// are replayed into memory so a restart doesn't lose the day's counters.
//
// Railway's filesystem is ephemeral: without a volume the log files vanish on
// redeploy (same as the in-memory stats always did). Mount a volume and set
// ANALYTICS_DIR=/data/analytics for persistence.
//
// HARD RULE: analytics must never break the game. Every public function
// swallows its own errors and only logs them to the console.

const fs = require('fs');
const path = require('path');

const ANALYTICS_DIR = (process.env.ANALYTICS_DIR || path.join(__dirname, 'analytics')).trim();
const KEEP_DAYS = 2; // how many UTC day buckets stay in memory

function dayKey(t = Date.now()) {
  return new Date(t).toISOString().slice(0, 10); // YYYY-MM-DD, UTC
}

function fileFor(day) {
  return path.join(ANALYTICS_DIR, `events-${day}.jsonl`);
}

function freshAgg() {
  return {
    pageviews: 0,
    visitors: new Set(), // IPs that loaded the page
    players: new Set(), // IPs that joined a room
    sessions: 0, // room entries (a re-join counts again)
    leaves: 0, // room exits with a measured duration
    totalPlaySec: 0,
    words: new Map(), // valid answer -> times written
    rejected: new Map(), // rejected answer -> times written
  };
}

const days = new Map(); // dayKey -> aggregate

function aggFor(day) {
  let agg = days.get(day);
  if (!agg) {
    agg = freshAgg();
    days.set(day, agg);
    // Prune old buckets: keep only the most recent KEEP_DAYS keys.
    const keys = [...days.keys()].sort();
    while (keys.length > KEEP_DAYS) days.delete(keys.shift());
  }
  return agg;
}

function applyEvent(agg, type, d) {
  switch (type) {
    case 'pageview':
      agg.pageviews += 1;
      if (d.ip) agg.visitors.add(d.ip);
      break;
    case 'join':
      agg.sessions += 1;
      if (d.ip) agg.players.add(d.ip);
      break;
    case 'leave':
      agg.leaves += 1;
      if (typeof d.durationSec === 'number' && d.durationSec >= 0) {
        agg.totalPlaySec += d.durationSec;
      }
      break;
    case 'word': {
      if (!d.word) break;
      const map = d.valid ? agg.words : agg.rejected;
      map.set(d.word, (map.get(d.word) || 0) + 1);
      break;
    }
  }
}

function init() {
  try {
    fs.mkdirSync(ANALYTICS_DIR, { recursive: true });
    const today = dayKey();
    const yesterday = dayKey(Date.now() - 24 * 3600 * 1000);
    for (const day of [yesterday, today]) {
      let content;
      try {
        content = fs.readFileSync(fileFor(day), 'utf8');
      } catch {
        continue; // no log for that day yet — normal
      }
      const agg = aggFor(day);
      for (const line of content.split('\n')) {
        if (!line) continue;
        try {
          const ev = JSON.parse(line);
          applyEvent(agg, ev.type, ev);
        } catch {
          // one corrupt line must not kill the rest of the replay
        }
      }
    }
  } catch (err) {
    console.error('[analytics] init failed (analytics disabled):', err.message);
  }
}

// Fire-and-forget: appends the event to today's file and updates the
// in-memory aggregate. Async errors go to the console, never to the caller.
function trackEvent(type, data = {}) {
  try {
    const t = Date.now();
    const day = dayKey(t);
    applyEvent(aggFor(day), type, data);
    const line = JSON.stringify({ t, type, ...data }) + '\n';
    fs.appendFile(fileFor(day), line, (err) => {
      if (err) console.error('[analytics] write failed:', err.message);
    });
  } catch (err) {
    console.error('[analytics] trackEvent failed:', err.message);
  }
}

function topEntries(map, n = 20) {
  return [...map.entries()]
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
    .slice(0, n);
}

// Serializable snapshot of one UTC day (default: today) for the /stats page.
function getDailyStats(day = dayKey()) {
  try {
    const agg = days.get(day) || freshAgg();
    return {
      day,
      pageviews: agg.pageviews,
      uniqueVisitors: agg.visitors.size,
      uniquePlayers: agg.players.size,
      sessions: agg.sessions,
      avgSessionSec: agg.leaves ? Math.round(agg.totalPlaySec / agg.leaves) : 0,
      totalPlayMin: Math.round(agg.totalPlaySec / 60),
      topWords: topEntries(agg.words),
      topRejected: topEntries(agg.rejected),
    };
  } catch (err) {
    console.error('[analytics] getDailyStats failed:', err.message);
    return {
      day, pageviews: 0, uniqueVisitors: 0, uniquePlayers: 0, sessions: 0,
      avgSessionSec: 0, totalPlayMin: 0, topWords: [], topRejected: [],
    };
  }
}

module.exports = { init, trackEvent, getDailyStats };
