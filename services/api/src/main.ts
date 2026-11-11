import "./instrument.js";
import "reflect-metadata";

import { AppConfig } from "./config/app-config.js";
import { createApp } from "./setup-app.js";

const { app } = await createApp();
await app.listen(app.get(AppConfig).env.API_PORT);
