import { config } from "zod";

// Production CSP blocks dynamic code generation; avoid Zod's caught eval probe.
config({ jitless: true });
