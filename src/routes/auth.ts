import { Router, Request, Response } from "express";
import bcrypt from "bcrypt";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { db } from "../db";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  hashToken,
  REFRESH_TOKEN_TTL_MS,
} from "../utils/jwt";
import { requireAuth } from "../middleware/requireAuth";

export const authRouter = Router();

const isProd = process.env.NODE_ENV === "production";

const cookieOptions = {
  httpOnly: true,
  secure: isProd,
  sameSite: "lax" as const,
  path: "/",
};

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Please try again later." },
});

const signupSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email().max(255),
  password: z.string().min(10).max(200),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

function parseUserAgent(ua: string = "") {
  let browser = "Unknown Browser";
  let device = "Desktop";
  
  if (ua.includes("Firefox")) browser = "Firefox";
  else if (ua.includes("Chrome")) browser = "Chrome";
  else if (ua.includes("Safari") && !ua.includes("Chrome")) browser = "Safari";
  else if (ua.includes("Edge")) browser = "Edge";
  
  if (ua.includes("Mobi") || ua.includes("Android") || ua.includes("iPhone")) {
    device = "Mobile";
  } else if (ua.includes("Mac OS")) {
    device = "Mac";
  } else if (ua.includes("Windows")) {
    device = "Windows";
  } else if (ua.includes("Linux")) {
    device = "Linux";
  }
  
  return { browser, device };
}

async function issueSession(req: Request, res: Response, userId: string) {
  const accessToken = signAccessToken(userId);
  const refreshToken = signRefreshToken(userId);
  
  const uaString = req.headers["user-agent"] || "";
  const { browser, device } = parseUserAgent(uaString);
  const ipAddress = req.ip || req.connection?.remoteAddress || "Unknown IP";

  await db.refreshToken.create({
    data: {
      tokenHash: hashToken(refreshToken),
      userId,
      device,
      browser,
      ipAddress,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    },
  });

  res.cookie("accessToken", accessToken, { ...cookieOptions, maxAge: 15 * 60 * 1000 });
  res.cookie("refreshToken", refreshToken, { ...cookieOptions, maxAge: REFRESH_TOKEN_TTL_MS });
}

// Every route below is wrapped in try/catch. Without this, an async route
// handler that throws (e.g. the database being briefly unreachable) becomes
// an *unhandled promise rejection* — and since Node 15+, that crashes the
// entire process, not just that one request. Catching it here means a
// transient DB hiccup returns a 500 to that one caller instead of taking
// the whole server down.

authRouter.post("/signup", authLimiter, async (req: Request, res: Response) => {
  try {
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid input.", details: parsed.error.flatten() });
    }
    const { name, email, password } = parsed.data;

    const existing = await db.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: "An account with that email already exists." });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await db.user.create({ data: { name, email, passwordHash } });

    await issueSession(req, res, user.id);
    res.status(201).json({ id: user.id, name: user.name, email: user.email });
  } catch (err) {
    console.error("signup error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

authRouter.post("/login", authLimiter, async (req: Request, res: Response) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid input." });
    }
    const { email, password } = parsed.data;

    const user = await db.user.findUnique({ where: { email } });
    const invalid = () => res.status(401).json({ error: "Incorrect email or password." });

    if (!user) return invalid();
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return invalid();

    await issueSession(req, res, user.id);
    res.json({ id: user.id, name: user.name, email: user.email });
  } catch (err) {
    console.error("login error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

authRouter.post("/refresh", async (req: Request, res: Response) => {
  try {
    const token = req.cookies?.refreshToken;
    if (!token) return res.status(401).json({ error: "Not authenticated." });

    let payload;
    try {
      payload = verifyRefreshToken(token);
    } catch {
      return res.status(401).json({ error: "Session expired, please log in again." });
    }

    const tokenHash = hashToken(token);
    const stored = await db.refreshToken.findUnique({ where: { tokenHash } });

    if (!stored || stored.revoked || stored.expiresAt < new Date()) {
      return res.status(401).json({ error: "Session expired, please log in again." });
    }

    await db.refreshToken.update({ where: { id: stored.id }, data: { revoked: true } });
    await issueSession(req, res, payload.sub);

    res.json({ ok: true });
  } catch (err) {
    console.error("refresh error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

authRouter.get("/me", requireAuth, async (req: Request, res: Response) => {
  try {
    const user = await db.user.findUnique({
      where: { id: req.userId },
      select: { id: true, name: true, email: true },
    });
    if (!user) return res.status(404).json({ error: "User not found." });
    res.json(user);
  } catch (err) {
    console.error("me error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

authRouter.post("/logout", async (req: Request, res: Response) => {
  try {
    const token = req.cookies?.refreshToken;
    if (token) {
      await db.refreshToken.updateMany({
        where: { tokenHash: hashToken(token) },
        data: { revoked: true },
      });
    }
    res.clearCookie("accessToken", cookieOptions);
    res.clearCookie("refreshToken", cookieOptions);
    res.json({ ok: true });
  } catch (err) {
    console.error("logout error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});