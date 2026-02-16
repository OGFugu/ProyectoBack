import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';
import path from "path";
import { fileURLToPath } from "url";

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
const RIOT_API_KEY = 'RGAPI-eb3e9f3d-dcfa-46b3-89db-cc2ac5de5ed4' // obligatoria
const REGION = 'euw1'
const ROUTING = 'europe';

// Cuenta fija (tu cuenta)
const RIOT_ID = {
  gameName: 'Peereira7',
  tagLine: 'CASTR'
};

// ================= HELPERS =================
async function riotFetch(url) {
  const res = await fetch(url, {
    headers: {
      'X-Riot-Token': RIOT_API_KEY
    }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text);
  }

  return res.json();
}

// ================= ROUTES =================

// 1️⃣ Obtener cuenta + PUUID
app.get('/api/summoner', async (req, res) => {
  try {
    const account = await riotFetch(
      `https://${ROUTING}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${RIOT_ID.gameName}/${RIOT_ID.tagLine}`
    );
    res.json(account);
  } catch (err) {
    res.status(500).json({ error: err.message });
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

    const matchIds = await riotFetch(
      `https://${ROUTING}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?count=${count}`
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
app.listen(PORT, () => {
  console.log(`✅ Backend activo en http://localhost:${PORT}`);
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
