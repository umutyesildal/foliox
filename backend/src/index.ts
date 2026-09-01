import { createHandler } from "./api/server.js";
import http from "http";

const port = Number(process.env.PORT || 3001);
const handler = createHandler();
http.createServer(handler).listen(port, () => {
  console.log(`FolioX backend (API+indexer stub) listening on :${port}`);
  console.log(` - GET  /api/v1/baskets`);
  console.log(` - POST /api/v1/quotes/zap-in`);
  console.log(` - GET  /api/v1/health`);
  console.log(`Indexer, NAV, fee crank workers are stubs — wire via BullMQ + pg + redis when DATABASE_URL is set.`);
});
