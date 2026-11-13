import { buildApp } from "./app";

const port = Number(process.env.PORT ?? 8080);
const { app } = await buildApp({ dbPath: process.env.DB_PATH ?? "traffic.db", logger: true });
await app.listen({ port, host: "0.0.0.0" });
