const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const APPROVAL_TTL_SECONDS = 5 * 60;
const STATUS_PENDING = "pending";
const STATUS_APPROVED = "approved";
const STATUS_REJECTED = "rejected";
const STATUS_EXPIRED = "expired";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/telegram/webhook") {
      return handleTelegramWebhook(request, env);
    }

    if (request.method === "GET" && url.pathname.startsWith("/api/keys/status/")) {
      const idempotencyKey = decodeURIComponent(url.pathname.slice("/api/keys/status/".length));
      return getApiKeyRequestStatus(idempotencyKey, request, env);
    }

    if (request.method === "GET" && url.pathname.startsWith("/api/keys/")) {
      const name = decodeURIComponent(url.pathname.slice("/api/keys/".length));
      return requestApiKey(name, request, env);
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true });
    }

    return json({ error: "Not found" }, 404);
  },
};

async function handleTelegramWebhook(request, env) {
  const secret = request.headers.get("x-telegram-bot-api-secret-token");
  if (env.TELEGRAM_WEBHOOK_SECRET && secret !== env.TELEGRAM_WEBHOOK_SECRET) {
    return json({ error: "Unauthorized" }, 401);
  }

  const update = await request.json();
  const message = update.message ?? update.edited_message;
  const callbackQuery = update.callback_query;

  if (callbackQuery) {
    return handleTelegramCallback(callbackQuery, env);
  }

  if (!message?.text) {
    return json({ ok: true });
  }

  const chatId = message.chat.id;

  if (!isAdmin(message.from?.id, env)) {
    await sendTelegramMessage(env, chatId, "Thanks for your message. This bot is managed by admins only, so I can't process commands from this account.");
    return json({ ok: true });
  }

  await handleAdminMessage(env, chatId, message.text.trim());
  return json({ ok: true });
}

async function handleAdminMessage(env, chatId, text) {
  const [command, ...parts] = text.split(/\s+/);
  const normalizedCommand = command.toLowerCase();

  if (["/start", "hi", "hello", "hey"].includes(normalizedCommand)) {
    await sendAdminMenu(env, chatId);
    return;
  }

  if (normalizedCommand === "/setkey") {
    const [name, ...valueParts] = parts;
    const value = valueParts.join(" ");
    if (!name || !value) {
      await sendTelegramMessage(env, chatId, "Usage: /setkey <name> <value>", adminMenuMarkup());
      return;
    }
    await setApiKey(env, name, value);
    await sendTelegramMessage(env, chatId, `API key '${name}' saved.`, adminMenuMarkup());
    return;
  }

  if (normalizedCommand === "/getkey") {
    const [name] = parts;
    if (!name) {
      await sendTelegramMessage(env, chatId, "Usage: /getkey <name>", adminMenuMarkup());
      return;
    }
    const apiKey = await getApiKey(env, name);
    await sendTelegramMessage(env, chatId, apiKey ? `${name}: ${apiKey}` : `No key found for '${name}'.`, adminMenuMarkup());
    return;
  }

  await sendAdminMenu(env, chatId);
}

async function handleTelegramCallback(callbackQuery, env) {
  if (!isAdmin(callbackQuery.from?.id, env)) return json({ ok: true });

  if (callbackQuery.data?.startsWith("menu:")) {
    await handleMenuCallback(callbackQuery, env);
    return json({ ok: true });
  }

  await handleApprovalCallback(callbackQuery, env);
  return json({ ok: true });
}

async function handleMenuCallback(callbackQuery, env) {
  const chatId = callbackQuery.message?.chat?.id;
  const action = callbackQuery.data.slice("menu:".length);

  if (action === "setkey") {
    if (chatId) await sendTelegramMessage(env, chatId, "Send /setkey <name> <value> to save or update an API key.", adminMenuMarkup());
    await answerCallbackQuery(env, callbackQuery.id, "Set key instructions sent.");
    return;
  }

  if (action === "getkey") {
    if (chatId) await sendTelegramMessage(env, chatId, "Send /getkey <name> to retrieve an API key.", adminMenuMarkup());
    await answerCallbackQuery(env, callbackQuery.id, "Get key instructions sent.");
    return;
  }

  if (chatId) await sendAdminMenu(env, chatId);
  await answerCallbackQuery(env, callbackQuery.id, "Menu sent.");
}

async function sendAdminMenu(env, chatId) {
  await sendTelegramMessage(
    env,
    chatId,
    "Hi! Choose an option below, or use /setkey <name> <value> and /getkey <name>.",
    adminMenuMarkup(),
  );
}

function adminMenuMarkup() {
  return {
    inline_keyboard: [[
      { text: "Set key", callback_data: "menu:setkey" },
      { text: "Get key", callback_data: "menu:getkey" },
    ]],
  };
}

async function requestApiKey(name, request, env) {
  if (!name) return json({ error: "Missing key name" }, 400);

  const idempotencyKey = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + APPROVAL_TTL_SECONDS;
  const requesterIp = request.headers.get("cf-connecting-ip") ?? "unknown";
  const statusUrl = new URL(`/api/keys/status/${encodeURIComponent(idempotencyKey)}`, request.url).toString();

  await env.DB.prepare(
    "INSERT INTO approval_requests (id, key_name, requester_ip, status, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(idempotencyKey, name, requesterIp, STATUS_PENDING, now, expiresAt).run();

  await notifyAdminsForApproval(env, { id: idempotencyKey, name, requesterIp, expiresAt });

  return json({ idempotencyKey, status: STATUS_PENDING, statusUrl, expiresAt }, 202);
}

async function getApiKeyRequestStatus(idempotencyKey, request, env) {
  if (!idempotencyKey) return json({ error: "Missing idempotency key" }, 400);

  const row = await env.DB.prepare(
    "SELECT id, key_name, status, expires_at FROM approval_requests WHERE id = ?"
  ).bind(idempotencyKey).first();

  if (!row) return json({ error: "Request not found" }, 404);

  const now = Math.floor(Date.now() / 1000);
  let status = row.status;
  if (status === STATUS_PENDING && row.expires_at <= now) {
    status = STATUS_EXPIRED;
    await env.DB.prepare("UPDATE approval_requests SET status = ? WHERE id = ? AND status = ?")
      .bind(STATUS_EXPIRED, idempotencyKey, STATUS_PENDING)
      .run();
  }

  if ([STATUS_REJECTED, STATUS_EXPIRED].includes(status)) {
    return json({ idempotencyKey, status }, 401);
  }

  if (status === STATUS_APPROVED) {
    const apiKey = await getApiKey(env, row.key_name);
    if (!apiKey) return json({ idempotencyKey, status: STATUS_APPROVED, error: "Key not found" }, 404);
    return json({ idempotencyKey, status: STATUS_APPROVED, name: row.key_name, value: apiKey });
  }

  const statusUrl = new URL(`/api/keys/status/${encodeURIComponent(idempotencyKey)}`, request.url).toString();
  return json({ idempotencyKey, status: STATUS_PENDING, statusUrl, expiresAt: row.expires_at }, 202);
}

async function handleApprovalCallback(callbackQuery, env) {
  const [action, id] = callbackQuery.data.split(":");
  if (!id || !["approve", "decline"].includes(action)) return;

  const now = Math.floor(Date.now() / 1000);
  const requestRow = await env.DB.prepare("SELECT status, expires_at FROM approval_requests WHERE id = ?").bind(id).first();
  if (!requestRow || requestRow.status !== STATUS_PENDING || requestRow.expires_at <= now) {
    if (requestRow?.status === STATUS_PENDING && requestRow.expires_at <= now) {
      await env.DB.prepare("UPDATE approval_requests SET status = ? WHERE id = ? AND status = ?")
        .bind(STATUS_EXPIRED, id, STATUS_PENDING)
        .run();
    }
    await answerCallbackQuery(env, callbackQuery.id, "Request expired or already handled.");
    return;
  }

  const status = action === "approve" ? STATUS_APPROVED : STATUS_REJECTED;
  await env.DB.prepare("UPDATE approval_requests SET status = ? WHERE id = ?").bind(status, id).run();
  await answerCallbackQuery(env, callbackQuery.id, `Request ${status}.`);
}

async function setApiKey(env, name, value) {
  await env.DB.prepare(
    "INSERT INTO api_keys (name, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(name) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP"
  ).bind(name, value).run();
}

async function getApiKey(env, name) {
  const row = await env.DB.prepare("SELECT value FROM api_keys WHERE name = ?").bind(name).first();
  return row?.value;
}

async function notifyAdminsForApproval(env, approval) {
  const text = `API key request\nName: ${approval.name}\nIP: ${approval.requesterIp}\nExpires: ${new Date(approval.expiresAt * 1000).toISOString()}`;
  const reply_markup = {
    inline_keyboard: [[
      { text: "Approve", callback_data: `approve:${approval.id}` },
      { text: "Decline", callback_data: `decline:${approval.id}` },
    ]],
  };

  for (const chatId of adminChatIds(env)) {
    await sendTelegramMessage(env, chatId, text, reply_markup);
  }
}

async function sendTelegramMessage(env, chatId, text, reply_markup) {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error("Missing TELEGRAM_BOT_TOKEN");
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ chat_id: chatId, text, reply_markup }),
  });
}

async function answerCallbackQuery(env, callback_query_id, text) {
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ callback_query_id, text }),
  });
}

function adminChatIds(env) {
  return (env.TELEGRAM_ADMIN_CHAT_IDS ?? env.TELEGRAM_ADMIN_CHAT_ID ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

function isAdmin(userId, env) {
  return (env.TELEGRAM_ADMIN_USER_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .includes(String(userId));
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}
