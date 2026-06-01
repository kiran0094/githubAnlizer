import Express from "express";
import type { Request, Response } from "express";
import { sql } from "../db";
import { fetchGitHubProfile } from "../services/githubService";

const AnalysisRoutes = Express.Router();

// Core Analysis Engine Logic shared between both routes
async function runProfileAnalysis(username: string) {
  let apiCallsCount = 1; // Tracks GitHub API overhead
  
  try {
    // 1. Fetch live data from GitHub API
    const ghData = await fetchGitHubProfile(username);

    // 2. Upsert into 'profiles' table
    // (Inserts if new, updates tracking timestamps if already exists)
    const profileResult = await sql`
      INSERT INTO profiles (
        github_username, github_user_id, display_name, avatar_url, bio, 
        location, company, blog_url, twitter_username, github_created_at, 
        first_analyzed_at, last_analyzed_at
      ) 
      VALUES (
        ${ghData.login}, ${ghData.id}, ${ghData.name}, ${ghData.avatar_url}, ${ghData.bio},
        ${ghData.location}, ${ghData.company}, ${ghData.blog}, ${ghData.twitter_username}, ${ghData.created_at},
        NOW(), NOW()
      )
      ON CONFLICT (github_user_id) DO UPDATE SET
        github_username = EXCLUDED.github_username,
        display_name = EXCLUDED.display_name,
        avatar_url = EXCLUDED.avatar_url,
        bio = EXCLUDED.bio,
        location = EXCLUDED.location,
        company = EXCLUDED.company,
        blog_url = EXCLUDED.blog_url,
        twitter_username = EXCLUDED.twitter_username,
        last_analyzed_at = NOW()
      RETURNING id;
    `;
    
    if (!profileResult[0]) {
      throw new Error("Failed to insert or retrieve profile");
    }
    
    const profileId = profileResult[0].id;

    // 3. Compute Metrics for 'profile_insights'
    const createdAtDate = new Date(ghData.created_at);
    const now = new Date();
    const accountAgeDays = Math.floor((now.getTime() - createdAtDate.getTime()) / (1000 * 60 * 60 * 24));
    const followerFollowingRatio = ghData.followers / Math.max(ghData.following, 1);

    // Mocking repository metrics summaries for this stage
    const topLanguages = JSON.stringify({ TypeScript: 70, JavaScript: 30 });
    const mostStarredRepo = "awesome-project";
    const mostStarredCount = 42;
    const avgStarsPerRepo = 3.5;
    const openIssuesTotal = 5;
    const hasHireableFlag = false;

    // 4. Insert into 'profile_insights'
    const insightResult = await sql`
      INSERT INTO profile_insights (
        profile_id, analyzed_at, public_repos, public_gists, followers, following,
        total_stars, total_forks, total_watchers, top_languages, most_starred_repo,
        most_starred_count, avg_stars_per_repo, open_issues_total, has_hireable_flag,
        account_age_days, follower_following_ratio
      )
      VALUES (
        ${profileId}, NOW(), ${ghData.public_repos}, ${ghData.public_gists}, ${ghData.followers}, ${ghData.following},
        42, 10, 15, ${topLanguages}, ${mostStarredRepo}, -- values based on mock repo metrics
        ${mostStarredCount}, ${avgStarsPerRepo}, ${openIssuesTotal}, ${hasHireableFlag},
        ${accountAgeDays}, ${followerFollowingRatio}
      )
      RETURNING *;
    `;

    const insightData = insightResult[0];
    
    if (!insightData) {
      throw new Error("Failed to insert or retrieve insight data");
    }

    // 5. Log Success in 'analysis_history'
    await sql`
      INSERT INTO analysis_history (profile_id, insight_id, status, github_api_calls, error_message)
      VALUES (${profileId}, ${insightData.id}, 'success', ${apiCallsCount}, NULL);
    `;

    return { status: 200, data: insightData };

  } catch (error: any) {
    console.error(`Analysis workflow crashed for ${username}:`, error);

    // Attempt to log the failure to analysis_history if we managed to resolve a profileId
    try {
      const profileSearch = await sql`SELECT id FROM profiles WHERE github_username = ${username}`;
      if (profileSearch.length > 0 && profileSearch[0]) {
        await sql`
          INSERT INTO analysis_history (profile_id, insight_id, status, github_api_calls, error_message)
          VALUES (${profileSearch[0].id}, NULL, 'failed', ${apiCallsCount}, ${error?.message || "Unknown error"});
        `;
      }
    } catch (logError) {
      console.error("Failed writing audit log to historical index:", logError);
    }

    return { status: 500, data: { error: "Analysis execution failed internally." } };
  }
}

// ==========================================
// ROUTES DEFINITIONS
// ==========================================

/**
 * POST /api/analyze/:username
 * Initial core run or checks if data is already pulled.
 */
AnalysisRoutes.post("/api/analyze/:username", async (req: Request, res: Response) => {
  const rawUsername = req.params.username;
  if (!rawUsername || Array.isArray(rawUsername)) {
    return res.status(400).json({ error: "Invalid username parameter" });
  }
  const username: string = rawUsername;

  try {
    // Optional architectural guard: Check if an analysis already exists to avoid redundant calls
    const existingProfile = await sql`
      SELECT p.id, i.id as insight_id 
      FROM profiles p 
      JOIN profile_insights i ON p.id = i.profile_id 
      WHERE p.github_username = ${username} 
      ORDER BY i.analyzed_at DESC LIMIT 1
    `;

    if (existingProfile.length > 0 && existingProfile[0]) {
      // Pull and return existing full insight row object
      const fullInsight = await sql`SELECT * FROM profile_insights WHERE id = ${existingProfile[0].insight_id}`;
      if (fullInsight[0]) {
        return res.status(200).json(fullInsight[0]);
      }
    }

    // Run deep analysis setup if no metrics are present
    const result = await runProfileAnalysis(username);
    return res.status(result.status).json(result.data);

  } catch (error) {
    return res.status(500).json({ error: "Server error encountered during router phase." });
  }
});


AnalysisRoutes.post("/api/analyze/:username/refresh", async (req: Request, res: Response) => {
  const rawUsername = req.params.username;
  if (!rawUsername || Array.isArray(rawUsername)) {
    return res.status(400).json({ error: "Invalid username parameter" });
  }
  const username: string = rawUsername;

  // Verify profile explicitly exists before running refreshing rules
  const profileCheck = await sql`SELECT id FROM profiles WHERE github_username = ${username}`;
  if (profileCheck.length === 0) {
    return res.status(404).json({ error: "Cannot refresh a profile that hasn't been analyzed initially." });
  }

  // Force system execution flow bypassing the storage lookup step
  const result = await runProfileAnalysis(username);
  return res.status(result.status).json(result.data);
});

export default AnalysisRoutes;