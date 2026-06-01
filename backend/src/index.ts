import Express from "express";
import type { Request, Response } from "express";
import dotenv from "dotenv";
import helmet from "helmet";
import morgan from "morgan";
import { neon } from "@neondatabase/serverless";
import AnalysisRoutes from "./routes/serviceroutes";
import ProfileRoutes from "./routes/profileroutes";
import cors from "cors";

// Load environment variables
dotenv.config();

// Initialize Neon SQL client
// (The non-null assertion '!' tells TypeScript that DATABASE_URL will be defined)
const sql = neon(process.env.DATABASE_URL!);

const app = Express();

// Middleware

app.use(Express.json());
app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(AnalysisRoutes);
app.use("/api/profiles", ProfileRoutes);

// New Database Route
app.get("/db-version", async (req: Request, res: Response) => {
  try {
    // Execute the query using Neon
    const result = await sql`SELECT version()`;
    const { version } = result[0]||{};
    
    // Send the version back as plain text (or JSON if you prefer)
    res.status(200).send(version);
  } catch (error) {
    console.error("Database query failed:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});


function main() {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

main();