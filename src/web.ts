import { loadConfig } from "./config.js";
import { startWebServer } from "./server.js";

const config = loadConfig();
startWebServer(config);
