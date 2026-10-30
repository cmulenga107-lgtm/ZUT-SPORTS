import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";

const scrypt = promisify(scryptCallback);
const projectRoot = dirname(fileURLToPath(import.meta.url));
const sessionCookieName = "zut_session";
const sessionLifetimeMs = 7 * 24 * 60 * 60 * 1000;
const passwordKeyLength = 64;
const passwordOptions = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".webp", "image/webp"]
]);

const securityHeaders = {
  "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY"
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(response, status, payload, headers = {}) {
  response.writeHead(status, {
    ...securityHeaders,
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    ...headers
  });
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request) {
  const contentType = (request.headers["content-type"] || "").split(";")[0].trim();
  if (contentType !== "application/json") {
    throw new HttpError(415, "Send this request as JSON.");
  }

  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    totalBytes += chunk.length;
    if (totalBytes > 8192) {
      throw new HttpError(413, "Request body is too large.");
    }
    chunks.push(chunk);
  }

  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new Error("Expected a JSON object.");
    }
    return body;
  } catch {
    throw new HttpError(400, "Request body must be valid JSON.");
  }
}

function assertSameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return;

  let parsedOrigin;
  try {
    parsedOrigin = new URL(origin).origin;
  } catch {
    throw new HttpError(403, "Request origin is not allowed.");
  }

  const expectedOrigin = process.env.APP_ORIGIN ||
    `${request.socket.encrypted ? "https" : "http"}://${request.headers.host}`;
  if (parsedOrigin !== expectedOrigin) {
    throw new HttpError(403, "Request origin is not allowed.");
  }
}

function parseSessionCookie(request) {
  const cookies = (request.headers.cookie || "").split(";");
  for (const cookie of cookies) {
    const separator = cookie.indexOf("=");
    if (separator < 0) continue;
    if (cookie.slice(0, separator).trim() === sessionCookieName) {
      return cookie.slice(separator + 1).trim();
    }
  }
  return null;
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function sessionCookie(token, maxAge, secureCookies) {
  const secure = secureCookies ? "; Secure" : "";
  return `${sessionCookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function createSession(database, userId) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + sessionLifetimeMs;
  database.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
  database.prepare(
    "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)"
  ).run(hashToken(token), userId, expiresAt);
  return token;
}

function getSessionUser(database, token) {
  if (!token) return null;

  const tokenHash = hashToken(token);
  const row = database.prepare(`
    SELECT users.id, users.full_name, users.email
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `).get(tokenHash, Date.now());
  if (!row) {
    database.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
    return null;
  }
  return row;
}

async function derivePassword(password, salt) {
  return Buffer.from(await scrypt(password, salt, passwordKeyLength, passwordOptions));
}

function publicUser(row) {
  return { id: row.id, fullName: row.full_name, email: row.email };
}

function initializeDatabase(databasePath) {
  if (databasePath !== ":memory:") {
    mkdirSync(dirname(resolve(databasePath)), { recursive: true });
  }

  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_expires_at ON sessions(expires_at);
  `);
  return database;
}

function resolveStaticFile(publicRoot, pathname) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  const requestedPath = decodedPath === "/" ? "index.html" : decodedPath.replace(/^\/+/, "");
  const filePath = resolve(publicRoot, requestedPath);
  const relativePath = relative(publicRoot, filePath);
  if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    return null;
  }

  const parts = relativePath.split(sep);
  const blocked = parts.some((part) =>
    part.startsWith(".") || part === "data" || part === "node_modules"
  );
  if (blocked || ["package.json", "server.js", "server.test.js"].includes(relativePath.toLowerCase())) {
    return null;
  }
  return filePath;
}

function sendStaticFile(request, response, publicRoot, pathname, database) {
  const filePath = resolveStaticFile(publicRoot, pathname);
  if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
    sendJson(response, 404, { error: "Not found." });
    return;
  }

  const extension = extname(filePath).toLowerCase();
  const relativePath = relative(publicRoot, filePath).toLowerCase();
  const isHtml = extension === ".html";
  const isPublicAuthPage = ["login.html", "signup.html"].includes(relativePath);
  if (isHtml && !isPublicAuthPage && !getSessionUser(database, parseSessionCookie(request))) {
    response.writeHead(302, {
      ...securityHeaders,
      "Cache-Control": "no-store",
      Location: "/login.html"
    });
    response.end();
    return;
  }

  const contentType = contentTypes.get(extension) || "application/octet-stream";
  response.writeHead(200, {
    ...securityHeaders,
    "Cache-Control": isHtml ? "no-store" : "no-cache",
    "Content-Type": contentType
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  createReadStream(filePath).pipe(response);
}

export function createAuthServer({
  databasePath = ":memory:",
  publicRoot = projectRoot,
  secureCookies = process.env.NODE_ENV === "production"
} = {}) {
  const database = initializeDatabase(databasePath);
  const root = resolve(publicRoot);

  async function handleAuth(request, response, pathname) {
    if (pathname === "/api/health" && request.method === "GET") {
      sendJson(response, 200, { status: "ok" });
      return;
    }

    if (pathname === "/api/auth/me" && request.method === "GET") {
      const row = getSessionUser(database, parseSessionCookie(request));
      if (!row) {
        sendJson(response, 401, { error: "Not signed in." });
        return;
      }
      sendJson(response, 200, { user: publicUser(row) });
      return;
    }

    if (pathname === "/api/auth/logout" && request.method === "POST") {
      assertSameOrigin(request);
      const token = parseSessionCookie(request);
      if (token) {
        database.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
      }
      sendJson(response, 200, { success: true }, {
        "Set-Cookie": sessionCookie("", 0, secureCookies)
      });
      return;
    }

    if (pathname !== "/api/auth/signup" && pathname !== "/api/auth/login") {
      sendJson(response, 404, { error: "API route not found." });
      return;
    }
    if (request.method !== "POST") {
      sendJson(response, 405, { error: "Method not allowed." }, { Allow: "POST" });
      return;
    }

    assertSameOrigin(request);
    const body = await readJsonBody(request);
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (pathname === "/api/auth/signup") {
      const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
      if (!fullName || fullName.length > 80 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
        throw new HttpError(400, "Enter a valid name and email address.");
      }
      if (password.length < 8 || password.length > 128) {
        throw new HttpError(400, "Password must be between 8 and 128 characters.");
      }
      if (database.prepare("SELECT id FROM users WHERE email = ?").get(email)) {
        throw new HttpError(409, "An account with that email already exists.");
      }

      const salt = randomBytes(16);
      const passwordHash = await derivePassword(password, salt);
      let result;
      try {
        result = database.prepare(`
          INSERT INTO users (full_name, email, password_salt, password_hash)
          VALUES (?, ?, ?, ?)
        `).run(fullName, email, salt.toString("hex"), passwordHash.toString("hex"));
      } catch (error) {
        if (String(error.message).includes("UNIQUE constraint failed")) {
          throw new HttpError(409, "An account with that email already exists.");
        }
        throw error;
      }

      const user = publicUser({ id: Number(result.lastInsertRowid), full_name: fullName, email });
      const token = createSession(database, user.id);
      sendJson(response, 201, { user }, {
        "Set-Cookie": sessionCookie(token, sessionLifetimeMs / 1000, secureCookies)
      });
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !password) {
      throw new HttpError(401, "Email or password is incorrect.");
    }

    const row = database.prepare(`
      SELECT id, full_name, email, password_salt, password_hash
      FROM users WHERE email = ?
    `).get(email);
    const salt = row ? Buffer.from(row.password_salt, "hex") : Buffer.alloc(16);
    const expectedHash = row ? Buffer.from(row.password_hash, "hex") : Buffer.alloc(passwordKeyLength);
    const actualHash = await derivePassword(password, salt);
    const validPassword = expectedHash.length === actualHash.length &&
      timingSafeEqual(expectedHash, actualHash);

    if (!row || !validPassword) {
      throw new HttpError(401, "Email or password is incorrect.");
    }

    const token = createSession(database, row.id);
    sendJson(response, 200, { user: publicUser(row) }, {
      "Set-Cookie": sessionCookie(token, sessionLifetimeMs / 1000, secureCookies)
    });
  }

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
      if (url.pathname.startsWith("/api/")) {
        await handleAuth(request, response, url.pathname);
        return;
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        sendJson(response, 405, { error: "Method not allowed." }, { Allow: "GET, HEAD" });
        return;
      }
      sendStaticFile(request, response, root, url.pathname, database);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      if (status === 500) console.error(error);
      if (!response.headersSent) {
        sendJson(response, status, {
          error: status === 500 ? "An unexpected server error occurred." : error.message
        });
      } else {
        response.destroy();
      }
    }
  });

  return { server, database };
}

const isMainModule = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  const port = Number.parseInt(process.env.PORT || "3000", 10);
  const host = process.env.HOST || "0.0.0.0";
  const databasePath = process.env.DATABASE_PATH || resolve(projectRoot, "data", "zut-sports.sqlite");
  const { server, database } = createAuthServer({ databasePath });

  server.listen(port, host, () => {
    console.log(`ZUT Sports is running at http://${host}:${port}`);
    console.log(`SQLite database: ${databasePath}`);
  });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      server.close(() => {
        database.close();
        process.exit(0);
      });
    });
  }
}