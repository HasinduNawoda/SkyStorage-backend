import "dotenv/config";
import express from "express";
import { db } from "./db";

const app = express();

// A "health check" route. It doesn't do anything with a database or users
// yet — it just proves the server itself is alive and reachable. Load
// balancers and deploy platforms also ping routes like this to check if
// your app is still running, so it's worth having from day one.
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// Proves the server can actually reach the database, separately from the
// server just being "up". db.user.count() asks Postgres "how many rows are
// in the User table right now?" — 0 is a perfectly good answer, it just
// means the query succeeded.
app.get("/db-check", async (_req, res) => {
  try {
    const userCount = await db.user.count();
    res.json({ connected: true, userCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ connected: false, error: "Could not reach the database." });
  }
});

const port = 4000;
app.listen(port, () => {
  console.log(`skystorage-backend listening on http://localhost:${port}`);
});
