import Express, { Request, Response } from "express";
import { sql } from "../db";

const router = Express.Router();

/**
 * GET /api/profiles
 * Fetches paginated, sortable profiles along with their latest aggregate stats.
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    // 1. Extract query params and establish strict defaults
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit as string) || 10)); // Max cap at 100
    const offset = (page - 1) * limit;

    const validSortFields = ["followers", "stars", "repos", "analyzed_at"];
    const sort = validSortFields.includes(req.query.sort as string) ? (req.query.sort as string) : "analyzed_at";
    const order = req.query.order === "asc" ? "ASC" : "DESC";

    // Map query keywords to actual table column pathways
    const orderByMap: Record<string, string> = {
      followers: "i.followers",
      stars: "i.total_stars",
      repos: "i.public_repos",
      analyzed_at: "p.last_analyzed_at",
    };

    const targetOrderField = orderByMap[sort];

    // 2. Fetch the paginated dataset joining the most recent snapshot row
    // Note: We use dynamic string injection safely here because inputs are strictly checked against a whitelist.
    const profiles = await sql.unsafe(`
      SELECT DISTINCT ON (${targetOrderField}, p.id)
        p.id, p.github_username, p.display_name, p.avatar_url, p.last_analyzed_at,
        i.followers, i.total_stars, i.public_repos
      FROM profiles p
      LEFT JOIN profile_insights i ON p.id = i.profile_id
      ORDER BY ${targetOrderField} ${order}, p.id DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    // 3. Count total profiles in the collection for metadata tracking
    const countResult = await sql`SELECT COUNT(*) as total FROM profiles`;
    const totalRecords = parseInt(countResult[0]?.total ?? "0");

    res.status(200).json({
      metadata: {
        total_records: totalRecords,
        page,
        limit,
        total_pages: Math.ceil(totalRecords / limit),
      },
      data: profiles,
    });
  } catch (error) {
    console.error("Error fetching profiles list:", error);
    res.status(500).json({ error: "Failed to retrieve profiles." });
  }
});

/**
 * GET /api/profiles/:username
 * Fetch a specific profile compiled directly with its newest insights snapshot dataset.
 */
router.get("/:username", async (req: Request, res: Response) => {
  const { username } = req.params;

  try {
    const result = await sql`
      SELECT p.*, row_to_json(i.*) as latest_insight
      FROM profiles p
      LEFT JOIN LATERAL (
        SELECT * FROM profile_insights 
        WHERE profile_id = p.id 
        ORDER BY analyzed_at DESC 
        LIMIT 1
      ) i ON true
      WHERE p.github_username = ${username}
    `;

    if (result.length === 0) {
      return res.status(404).json({ error: `Profile '${username}' has not been analyzed yet.` });
    }

    res.status(200).json(result[0]);
  } catch (error) {
    console.error(`Error pulling specific baseline profile mapping for ${username}:`, error);
    res.status(500).json({ error: "Internal processing error." });
  }
});

/**
 * GET /api/profiles/:username/insights
 * Returns chronological insight snapshots of a user across time (ideal for graphing/charting metrics).
 */
router.get("/:username/insights", async (req: Request, res: Response) => {
  const { username } = req.params;

  try {
    const historicalSnapshots = await sql`
      SELECT i.* FROM profile_insights i
      JOIN profiles p ON i.profile_id = p.id
      WHERE p.github_username = ${username}
      ORDER BY i.analyzed_at ASC
    `;

    if (historicalSnapshots.length === 0) {
      // Check if profile even exists to distinguish between an empty database history vs missing profile
      const profileCheck = await sql`SELECT id FROM profiles WHERE github_username = ${username}`;
      if (profileCheck.length === 0) {
        return res.status(404).json({ error: `Profile '${username}' not found.` });
      }
    }

    res.status(200).json(historicalSnapshots);
  } catch (error) {
    console.error(`Error pulling insight timeline details for ${username}:`, error);
    res.status(500).json({ error: "Failed to fetch chronological engine metrics mapping." });
  }
});

/**
 * GET /api/profiles/:username/history
 * Fetches the complete internal execution audit trail (successes, crashes, rate-limiting limits).
 */
router.get("/:username/history", async (req: Request, res: Response) => {
  const { username } = req.params;

  try {
    const auditLogs = await sql`
      SELECT h.* FROM analysis_history h
      JOIN profiles p ON h.profile_id = p.id
      WHERE p.github_username = ${username}
      ORDER BY h.triggered_at DESC
    `;

    if (auditLogs.length === 0) {
      const profileCheck = await sql`SELECT id FROM profiles WHERE github_username = ${username}`;
      if (profileCheck.length === 0) {
        return res.status(404).json({ error: `Profile '${username}' not found.` });
      }
    }

    res.status(200).json(auditLogs);
  } catch (error) {
    console.error(`Error reading audit logs index list for ${username}:`, error);
    res.status(500).json({ error: "Failed to fetch historical log trails." });
  }
});

export default router;