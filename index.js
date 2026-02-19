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

  const text = await res.text();

  try {
    return JSON.parse(text);
  } catch {
    console.error("RIOT NO JSON:", text);
    throw new Error("Riot devolvió algo no válido (API key caducada?)");
  }
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
    const MAX_MATCHES = 50;

    const account = await riotFetch(
      `https://${ROUTING}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${RIOT_ID.gameName}/${RIOT_ID.tagLine}`
    );

    const puuid = account.puuid;

    // ✅ Solo 1 llamada: últimas 50 partidas
    const matchIds = await riotFetchWithRetry(
      `https://${ROUTING}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?start=0&count=${MAX_MATCHES}`
    );

    let saved = 0;

    for (const id of matchIds) {
      const exists = db
        .prepare("SELECT 1 FROM matches WHERE matchId = ? AND puuid = ?")
        .get(id, puuid);

      if (exists) continue;

      const match = await riotFetchWithRetry(
        `https://${ROUTING}.api.riotgames.com/lol/match/v5/matches/${id}`
      );

      saveMatchToDb({ matchId: id, puuid, matchJson: match });
      saved++;

      await sleep(350);
    }

    setMeta.run("last_sync", String(Date.now()));

    res.json({
      ok: true,
      fetched: matchIds.length,
      saved
    });
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
// TOP campeones basado en las ÚLTIMAS N partidas guardadas (no por días)
app.get("/api/db/champions", (req, res) => {
  try {
    const limit = Math.min(20, Math.max(1, Number(req.query.limit || 5)));
    const last = Math.min(200, Math.max(1, Number(req.query.last || 50))); // por defecto 50

    const rows = db.prepare(`
      WITH recent AS (
        SELECT *
        FROM matches
        ORDER BY gameCreation DESC
        LIMIT ?
      )
      SELECT
        championName,
        COUNT(*) AS games,
        SUM(win) AS wins,
        (COUNT(*) - SUM(win)) AS losses,
        ROUND( (SUM(kills) + SUM(assists)) * 1.0 / MAX(1, SUM(deaths)), 2) AS kda,
        ROUND( (SUM(win) * 100.0) / COUNT(*), 1) AS wr
      FROM recent
      GROUP BY championName
      ORDER BY games DESC
      LIMIT ?
    `).all(last, limit);

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
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(50, Math.max(5, Number(req.query.pageSize || 5)));
    const offset = (page - 1) * pageSize;

    const totalRow = db.prepare(`SELECT COUNT(*) AS total FROM matches`).get();

    const rows = db.prepare(`
      SELECT matchId, championName, kills, deaths, assists, win, gameCreation
      FROM matches
      ORDER BY gameCreation DESC
      LIMIT ? OFFSET ?
    `).all(pageSize, offset);

    const total = totalRow?.total || 0;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    res.json({ page, pageSize, total, totalPages, rows });
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

// RESUMEN: media de los 5 campeones más jugados (sobre las 50 partidas guardadas)
app.get("/api/db/top5-summary", (req, res) => {
  try {
    // Sacamos los 5 campeones con más partidas dentro de las 50 últimas guardadas
    const top5 = db.prepare(`
      WITH last50 AS (
        SELECT *
        FROM matches
        ORDER BY gameCreation DESC
        LIMIT 50
      )
      SELECT
        championName,
        COUNT(*) AS games,
        SUM(win) AS wins,
        (COUNT(*) - SUM(win)) AS losses,
        SUM(kills) AS kills,
        SUM(deaths) AS deaths,
        SUM(assists) AS assists
      FROM last50
      GROUP BY championName
      ORDER BY games DESC
      LIMIT 5
    `).all();

    if (!top5.length) {
      return res.json({ ok: true, totalGames: 0 });
    }

    // Totales combinados de esos 5 campeones
    const totalGames = top5.reduce((acc, c) => acc + c.games, 0);
    const totalWins  = top5.reduce((acc, c) => acc + c.wins, 0);
    const totalLosses= top5.reduce((acc, c) => acc + c.losses, 0);
    const totalKills = top5.reduce((acc, c) => acc + c.kills, 0);
    const totalDeaths= top5.reduce((acc, c) => acc + c.deaths, 0);
    const totalAssists=top5.reduce((acc, c) => acc + c.assists, 0);

    const kda = (totalKills + totalAssists) / Math.max(1, totalDeaths);
    const wr = totalGames ? (totalWins * 100) / totalGames : 0;

    res.json({
      ok: true,
      totalGames,
      wins: totalWins,
      losses: totalLosses,
      wr: Number(wr.toFixed(1)),
      kda: Number(kda.toFixed(2)),
      top5 // por si quieres mostrar nombres también
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.listen(PORT, () => {
  console.log(`✅ Backend activo en http://localhost:${PORT}`);
});


