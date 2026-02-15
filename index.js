import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

// ================= CONFIG =================
const PORT = 3001;
const RIOT_API_KEY = 'RGAPI-cc178d29-148f-468e-9c50-9c0311a7d179' // obligatoria
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
