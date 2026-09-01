import { Router, Request, Response } from "express";
import { db } from "../db";
import { requireAuth } from "../middleware/requireAuth";
import { deleteObject } from "../utils/storage";

export const deepCleanRouter = Router();
deepCleanRouter.use(requireAuth);

deepCleanRouter.get("/scan", async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    
    // 1. Empty Folders
    const emptyFolders = await db.folder.findMany({
      where: { ownerId: userId, deletedAt: null, files: { none: {} }, children: { none: {} } },
      select: { id: true }
    });

    // 2. Large Unused Files ( > 50MB, not updated in 90 days )
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const largeFiles = await db.file.findMany({
      where: { ownerId: userId, deletedAt: null, sizeBytes: { gt: 50 * 1024 * 1024 }, updatedAt: { lt: ninetyDaysAgo } },
      select: { id: true, sizeBytes: true }
    });

    // 3. Old Recycle Bin ( deleted > 30 days ago )
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const oldDeletedFiles = await db.file.findMany({
      where: { ownerId: userId, deletedAt: { lt: thirtyDaysAgo } },
      select: { id: true, sizeBytes: true }
    });
    const oldDeletedFolders = await db.folder.findMany({
      where: { ownerId: userId, deletedAt: { lt: thirtyDaysAgo } },
      select: { id: true }
    });

    // 4. Junk & Temp files
    const junkFiles = await db.file.findMany({
      where: { 
        ownerId: userId, 
        deletedAt: null,
        OR: [
          { name: { endsWith: ".tmp" } },
          { name: { endsWith: ".log" } },
          { name: { endsWith: ".bak" } },
          { name: { endsWith: ".cache" } },
          { name: { equals: ".DS_Store" } }
        ]
      },
      select: { id: true, sizeBytes: true }
    });

    // 5. Stale Shared Links ( > 90 days old )
    const staleShares = await db.share.findMany({
      where: { ownerId: userId, createdAt: { lt: ninetyDaysAgo } },
      select: { id: true }
    });

    res.json({
      empty: { count: emptyFolders.length, bytes: 0, items: emptyFolders.map(f => f.id) },
      large: { count: largeFiles.length, bytes: largeFiles.reduce((acc, f) => acc + f.sizeBytes, 0), items: largeFiles.map(f => f.id) },
      recycle: { count: oldDeletedFiles.length + oldDeletedFolders.length, bytes: oldDeletedFiles.reduce((acc, f) => acc + f.sizeBytes, 0), items: { files: oldDeletedFiles.map(f => f.id), folders: oldDeletedFolders.map(f => f.id) } },
      junk: { count: junkFiles.length, bytes: junkFiles.reduce((acc, f) => acc + f.sizeBytes, 0), items: junkFiles.map(f => f.id) },
      stale: { count: staleShares.length, bytes: 0, items: staleShares.map(s => s.id) }
    });
  } catch (err) {
    console.error("Scan error:", err);
    res.status(500).json({ error: "Scan failed" });
  }
});

deepCleanRouter.post("/clean", async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const { category, items } = req.body; // items is the payload returned by scan

    if (category === "empty") {
      await db.folder.deleteMany({ where: { id: { in: items }, ownerId: userId } });
    } else if (category === "large" || category === "junk") {
      const files = await db.file.findMany({ where: { id: { in: items }, ownerId: userId } });
      for (const f of files) {
        if (f.storageKey) {
          try { await deleteObject(f.storageKey); } catch (e) { console.error("Failed to delete storage obj", e); }
        }
      }
      await db.file.deleteMany({ where: { id: { in: items }, ownerId: userId } });
    } else if (category === "recycle") {
      const files = await db.file.findMany({ where: { id: { in: items.files }, ownerId: userId } });
      for (const f of files) {
        if (f.storageKey) {
          try { await deleteObject(f.storageKey); } catch (e) { console.error("Failed to delete storage obj", e); }
        }
      }
      await db.file.deleteMany({ where: { id: { in: items.files }, ownerId: userId } });
      await db.folder.deleteMany({ where: { id: { in: items.folders }, ownerId: userId } });
    } else if (category === "stale") {
      await db.share.deleteMany({ where: { id: { in: items }, ownerId: userId } });
    } else {
      return res.status(400).json({ error: "Unknown category" });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Clean error:", err);
    res.status(500).json({ error: "Clean failed" });
  }
});
