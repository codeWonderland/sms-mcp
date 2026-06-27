#!/usr/bin/env node
import { randomBytes } from "node:crypto";

/** Print a 32-byte URL-safe random bearer token. */
const token = randomBytes(32).toString("base64url");
process.stdout.write(token + "\n");
