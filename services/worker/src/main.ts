import "./instrument.js";
import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";

import { WorkerModule } from "./worker.module.js";

// No HTTP server: an application context that runs the BullMQ processors.
// SIGTERM lets active jobs finish before the process exits.
const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
app.useLogger(app.get(Logger));
app.enableShutdownHooks();
