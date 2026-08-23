import "dotenv/config";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { db } from "./db";
import { authRouter } from "./routes/auth";
import { foldersRouter } from "./routes/folders";
import { filesRouter } from "./routes/files";
import { sharesRouter } from "./routes/shares";

const app = express();

app.use(helmet());

app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN || "http://localhost:5173",
    credentials: true,
  })
);

app.use(express.json({ limit: "1mb" }));
// Binary body parser for file-upload proxy route (50 MB cap).
// Must come AFTER express.json so JSON routes still work — express.raw
// only fires when Content-Type matches the `type` option.
app.use(express.raw({ type: "application/octet-stream", limit: "50mb" }));
app.use(cookieParser());

app.use(
  rateLimit({
    windowMs: 60 * 1000,
    limit: 200, // bumped from 120 — folder uploads fire many requests at once
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/db-check", async (_req, res) => {
  try {
    const userCount = await db.user.count();
    res.json({ connected: true, userCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ connected: false, error: "Could not reach the database." });
  }
});

app.use("/auth", authRouter);
app.use("/folders", foldersRouter);
app.use("/files", filesRouter);
app.use("/shares", sharesRouter);

const port = Number(process.env.PORT) || 4000;
app.listen(port, () => {
  console.log(`skystorage-backend listening on http://localhost:${port}`);
});