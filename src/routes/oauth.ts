import { Router, Request, Response } from "express";
import { db } from "../db";
import { requireAuth } from "../middleware/requireAuth";

export const oauthRouter = Router();

// ============================================================================
// GOOGLE OAUTH
// ============================================================================

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const GOOGLE_REDIRECT_URI = `${process.env.VITE_API_URL || "http://localhost:4000"}/oauth/google/callback`;

oauthRouter.get("/google/connect", requireAuth, (req: Request, res: Response) => {
  const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${GOOGLE_CLIENT_ID}&redirect_uri=${encodeURIComponent(GOOGLE_REDIRECT_URI)}&response_type=code&scope=email profile&access_type=offline`;
  res.redirect(url);
});

oauthRouter.get("/google/callback", requireAuth, async (req: Request, res: Response) => {
  const code = req.query.code as string;
  const frontendOrigin = process.env.FRONTEND_ORIGIN || "http://localhost:5173";
  
  if (!code) return res.redirect(`${frontendOrigin}/?error=NoCode`);

  try {
    // 1. Exchange code for access token
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: GOOGLE_REDIRECT_URI,
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw new Error("No access token from Google");

    // 2. Fetch user profile
    const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const userData = await userRes.json();
    if (!userData.id) throw new Error("No user id from Google");

    // 3. Check if this Google ID is already linked to another account
    const existing = await db.user.findUnique({ where: { googleId: userData.id } });
    if (existing && existing.id !== req.userId) {
      return res.redirect(`${frontendOrigin}/?error=GoogleAccountAlreadyLinked`);
    }

    // 4. Link to current user
    await db.user.update({
      where: { id: req.userId },
      data: { googleId: userData.id },
    });

    res.redirect(`${frontendOrigin}/`); // Redirect back to frontend
  } catch (err) {
    console.error("Google OAuth Error:", err);
    res.redirect(`${frontendOrigin}/?error=OAuthFailed`);
  }
});

oauthRouter.delete("/google/disconnect", requireAuth, async (req: Request, res: Response) => {
  try {
    await db.user.update({
      where: { id: req.userId },
      data: { googleId: null },
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to disconnect" });
  }
});

// ============================================================================
// GITHUB OAUTH
// ============================================================================

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || "";
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || "";
const GITHUB_REDIRECT_URI = `${process.env.VITE_API_URL || "http://localhost:4000"}/oauth/github/callback`;

oauthRouter.get("/github/connect", requireAuth, (req: Request, res: Response) => {
  const url = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(GITHUB_REDIRECT_URI)}&scope=read:user user:email`;
  res.redirect(url);
});

oauthRouter.get("/github/callback", requireAuth, async (req: Request, res: Response) => {
  const code = req.query.code as string;
  const frontendOrigin = process.env.FRONTEND_ORIGIN || "http://localhost:5173";
  
  if (!code) return res.redirect(`${frontendOrigin}/?error=NoCode`);

  try {
    // 1. Exchange code for access token
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: GITHUB_REDIRECT_URI,
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw new Error("No access token from GitHub");

    // 2. Fetch user profile
    const userRes = await fetch("https://api.github.com/user", {
      headers: { 
        Authorization: `Bearer ${tokenData.access_token}`,
        "Accept": "application/json",
        "User-Agent": "SkyStorage-App"
      },
    });
    const userData = await userRes.json();
    const githubIdStr = userData.id.toString();
    if (!githubIdStr) throw new Error("No user id from GitHub");

    // 3. Check if this GitHub ID is already linked to another account
    const existing = await db.user.findUnique({ where: { githubId: githubIdStr } });
    if (existing && existing.id !== req.userId) {
      return res.redirect(`${frontendOrigin}/?error=GitHubAccountAlreadyLinked`);
    }

    // 4. Link to current user
    await db.user.update({
      where: { id: req.userId },
      data: { githubId: githubIdStr },
    });

    res.redirect(`${frontendOrigin}/`); // Redirect back to frontend
  } catch (err) {
    console.error("GitHub OAuth Error:", err);
    res.redirect(`${frontendOrigin}/?error=OAuthFailed`);
  }
});

oauthRouter.delete("/github/disconnect", requireAuth, async (req: Request, res: Response) => {
  try {
    await db.user.update({
      where: { id: req.userId },
      data: { githubId: null },
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to disconnect" });
  }
});
