import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { createAuthServer } from "./server.js";

let server;
let database;
let baseUrl;

beforeEach(async function () {
  ({ server, database } = createAuthServer({ databasePath: ":memory:" }));
  await new Promise(function (resolve, reject) {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async function () {
  await new Promise(function (resolve) {
    server.close(resolve);
  });
  database.close();
});

async function postJson(path, payload, cookie) {
  const headers = { "Content-Type": "application/json" };
  if (cookie) headers.Cookie = cookie;
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });
}

test("requires sign-in for site pages and keeps account pages public", async function () {
  const homeResponse = await fetch(`${baseUrl}/`, { redirect: "manual" });
  assert.equal(homeResponse.status, 302);
  assert.equal(homeResponse.headers.get("location"), "/login.html");

  for (const page of ["/index.html", "/sports.html", "/articles.html", "/article.html", "/news.html", "/Tables.html"]) {
    const response = await fetch(`${baseUrl}${page}`, { redirect: "manual" });
    assert.equal(response.status, 302, `${page} should require sign-in`);
    assert.equal(response.headers.get("location"), "/login.html");
  }

  for (const page of ["/login.html", "/signup.html"]) {
    const response = await fetch(`${baseUrl}${page}`);
    assert.equal(response.status, 200);
  }

  const healthResponse = await fetch(`${baseUrl}/api/health`);
  assert.equal(healthResponse.status, 200);
  assert.deepEqual(await healthResponse.json(), { status: "ok" });
});

test("signup creates a user and an authenticated session", async function () {
  const response = await postJson("/api/auth/signup", {
    fullName: "Test Student",
    email: "Student@example.com",
    password: "securepass1"
  });

  assert.equal(response.status, 201);
  const { user } = await response.json();
  assert.equal(user.fullName, "Test Student");
  assert.equal(user.email, "student@example.com");
  assert.equal("password_hash" in user, false);

  const cookie = response.headers.get("set-cookie").split(";")[0];
  assert.match(response.headers.get("set-cookie"), /HttpOnly/);
  const sessionResponse = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Cookie: cookie }
  });
  assert.equal(sessionResponse.status, 200);
  assert.equal((await sessionResponse.json()).user.id, user.id);

  const homeResponse = await fetch(`${baseUrl}/`, {
    headers: { Cookie: cookie },
    redirect: "manual"
  });
  assert.equal(homeResponse.status, 200);
  assert.match(await homeResponse.text(), /ZUT Sports/);

  for (const page of ["/index.html", "/sports.html", "/articles.html", "/article.html", "/news.html", "/Tables.html"]) {
    const response = await fetch(`${baseUrl}${page}`, {
      headers: { Cookie: cookie },
      redirect: "manual"
    });
    assert.equal(response.status, 200, `${page} should be available after sign-in`);
  }

  const duplicateResponse = await postJson("/api/auth/signup", {
    fullName: "Another Student",
    email: "student@EXAMPLE.com",
    password: "securepass1"
  });
  assert.equal(duplicateResponse.status, 409);
});

test("login rejects invalid credentials and logout ends the session", async function () {
  await postJson("/api/auth/signup", {
    fullName: "Test Student",
    email: "student@example.com",
    password: "securepass1"
  });

  const invalidResponse = await postJson("/api/auth/login", {
    email: "student@example.com",
    password: "wrongpass1"
  });
  assert.equal(invalidResponse.status, 401);
  assert.deepEqual(await invalidResponse.json(), { error: "Email or password is incorrect." });

  const loginResponse = await postJson("/api/auth/login", {
    email: "STUDENT@example.com",
    password: "securepass1"
  });
  assert.equal(loginResponse.status, 200);
  const cookie = loginResponse.headers.get("set-cookie").split(";")[0];

  const logoutResponse = await postJson("/api/auth/logout", {}, cookie);
  assert.equal(logoutResponse.status, 200);
  const sessionResponse = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Cookie: cookie }
  });
  assert.equal(sessionResponse.status, 401);

  const homeResponse = await fetch(`${baseUrl}/`, {
    headers: { Cookie: cookie },
    redirect: "manual"
  });
  assert.equal(homeResponse.status, 302);
});

test("rejects invalid account details", async function () {
  const response = await postJson("/api/auth/signup", {
    fullName: "",
    email: "not-an-email",
    password: "short"
  });
  assert.equal(response.status, 400);
});