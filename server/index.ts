import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { startNotificationScheduler } from "./notifications";
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Simple logger for all environments
const log = console.log;

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;
  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };
  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }
      log(logLine);
    }
  });
  next();
});

(async () => {
  const server = await registerRoutes(app);
  
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    res.status(status).json({ message });
    log(`Error: ${message}`);
  });

  // Use environment variable PORT or default to 5000
  const PORT = process.env.PORT || 5000;
  
  server.listen(PORT, () => {
    log(`🚀 Server running on port ${PORT}`);
    log(`📍 API available at: http://localhost:${PORT}/api`);

    // Start notification scheduler
  startNotificationScheduler();  // ← ADD THIS
  log(`🔔 Notification scheduler started`);
  });
})();
