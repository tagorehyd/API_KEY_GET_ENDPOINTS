const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const APPROVAL_TTL_SECONDS = 5 * 60;
const DEFAULT_STORE_OBJECT_KEY = "api-key-store.json";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/telegram/webhook") {
      return handleTelegramWebhook(request, env);
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
    return handleApprovalCallback(callbackQuery, env);
  }

  if (!message?.text || !isAdmin(message.from?.id, env)) {
    return json({ ok: true });
  }

  const chatId = message.chat.id;
  const [command, ...parts] = message.text.trim().split(/\s+/);

  if (command === "/setkey") {
    const [name, ...valueParts] = parts;
    const value = valueParts.join(" ");
    if (!name || !value) {
      await sendTelegramMessage(env, chatId, "Usage: /setkey <name> <value>");
      return json({ ok: true });
    }
    await setApiKey(env, name, value);
    await sendTelegramMessage(env, chatId, `API key '${name}' saved.`);
    return json({ ok: true });
  }

  if (command === "/getkey") {
    const [name] = parts;
    if (!name) {
      await sendTelegramMessage(env, chatId, "Usage: /getkey <name>");
      return json({ ok: true });
    }
    const apiKey = await getApiKey(env, name);
    await sendTelegramMessage(env, chatId, apiKey ? `${name}: ${apiKey}` : `No key found for '${name}'.`);
    return json({ ok: true });
  }

  await sendTelegramMessage(env, chatId, "Commands: /setkey <name> <value>, /getkey <name>");
  return json({ ok: true });
}

async function requestApiKey(name, request, env) {
  if (!name) return json({ error: "Missing key name" }, 400);

  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + APPROVAL_TTL_SECONDS;
  const requesterIp = request.headers.get("cf-connecting-ip") ?? "unknown";

  await updateStore(env, (store) => {
    store.approvalRequests[id] = {
      id,
      keyName: name,
      requesterIp,
      status: "pending",
      createdAt: now,
      expiresAt,
    };
    pruneExpiredApprovals(store, now);
  });

  await notifyAdminsForApproval(env, { id, name, requesterIp, expiresAt });

  const approved = await waitForApproval(env, id);
  if (!approved) {
    await markExpiredOrRejected(env, id);
    return json({ error: "Rejected" }, 401);
  }

  const apiKey = await getApiKey(env, name);
  if (!apiKey) return json({ error: "Key not found" }, 404);
  return json({ name, value: apiKey });
}

async function waitForApproval(env, id) {
  const deadline = Date.now() + APPROVAL_TTL_SECONDS * 1000;
  while (Date.now() < deadline) {
    const store = await readStore(env);
    const status = store.approvalRequests[id]?.status;
    if (status === "approved") return true;
    if (status === "rejected" || status === "expired") return false;
    await scheduler.wait(2000);
  }
  return false;
}

async function markExpiredOrRejected(env, id) {
  const now = Math.floor(Date.now() / 1000);
  await updateStore(env, (store) => {
    const approval = store.approvalRequests[id];
    if (!approval || approval.status !== "pending") return;
    approval.status = approval.expiresAt <= now ? "expired" : "rejected";
  });
}

async function handleApprovalCallback(callbackQuery, env) {
  if (!isAdmin(callbackQuery.from?.id, env)) return json({ ok: true });

  const [action, id] = callbackQuery.data.split(":");
  if (!id || !["approve", "reject"].includes(action)) return json({ ok: true });

  const now = Math.floor(Date.now() / 1000);
  let callbackMessage = "Request expired or already handled.";

  await updateStore(env, (store) => {
    const approval = store.approvalRequests[id];
    if (!approval || approval.status !== "pending" || approval.expiresAt < now) {
      if (approval?.status === "pending") approval.status = "expired";
      return;
    }

    approval.status = action === "approve" ? "approved" : "rejected";
    callbackMessage = `Request ${approval.status}.`;
  });

  await answerCallbackQuery(env, callbackQuery.id, callbackMessage);
  return json({ ok: true });
}

async function setApiKey(env, name, value) {
  await updateStore(env, (store) => {
    store.apiKeys[name] = {
      value,
      updatedAt: new Date().toISOString(),
    };
  });
}

async function getApiKey(env, name) {
  const store = await readStore(env);
  return store.apiKeys[name]?.value;
}

async function readStore(env) {
  const object = await env.BUCKET.get(storeObjectKey(env));
  if (!object) return createEmptyStore();

  const store = await object.json();
  return normalizeStore(store);
}

async function writeStore(env, store) {
  await env.BUCKET.put(storeObjectKey(env), JSON.stringify(normalizeStore(store), null, 2), {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
  });
}

async function updateStore(env, updater) {
  const store = await readStore(env);
  await updater(store);
  await writeStore(env, store);
}

function createEmptyStore() {
  return {
    apiKeys: {},
    approvalRequests: {},
  };
}

function normalizeStore(store) {
  return {
    apiKeys: store?.apiKeys ?? {},
    approvalRequests: store?.approvalRequests ?? {},
  };
}

function pruneExpiredApprovals(store, now) {
  for (const approval of Object.values(store.approvalRequests)) {
    if (approval.status === "pending" && approval.expiresAt <= now) {
      approval.status = "expired";
    }
  }
}

function storeObjectKey(env) {
  return env.R2_STORE_OBJECT_KEY || DEFAULT_STORE_OBJECT_KEY;
}

async function notifyAdminsForApproval(env, approval) {
  const text = `API key request\nName: ${approval.name}\nIP: ${approval.requesterIp}\nExpires: ${new Date(approval.expiresAt * 1000).toISOString()}`;
  const reply_markup = {
    inline_keyboard: [[
      { text: "Approve", callback_data: `approve:${approval.id}` },
      { text: "Reject", callback_data: `reject:${approval.id}` },
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
