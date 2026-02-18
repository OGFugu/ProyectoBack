import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import dotenv from "dotenv";

dotenv.config();



// 👇 primero crear __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 👇 luego crear app
const app = express();
app.use(cors());
app.use(express.json());

// 👇 ahora sí puedes usar public
app.use(express.static(path.join(__dirname, "public")));


// ================= CONFIG =================
const PORT = 3001;
const RIOT_API_KEY = process.env.RIOT_API_KEY;
console.log("API KEY:", RIOT_API_KEY);
const REGION = 'euw1'
const ROUTING = 'europe';

// ================= DB (SQLite) =================
const db = new Database("./lol.db");

// tabla de partidas (una fila por matchId + tu puuid)
db.exec(`
  CREATE TABLE IF NOT EXISTS matches (
    matchId TEXT NOT NULL,
    puuid TEXT NOT NULL,
    gameCreation INTEGER,      -- epoch ms
    gameEndTimestamp INTEGER,  -- epoch ms (si viene)
    gameDuration INTEGER,      -- seconds
    queueId INTEGER,
    championName TEXT,
    kills INTEGER,
    deaths INTEGER,
    assists INTEGER,
    win INTEGER,               -- 0/1
    json TEXT,                 -- raw JSON match (por si quieres)
    insertedAt INTEGER NOT NULL,
    PRIMARY KEY (matchId, puuid)
  );

  CREATE INDEX IF NOT EXISTS idx_matches_puuid_time
  ON matches(puuid, gameCreation DESC);
`);
// ===== META (para guardar last_sync etc) =====
db.exec(`
  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

const setMeta = db.prepare(`
  INSERT INTO meta(key, value)
  VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`);

const getMeta = db.prepare(`SELECT value FROM meta WHERE key = ?`);


// Cuenta fija (tu cuenta)
const RIOT_ID = {
  gameName: 'Peereira7',
  tagLine: 'CASTR',
  "profileIconId": 4568
};

// ================= HELPERS =================
// ================= HELPERS =================

// ✅ ESTA FUNCIÓN TIENE QUE ESTAR FUERA
function saveMatchToDb({ matchId, puuid, matchJson }) {
  const p = matchJson?.info?.participants?.find(x => x.puuid === puuid);
  if (!p) return;

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO matches (
      matchId, puuid, gameCreation, gameDuration,
      championName, kills, deaths, assists, win, json, insertedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    matchId,
    puuid,
    matchJson?.info?.gameCreation ?? null,
    matchJson?.info?.gameDuration ?? null,
    p.championName,
    p.kills,
    p.deaths,
    p.assists,
    p.win ? 1 : 0,
    JSON.stringify(matchJson),
    Date.now()
  );
}

async function riotFetch(url) {
  const res = await fetch(url, {
    headers: { 'X-Riot-Token': RIOT_API_KEY }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text);
  }

  return res.json();
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function riotFetchWithRetry(url, retries = 3) {
  try {
    return await riotFetch(url);
  } catch (e) {
    const msg = String(e.message || "");
    if (msg.includes("429") && retries > 0) {
      await sleep(1200); // espera 1.2s
      return riotFetchWithRetry(url, retries - 1);
    }
    throw e;
  }
}


// ================= ROUTES =================

// 1️⃣ Obtener cuenta + PUUID
app.get("/api/summoner", async (req, res) => {
  try {
    const account = await riotFetch(
      `https://${ROUTING}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${RIOT_ID.gameName}/${RIOT_ID.tagLine}`
    );

    const summoner = await riotFetch(
      `https://${REGION}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${account.puuid}`
    );

    res.json({
      gameName: account.gameName,
      tagLine: account.tagLine,
      puuid: account.puuid,
      profileIconId: summoner.profileIconId,
      summonerLevel: summoner.summonerLevel
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});



// 2️⃣ Obtener datos de invocador (ID para ranked)
app.get('/api/summoner-details/:puuid', async (req, res) => {
  try {
    const data = await riotFetch(
      `https://${REGION}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${req.params.puuid}`
    );
    console.log(data);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3️⃣ Rank actual
app.get('/api/rank/:summonerId', async (req, res) => {
  try {
    const ranked = await riotFetch(
      `https://${REGION}.api.riotgames.com/lol/league/v4/entries/by-summoner/${req.params.summonerId}`
    );
    res.json(ranked);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4️⃣ IDs de partidas recientes
app.get('/api/matches/:puuid', async (req, res) => {
  try {
    const matches = await riotFetch(
      `https://${ROUTING}.api.riotgames.com/lol/match/v5/matches/by-puuid/${req.params.puuid}/ids?count=20`
    );
    res.json(matches);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5️⃣ Datos completos de una partida
app.get('/api/match/:matchId', async (req, res) => {
  try {
    const match = await riotFetch(
      `https://${ROUTING}.api.riotgames.com/lol/match/v5/matches/${req.params.matchId}`
    );
    res.json(match);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// PERFIL COMPLETO (rank + matches + detalles)
app.get("/api/profile", async (req, res) => {
  try {
    const count = Number(req.query.count || 10);

    const account = await riotFetch(
      `https://${ROUTING}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${RIOT_ID.gameName}/${RIOT_ID.tagLine}`
    );

    const puuid = account.puuid;

    const rank = await riotFetch(
      `https://${REGION}.api.riotgames.com/lol/league/v4/entries/by-puuid/${puuid}`
    );

    const matchIds = await riotFetchWithRetry(
      `https://${ROUTING}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?startTime=${startTime}&count=30`
    );


    const matchDetails = await Promise.all(
      matchIds.map((id) =>
        riotFetch(`https://${ROUTING}.api.riotgames.com/lol/match/v5/matches/${id}`)
      )
    );

    res.json({ account, rank, matchIds, matchDetails });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ================= START =================
// ===== SINCRONIZAR PARTIDAS ÚLTIMOS 5 DÍAS =====
app.get("/api/sync", async (req, res) => {
  try {
    const days = 5;

    const account = await riotFetch(
      `https://${ROUTING}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${RIOT_ID.gameName}/${RIOT_ID.tagLine}`
    );
    const puuid = account.puuid;

    const startTime = Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000);

    const matchIds = await riotFetch(
      `https://${ROUTING}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?startTime=${startTime}&count=30`
    );

    let saved = 0;
    for (const id of matchIds) {
      // evitar pedir si ya existe
      const exists = db.prepare(
        "SELECT 1 FROM matches WHERE matchId = ? AND puuid = ?"
      ).get(id, puuid);

      if (exists) continue;

      const match = await riotFetchWithRetry(
        `https://${ROUTING}.api.riotgames.com/lol/match/v5/matches/${id}`
      );

      saveMatchToDb({ matchId: id, puuid, matchJson: match });
      saved++;

      await sleep(350); // evita rate limit
    }
    setMeta.run("last_sync", String(Date.now()));

    res.json({ ok: true, saved });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
//ENDPOINT PARA LEER LAS PARTIDAS GUARDADAS EN LA DB
app.get("/api/db/matches", (req, res) => {
  try {
    const since = Date.now() - 5 * 24 * 60 * 60 * 1000;

    const rows = db.prepare(`
      SELECT matchId, championName, kills, deaths, assists, win, gameCreation
      FROM matches
      WHERE gameCreation >= ?
      ORDER BY gameCreation DESC
    `).all(since);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// ENDPOINT: campeones agregados (wins/losses, WR y KDA) últimos X días
app.get("/api/db/champions", (req, res) => {
  try {
    const days = Number(req.query.days || 5);
    const limit = Number(req.query.limit || 10);
    const since = Date.now() - days * 24 * 60 * 60 * 1000;

    const rows = db.prepare(`
      SELECT
        championName,
        COUNT(*) AS games,
        SUM(win) AS wins,
        (COUNT(*) - SUM(win)) AS losses,
        ROUND( (SUM(kills) + SUM(assists)) * 1.0 / MAX(1, SUM(deaths)), 2) AS kda,
        ROUND( (SUM(win) * 100.0) / COUNT(*), 1) AS wr
      FROM matches
      WHERE gameCreation >= ?
      GROUP BY championName
      ORDER BY games DESC
      LIMIT ?
    `).all(since, limit);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Rank por PUUID (recomendado)
app.get('/api/rank/by-puuid/:puuid', async (req, res) => {
  try {
    const data = await riotFetch(
      `https://${'euw1'}.api.riotgames.com/lol/league/v4/entries/by-puuid/${req.params.puuid}`
    );
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Partidas guardadas (paginadas)
app.get("/api/db/matches/paged", (req, res) => {
  try {
    const days = Number(req.query.days || 5);
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(50, Math.max(5, Number(req.query.pageSize || 10)));

    const since = Date.now() - days * 24 * 60 * 60 * 1000;
    const offset = (page - 1) * pageSize;

    const totalRow = db.prepare(`
      SELECT COUNT(*) as total
      FROM matches
      WHERE gameCreation >= ?
    `).get(since);

    const rows = db.prepare(`
      SELECT matchId, championName, kills, deaths, assists, win, gameCreation
      FROM matches
      WHERE gameCreation >= ?
      ORDER BY gameCreation DESC
      LIMIT ? OFFSET ?
    `).all(since, pageSize, offset);

    const total = totalRow?.total || 0;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    res.json({
      page,
      pageSize,
      total,
      totalPages,
      rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.get("/api/db/last-sync", (req, res) => {
  try {
    const row = getMeta.get("last_sync");
    const lastSync = row ? Number(row.value) : null;
    res.json({ lastSync });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.listen(PORT, () => {
  console.log(`✅ Backend activo en http://localhost:${PORT}`);
});

