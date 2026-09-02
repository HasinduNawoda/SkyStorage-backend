import { Router, Request, Response } from "express";
import { z } from "zod";
import { db } from "../db";
import { requireAuth } from "../middleware/requireAuth";
import { deleteObject, uploadObject, getDownloadUrl } from "../utils/storage";

export const usersRouter = Router();

// Retrieve full user profile
usersRouter.get("/me", requireAuth, async (req: Request, res: Response) => {
  try {
    const user = await db.user.findUnique({
      where: { id: req.userId },
      select: {
        id: true,
        name: true,
        displayName: true,
        email: true,
        phoneNumber: true,
        profilePhoto: true,
        googleId: true,
        githubId: true,
        createdAt: true,
      },
    });
    if (!user) return res.status(404).json({ error: "User not found" });

    let profilePhotoUrl = null;
    if (user.profilePhoto) {
      try { profilePhotoUrl = await getDownloadUrl(user.profilePhoto); } 
      catch (e) { console.error("Failed to get profile photo url", e); }
    }

    res.json({ ...user, profilePhoto: profilePhotoUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

const updateProfileSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  displayName: z.string().trim().max(100).nullable().optional(),
  email: z.string().trim().toLowerCase().email().max(255).optional(),
  phoneNumber: z.string().trim().max(50).nullable().optional(),
});

// Update profile text fields
usersRouter.put("/profile", requireAuth, async (req: Request, res: Response) => {
  try {
    const parsed = updateProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    }
    
    if (parsed.data.email) {
      const existing = await db.user.findUnique({ where: { email: parsed.data.email } });
      if (existing && existing.id !== req.userId) {
        return res.status(409).json({ error: "Email is already in use by another account." });
      }
    }

    const updatedUser = await db.user.update({
      where: { id: req.userId },
      data: parsed.data,
      select: {
        id: true,
        name: true,
        displayName: true,
        email: true,
        phoneNumber: true,
        profilePhoto: true,
      },
    });

    let profilePhotoUrl = null;
    if (updatedUser.profilePhoto) {
      try { profilePhotoUrl = await getDownloadUrl(updatedUser.profilePhoto); } 
      catch (e) {}
    }

    res.json({ ...updatedUser, profilePhoto: profilePhotoUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Upload profile photo
usersRouter.put("/profile-photo", requireAuth, async (req: Request, res: Response) => {
  try {
    const body = req.body as Buffer;
    if (!body || !body.length) return res.status(400).json({ error: "Empty body" });

    const mimeType = req.headers["x-mime-type"] as string || "image/jpeg";
    const storageKey = `profile-photos/${req.userId}-${Date.now()}`;

    // If user already had a photo, delete the old one to save space
    const existingUser = await db.user.findUnique({ where: { id: req.userId }, select: { profilePhoto: true } });
    if (existingUser?.profilePhoto) {
      await deleteObject(existingUser.profilePhoto).catch(() => {});
    }

    await uploadObject(storageKey, body, mimeType);

    await db.user.update({
      where: { id: req.userId },
      data: { profilePhoto: storageKey },
    });

    const url = await getDownloadUrl(storageKey);
    res.json({ profilePhoto: url });
  } catch (err) {
    console.error("profile photo upload error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Remove profile photo
usersRouter.delete("/profile-photo", requireAuth, async (req: Request, res: Response) => {
  try {
    const existingUser = await db.user.findUnique({ where: { id: req.userId }, select: { profilePhoto: true } });
    if (existingUser?.profilePhoto) {
      await deleteObject(existingUser.profilePhoto).catch(() => {});
    }

    await db.user.update({
      where: { id: req.userId },
      data: { profilePhoto: null },
    });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get active sessions
usersRouter.get("/sessions", requireAuth, async (req: Request, res: Response) => {
  try {
    const sessions = await db.refreshToken.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: "desc" },
    });
    
    const currentTokenHash = req.cookies.refreshToken 
      ? require("crypto").createHash("sha256").update(req.cookies.refreshToken).digest("hex")
      : null;

    const formattedSessions = sessions.map((s) => ({
      id: s.id,
      device: s.device || "Unknown Device",
      browser: s.browser || "Unknown Browser",
      location: s.location || "Unknown Location",
      ipAddress: s.ipAddress,
      time: s.createdAt,
      current: currentTokenHash === s.tokenHash,
    }));

    res.json(formattedSessions);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Revoke a specific session
usersRouter.delete("/sessions/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const session = await db.refreshToken.findUnique({ where: { id } });
    
    if (!session || session.userId !== req.userId) {
      return res.status(404).json({ error: "Session not found" });
    }

    await db.refreshToken.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Revoke all OTHER sessions
usersRouter.delete("/sessions", requireAuth, async (req: Request, res: Response) => {
  try {
    const currentTokenHash = req.cookies.refreshToken 
      ? require("crypto").createHash("sha256").update(req.cookies.refreshToken).digest("hex")
      : null;

    if (currentTokenHash) {
      await db.refreshToken.deleteMany({
        where: {
          userId: req.userId,
          tokenHash: { not: currentTokenHash },
        },
      });
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Danger Zone: Delete Account
usersRouter.delete("/me", requireAuth, async (req: Request, res: Response) => {
  try {
    const userFiles = await db.file.findMany({
      where: { ownerId: req.userId, storageKey: { not: null } },
    });

    for (const file of userFiles) {
      if (file.storageKey) {
        await deleteObject(file.storageKey).catch(err => {
          console.error(`Failed to delete S3 object ${file.storageKey}`, err);
        });
      }
    }

    await db.user.delete({ where: { id: req.userId } });

    res.clearCookie("accessToken");
    res.clearCookie("refreshToken");
    
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});
