import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { initSocketServer } from "./src/lib/realtime/socket";
import { logger } from "./src/lib/logger";

const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT ?? "3000", 10);

// Catch any unhandled promise rejections and log them before exit
// so Railway's build/deploy logs show the root cause.
process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "server: unhandled rejection");
  process.exit(1);
});

process.on("uncaughtException", (err) => {
  logger.error({ err }, "server: uncaught exception");
  process.exit(1);
});

logger.info({ dev, port }, "server: initialising Next.js");

const app = next({ dev });
const handle = app.getRequestHandler();

app
  .prepare()
  .then(() => {
    logger.info("server: Next.js ready, attaching Socket.IO");

    const httpServer = createServer((req, res) => {
      const parsedUrl = parse(req.url!, true);
      handle(req, res, parsedUrl);
    });

    initSocketServer(httpServer);

    httpServer.listen(port, () => {
      logger.info({ port }, "server: listening");
    });
  })
  .catch((err: unknown) => {
    logger.error({ err }, "server: startup failed — exiting");
    process.exit(1);
  });
