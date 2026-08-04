import "dotenv/config";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { db } from "./db";
import { authRouter } from "./routes/auth";
import { foldersRouter } from "./routes/folders";

const app = express();

app.use(helmet());

app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN,
    credentials: true,
  })
);

app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

app.use(
  rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
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

const port = Number(process.env.PORT) || 4000;
app.listen(port, () => {
  console.log(`skystorage-backend listening on http://localhost:${port}`);
});