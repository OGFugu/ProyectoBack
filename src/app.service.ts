// Backend Node.js + Express para stats estilo OP.GG
// Requiere API Key de Riot Games

import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';


const app = express();
app.use(cors());

const RIOT_API_KEY = "RGAPI-a3dd8dbd-477b-43f7-aa61-d310bb8aaa10" // <-- pon aquí tu API KEY
const REGION = 'euw1';
const ROUTING = 'europe';
const SUMMONER_NAME = 'Peereira7';
const TAGLINE = 'CASTR';

// Helper Riot request
async function riotFetch(url) {
  const res = await fetch(url, {
    headers: { 'X-Riot-Token': RIOT_API_KEY }
  });
  if (!res.ok) throw new Error('Riot API error');
  return res.json();
}

// Obtener PUUID
app.get('/api/summoner', async (req, res) => {
  try {
    const data = await riotFetch(
      `https://${ROUTING}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${SUMMONER_NAME}/${TAGLINE}`
    );
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Rank actual
app.get('/api/rank/:summonerId', async (req, res) => {
  try {
    const data = await riotFetch(
      `https://${REGION}.api.riotgames.com/lol/league/v4/entries/by-summoner/${req.params.summonerId}`
    );
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Partidas recientes
app.get('/api/matches/:puuid', async (req, res) => {
  try {
    const matches = await riotFetch(
      `https://${ROUTING}.api.riotgames.com/lol/match/v5/matches/by-puuid/${req.params.puuid}/ids?count=20`
    );
    res.json(matches);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Stats de una partida
app.get('/api/match/:matchId', async (req, res) => {
  try {
    const match = await riotFetch(
      `https://${ROUTING}.api.riotgames.com/lol/match/v5/matches/${req.params.matchId}`
    );
    res.json(match);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(3001, () => console.log('Backend activo en http://localhost:3001'));
