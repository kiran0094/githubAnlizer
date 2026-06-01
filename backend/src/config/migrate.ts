import { neon } from "@neondatabase/serverless";
import dotenv from "dotenv";

dotenv.config();

if (!process.env.DATABASE_URL) {
  console.error("Error: DATABASE_URL environment variable is missing.");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

async function runMigration() {
  console.log("Starting database migration...");

  try {
    
    await sql`
      DO $$ BEGIN
        CREATE TYPE analysis_status AS ENUM ('success', 'failed', 'rate_limited');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `;


    await sql`
      CREATE TABLE IF NOT EXISTS profiles (
        id BIGSERIAL PRIMARY KEY,
        github_username VARCHAR(39) NOT NULL UNIQUE,
        github_user_id BIGINT NOT NULL UNIQUE,
        display_name VARCHAR(255),
        avatar_url TEXT,
        bio TEXT,
        location VARCHAR(255),
        company VARCHAR(255),
        blog_url TEXT,
        twitter_username VARCHAR(50),
        github_created_at TIMESTAMPTZ,
        first_analyzed_at TIMESTAMPTZ,
        last_analyzed_at TIMESTAMPTZ
      );
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_profiles_username ON profiles(github_username);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_profiles_last_analyzed ON profiles(last_analyzed_at);`;

    
    await sql`
      CREATE TABLE IF NOT EXISTS profile_insights (
        id BIGSERIAL PRIMARY KEY,
        profile_id BIGINT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        analyzed_at TIMESTAMPTZ NOT NULL,
        public_repos INT NOT NULL DEFAULT 0,
        public_gists INT NOT NULL DEFAULT 0,
        followers INT NOT NULL DEFAULT 0,
        following INT NOT NULL DEFAULT 0,
        total_stars INT NOT NULL DEFAULT 0,
        total_forks INT NOT NULL DEFAULT 0,
        total_watchers INT NOT NULL DEFAULT 0,
        top_languages JSONB,
        most_starred_repo VARCHAR(100),
        most_starred_count INT NOT NULL DEFAULT 0,
        avg_stars_per_repo DECIMAL(8,2) NOT NULL DEFAULT 0.00,
        open_issues_total INT NOT NULL DEFAULT 0,
        has_hireable_flag BOOLEAN NOT NULL DEFAULT FALSE,
        account_age_days INT NOT NULL,
        follower_following_ratio DECIMAL(8,4) NOT NULL DEFAULT 0.0000
      );
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_insights_profile_id ON profile_insights(profile_id);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_insights_analyzed_at ON profile_insights(analyzed_at);`;

    
    await sql`
      CREATE TABLE IF NOT EXISTS analysis_history (
        id BIGSERIAL PRIMARY KEY,
        profile_id BIGINT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        insight_id BIGINT UNIQUE REFERENCES profile_insights(id) ON DELETE SET NULL,
        triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        status analysis_status NOT NULL,
        github_api_calls SMALLINT NOT NULL DEFAULT 0,
        error_message TEXT
      );
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_history_profile_id ON analysis_history(profile_id);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_history_triggered_at ON analysis_history(triggered_at);`;

    console.log(" Migration finished successfully!");
  } catch (error) {
    console.error(" Migration failed:", error);
  }
}

runMigration();