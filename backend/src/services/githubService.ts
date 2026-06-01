import dotenv from "dotenv";
dotenv.config();

export interface GitHubUserData {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string;
  bio: string | null;
  location: string | null;
  company: string | null;
  blog: string | null;
  twitter_username: string | null;
  created_at: string;
  public_repos: number;
  public_gists: number;
  followers: number;
  following: number;
  
  // Computed Insight Metrics populated from the repos endpoint
  total_stars: number;
  total_forks: number;
  total_watchers: number;
  top_languages: string; // JSON string encoded e.g. '{"TypeScript":60,"Go":30}'
  most_starred_repo: string | null;
  most_starred_count: number;
  avg_stars_per_repo: number;
  open_issues_total: number;
}

export async function fetchGitHubProfile(username: string): Promise<GitHubUserData> {
  const token = process.env.GITHUB_TOKEN;
  
  // Setup headers with token authorization
  const headers: HeadersInit = {
    "Accept": "application/vnd.github+json",
    "User-Agent": "Express-Neon-Insight-App", // GitHub strictly requires a User-Agent header
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  } else {
    console.warn("⚠️ Warning: GITHUB_TOKEN is not defined in .env. Running unauthenticated (Subject to strict rate limiting).");
  }

  // 1. Fetch both User Profile data and Repositories in parallel
  const [userResponse, reposResponse] = await Promise.all([
    fetch(`https://api.github.com/users/${username}`, { headers }),
    fetch(`https://api.github.com/users/${username}/repos?per_page=100&type=owner`, { headers })
  ]);

  if (userResponse.status === 404) {
    throw new Error(`GitHub user '${username}' not found.`);
  }

  if (!userResponse.ok || !reposResponse.ok) {
    throw new Error(`GitHub API Error: Profile Status ${userResponse.status}, Repos Status ${reposResponse.status}`);
  }

  const userData = await userResponse.json();
  const reposData = await reposResponse.json();

  // 2. Aggregate Repository Metrics
  let totalStars = 0;
  let totalForks = 0;
  let totalWatchers = 0;
  let openIssuesTotal = 0;
  let mostStarredRepo: string | null = null;
  let mostStarredCount = 0;
  
  const languageCounts: Record<string, number> = {};

  if (Array.isArray(reposData)) {
    reposData.forEach((repo: any) => {
      totalStars += repo.stargazers_count || 0;
      totalForks += repo.forks_count || 0;
      totalWatchers += repo.watchers_count || 0; // In GitHub REST v3, watchers_count matches stars
      openIssuesTotal += repo.open_issues_count || 0;

      // Track top starred repo
      if ((repo.stargazers_count || 0) >= mostStarredCount) {
        mostStarredCount = repo.stargazers_count;
        mostStarredRepo = repo.name;
      }

      // Track primary languages distributions
      if (repo.language) {
        languageCounts[repo.language] = (languageCounts[repo.language] || 0) + 1;
      }
    });
  }

  // Calculate percentage weight for languages
  const totalLangRepos = Object.values(languageCounts).reduce((a, b) => a + b, 0);
  const topLanguages: Record<string, number> = {};
  if (totalLangRepos > 0) {
    for (const [lang, count] of Object.entries(languageCounts)) {
      topLanguages[lang] = Math.round((count / totalLangRepos) * 100);
    }
  }

  const avgStarsPerRepo = userData.public_repos > 0 
    ? parseFloat((totalStars / userData.public_repos).toFixed(2)) 
    : 0;

  // 3. Merge profile and computed properties into our interface format
  return {
    id: userData.id,
    login: userData.login,
    name: userData.name,
    avatar_url: userData.avatar_url,
    bio: userData.bio,
    location: userData.location,
    company: userData.company,
    blog: userData.blog,
    twitter_username: userData.twitter_username,
    created_at: userData.created_at,
    public_repos: userData.public_repos,
    public_gists: userData.public_gists,
    followers: userData.followers,
    following: userData.following,
    
    // Derived values
    total_stars: totalStars,
    total_forks: totalForks,
    total_watchers: totalWatchers,
    top_languages: JSON.stringify(topLanguages),
    most_starred_repo: mostStarredRepo,
    most_starred_count: mostStarredCount,
    avg_stars_per_repo: avgStarsPerRepo,
    open_issues_total: openIssuesTotal,
  };
}