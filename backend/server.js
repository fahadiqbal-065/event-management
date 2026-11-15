const express = require('express');
const { Pool } = require('pg');

const app = express();
app.use(express.json());

const pool = new Pool({
  host: process.env.DB_HOST || 'db',
  port: 5432,
  user: process.env.DB_USER || 'eventuser',
  password: process.env.DB_PASSWORD || 'eventpass',
  database: process.env.DB_NAME || 'eventsdb',
});

const PORT = process.env.PORT || 5000;
let dbReady = false;

const SEED_EVENTS = [
  ['Hackathon 24h', 'Tech', 'CS Lab', '2026-12-02'],
  ['Football Match', 'Sports', 'Main Ground', '2026-12-03'],
  ['Debate Competition', 'Literary', 'Seminar Hall', '2026-12-04'],
  ['Photography Workshop', 'Workshop', 'Media Room', '2026-12-05'],
  ['Quiz Night', 'General', 'Auditorium', '2026-12-06'],
  ['Music Evening', 'Cultural', 'Open Stage', '2026-12-07'],
];

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS events (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      venue TEXT NOT NULL,
      event_date DATE NOT NULL
    )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS registrations (
      id SERIAL PRIMARY KEY,
      event_id INTEGER NOT NULL REFERENCES events(id),
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      team TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM events');
  if (rows[0].n === 0) {
    for (const e of SEED_EVENTS) {
      await pool.query(
        'INSERT INTO events (title, category, venue, event_date) VALUES ($1,$2,$3,$4)',
        e
      );
    }
    console.log('Seeded sample events');
  }
}

// Keep trying until the database container is ready
async function connectWithRetry() {
  try {
    await pool.query('SELECT 1');
    await initDb();
    dbReady = true;
    console.log('Connected to PostgreSQL');
  } catch (err) {
    console.log('Database not ready, retrying in 3 seconds...', err.message);
    setTimeout(connectWithRetry, 3000);
  }
}
connectWithRetry();

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', database: dbReady ? 'connected' : 'connecting' });
});

app.get('/api/events', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, title, category, venue, to_char(event_date, 'DD Mon YYYY') AS date
       FROM events ORDER BY event_date, id`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Could not load events' });
  }
});

app.post('/api/register', async (req, res) => {
  const { event_id, name, email, team } = req.body || {};
  if (!event_id || !name || !name.trim() || !email || !/^\S+@\S+\.\S+$/.test(email)) {
    return res.status(400).json({ error: 'Choose an event and enter your name and a valid email.' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO registrations (event_id, name, email, team)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [event_id, name.trim(), email.trim(), (team || '').trim() || null]
    );
    res.status(201).json({ id: rows[0].id });
  } catch (err) {
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

app.get('/api/registrations', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.id, r.name, r.team, e.title AS event
       FROM registrations r JOIN events e ON e.id = r.event_id
       ORDER BY r.created_at DESC, r.id DESC LIMIT 10`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Could not load registrations' });
  }
});

app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
