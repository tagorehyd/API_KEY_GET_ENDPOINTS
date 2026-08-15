const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const APPROVAL_TTL_SECONDS = 5 * 60;
const STATUS_PENDING = "pending";
const STATUS_APPROVED = "approved";
const STATUS_REJECTED = "rejected";
const STATUS_EXPIRED = "expired";
const DELETE_SESSION_TTL_SECONDS = 10 * 60;
const SET_KEY_SESSION_TTL_SECONDS = 10 * 60;
const SET_KEY_STEP_NAME = "name";
const SET_KEY_STEP_VALUE = "value";
let lastStartupConfigSignature;

export default {
  async fetch(request, env) {
    logStartupConfig(env);

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

  if (await handlePendingSetKeyInput(env, chatId, text, normalizedCommand)) return;

  if (["/start", "hi", "hello", "hey"].includes(normalizedCommand)) {
    await sendAdminMenu(env, chatId);
    return;
  }

  if (normalizedCommand === "/setkey") {
    const [name, ...valueParts] = parts;
    const value = valueParts.join(" ");
    if (!name && !value) {
      await startSetKeyPrompt(env, chatId);
      return;
    }
    if (!name || !value) {
      await sendTelegramMessage(env, chatId, "🔐 <b>Almost there.</b> Use <code>/setkey &lt;name&gt; &lt;value&gt;</code>, or tap <b>Set key</b> in the main menu for a guided flow.");
      return;
    }
    await setApiKey(env, name, value);
    await sendTelegramMessage(env, chatId, `✅ API key <b>${escapeHtml(name)}</b> saved securely.`);
    return;
  }

  if (normalizedCommand === "/getkey") {
    const [name] = parts;
    if (!name) {
      await sendTelegramMessage(env, chatId, "🔎 <b>Usage</b>\n<code>/getkey &lt;name&gt;</code>");
      return;
    }
    const apiKey = await getApiKey(env, name);
    await sendTelegramMessage(env, chatId, apiKey ? `✅ <b>${escapeHtml(name)}</b>\n<code>${escapeHtml(apiKey)}</code>` : `⚠️ No key found for <b>${escapeHtml(name)}</b>.`);
    return;
  }

  if (["/deletekey", "/deletekeys"].includes(normalizedCommand)) {
    await sendDeleteKeysPicker(env, chatId);
    return;
  }

  if (["/clear", "/clearchat"].includes(normalizedCommand)) {
    await sendTelegramMessage(env, chatId, "🧹 <b>Fresh workspace ready.</b> Use /start whenever you want the control panel again.");
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

  if (callbackQuery.data?.startsWith("delete:")) {
    await handleDeleteKeysCallback(callbackQuery, env);
    return json({ ok: true });
  }

  if (callbackQuery.data?.startsWith("set:")) {
    await handleSetKeyCallback(callbackQuery, env);
    return json({ ok: true });
  }

  await handleApprovalCallback(callbackQuery, env);
  return json({ ok: true });
}

async function handleMenuCallback(callbackQuery, env) {
  const chatId = callbackQuery.message?.chat?.id;
  const action = callbackQuery.data.slice("menu:".length);

  if (action === "setkey") {
    if (chatId) await startSetKeyPrompt(env, chatId);
    await answerCallbackQuery(env, callbackQuery.id, "Guided set-key prompt opened.");
    return;
  }

  if (action === "getkey") {
    if (chatId) await sendTelegramMessage(env, chatId, "🔎 Send <code>/getkey &lt;name&gt;</code> to retrieve an API key.");
    await answerCallbackQuery(env, callbackQuery.id, "Get key instructions sent.");
    return;
  }

  if (action === "deletekeys") {
    if (chatId) await sendDeleteKeysPicker(env, chatId);
    await answerCallbackQuery(env, callbackQuery.id, "Delete key picker opened.");
    return;
  }

  if (action === "clearchat") {
    await deleteTelegramMessage(env, chatId, callbackQuery.message?.message_id);
    if (chatId) await sendTelegramMessage(env, chatId, "🧹 <b>Menu cleared.</b> Here is a fresh control panel:", adminMenuMarkup());
    await answerCallbackQuery(env, callbackQuery.id, "Chat refreshed.");
    return;
  }

  if (chatId) await sendAdminMenu(env, chatId);
  await answerCallbackQuery(env, callbackQuery.id, "Menu sent.");
}

async function sendAdminMenu(env, chatId) {
  await sendTelegramMessage(
    env,
    chatId,
    "✨ <b>API Key Command Center</b> ✨\n\nChoose a secure action below, or use:\n🔐 <code>/setkey &lt;name&gt; &lt;value&gt;</code>\n🔎 <code>/getkey &lt;name&gt;</code>\n🗑️ <code>/deletekeys</code>",
    adminMenuMarkup(),
  );
}

function adminMenuMarkup() {
  return {
    inline_keyboard: [
      [
        { text: "🔐 Set key", callback_data: "menu:setkey" },
        { text: "🔎 Get key", callback_data: "menu:getkey" },
      ],
      [
        { text: "🗑️ Delete keys", callback_data: "menu:deletekeys" },
        { text: "🧹 Clear chat", callback_data: "menu:clearchat" },
      ],
    ],
  };
}

async function startSetKeyPrompt(env, chatId) {
  await pruneExpiredSetKeySessions(env);

  const sessionId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    "INSERT INTO set_key_sessions (id, chat_id, step, created_at, expires_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(chat_id) DO UPDATE SET id = excluded.id, step = excluded.step, key_name = NULL, created_at = excluded.created_at, expires_at = excluded.expires_at"
  ).bind(sessionId, String(chatId), SET_KEY_STEP_NAME, now, now + SET_KEY_SESSION_TTL_SECONDS).run();

  await sendTelegramMessage(
    env,
    chatId,
    "🔐 <b>Guided API Key Setup</b>\n\nStep 1 of 2: What should this key be called?\n\nExample: <code>openai-prod</code>",
    setKeyCancelMarkup(sessionId),
  );
}

async function handlePendingSetKeyInput(env, chatId, text, normalizedCommand) {
  await pruneExpiredSetKeySessions(env);

  const session = await env.DB.prepare("SELECT id, step, key_name FROM set_key_sessions WHERE chat_id = ?")
    .bind(String(chatId))
    .first();
  if (!session) return false;

  if (["/cancel", "cancel"].includes(normalizedCommand)) {
    await deleteSetKeySession(env, session.id);
    await sendTelegramMessage(env, chatId, "🛡️ <b>Set-key prompt cancelled.</b> Nothing was changed.");
    return true;
  }

  if (text.startsWith("/")) {
    await sendTelegramMessage(
      env,
      chatId,
      "⏳ <b>Set-key prompt still active.</b> Finish the current step or cancel it first.",
      setKeyCancelMarkup(session.id),
    );
    return true;
  }

  if (session.step === SET_KEY_STEP_NAME) {
    const keyName = text.trim();
    if (!keyName) {
      await sendTelegramMessage(env, chatId, "⚠️ Please send a non-empty key name.", setKeyCancelMarkup(session.id));
      return true;
    }

    await env.DB.prepare("UPDATE set_key_sessions SET step = ?, key_name = ? WHERE id = ?")
      .bind(SET_KEY_STEP_VALUE, keyName, session.id)
      .run();
    await sendTelegramMessage(
      env,
      chatId,
      `🔑 <b>${escapeHtml(keyName)}</b>\n\nStep 2 of 2: Now send the API key value. It will be stored securely in D1.`,
      setKeyCancelMarkup(session.id),
    );
    return true;
  }

  if (session.step === SET_KEY_STEP_VALUE) {
    const value = text.trim();
    if (!value) {
      await sendTelegramMessage(env, chatId, "⚠️ Please send a non-empty API key value.", setKeyCancelMarkup(session.id));
      return true;
    }

    await setApiKey(env, session.key_name, value);
    await deleteSetKeySession(env, session.id);
    await sendTelegramMessage(env, chatId, `✅ <b>${escapeHtml(session.key_name)}</b> saved successfully. Your guided setup is complete. ✨`);
    return true;
  }

  await deleteSetKeySession(env, session.id);
  return false;
}

async function handleSetKeyCallback(callbackQuery, env) {
  const [, action, sessionId] = callbackQuery.data.split(":");
  const chatId = callbackQuery.message?.chat?.id;
  const messageId = callbackQuery.message?.message_id;

  if (action !== "cancel" || !sessionId) return;

  await deleteSetKeySession(env, sessionId);
  await editTelegramMessage(env, chatId, messageId, "🛡️ <b>Set-key prompt cancelled.</b> Nothing was changed.");
  await answerCallbackQuery(env, callbackQuery.id, "Set-key prompt cancelled.");
}

async function deleteSetKeySession(env, sessionId) {
  await env.DB.prepare("DELETE FROM set_key_sessions WHERE id = ?").bind(sessionId).run();
}

async function pruneExpiredSetKeySessions(env) {
  await env.DB.prepare("DELETE FROM set_key_sessions WHERE expires_at <= ?")
    .bind(Math.floor(Date.now() / 1000))
    .run();
}

function setKeyCancelMarkup(sessionId) {
  return {
    inline_keyboard: [[{ text: "🛡️ Cancel setup", callback_data: `set:cancel:${sessionId}` }]],
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

async function sendDeleteKeysPicker(env, chatId) {
  await pruneExpiredDeleteSessions(env);

  const names = await listApiKeyNames(env);
  if (names.length === 0) {
    await sendTelegramMessage(env, chatId, "🫧 <b>No API keys to delete.</b> Your vault is already clean.");
    return;
  }

  const sessionId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare("INSERT INTO delete_key_sessions (id, created_at, expires_at) VALUES (?, ?, ?)")
    .bind(sessionId, now, now + DELETE_SESSION_TTL_SECONDS)
    .run();

  for (const name of names) {
    await env.DB.prepare("INSERT INTO delete_key_session_items (session_id, key_name, selected) VALUES (?, ?, 0)")
      .bind(sessionId, name)
      .run();
  }

  await sendTelegramMessage(env, chatId, deleteKeysPrompt(), await deleteKeysMarkup(env, sessionId));
}

async function handleDeleteKeysCallback(callbackQuery, env) {
  const [, action, id] = callbackQuery.data.split(":");
  const chatId = callbackQuery.message?.chat?.id;
  const messageId = callbackQuery.message?.message_id;

  if (action === "toggle") {
    const item = await env.DB.prepare(
      "SELECT item.id, item.session_id, item.selected, session.expires_at FROM delete_key_session_items item JOIN delete_key_sessions session ON session.id = item.session_id WHERE item.id = ?"
    ).bind(id).first();
    if (!item || item.expires_at <= Math.floor(Date.now() / 1000)) {
      await answerCallbackQuery(env, callbackQuery.id, "This delete picker expired. Open a new one.");
      return;
    }

    await env.DB.prepare("UPDATE delete_key_session_items SET selected = ? WHERE id = ?")
      .bind(item.selected ? 0 : 1, id)
      .run();
    await editTelegramMessage(env, chatId, messageId, deleteKeysPrompt(), await deleteKeysMarkup(env, item.session_id));
    await answerCallbackQuery(env, callbackQuery.id, item.selected ? "Key unselected." : "Key selected.");
    return;
  }

  if (action === "confirm") {
    const selectedNames = await selectedDeleteKeyNames(env, id);
    if (selectedNames.length === 0) {
      await answerCallbackQuery(env, callbackQuery.id, "Select at least one key first.");
      return;
    }

    await deleteApiKeys(env, selectedNames);
    await deleteDeleteSession(env, id);
    await editTelegramMessage(
      env,
      chatId,
      messageId,
      `✅ <b>Deletion complete.</b> Removed ${selectedNames.length} key(s):\n${selectedNames.map((name) => `🗑️ <code>${escapeHtml(name)}</code>`).join("\n")}`,
      undefined,
    );
    await answerCallbackQuery(env, callbackQuery.id, "Selected keys deleted.");
    return;
  }

  if (action === "cancel") {
    await deleteDeleteSession(env, id);
    await editTelegramMessage(env, chatId, messageId, "🛡️ <b>Deletion cancelled.</b> No keys were changed.");
    await answerCallbackQuery(env, callbackQuery.id, "Deletion cancelled.");
  }
}

async function listApiKeyNames(env) {
  const result = await env.DB.prepare("SELECT name FROM api_keys ORDER BY name").all();
  return (result.results ?? []).map((row) => row.name);
}

async function selectedDeleteKeyNames(env, sessionId) {
  const result = await env.DB.prepare("SELECT key_name FROM delete_key_session_items WHERE session_id = ? AND selected = 1 ORDER BY key_name")
    .bind(sessionId)
    .all();
  return (result.results ?? []).map((row) => row.key_name);
}

async function deleteApiKeys(env, names) {
  const placeholders = names.map(() => "?").join(", ");
  await env.DB.prepare(`DELETE FROM api_keys WHERE name IN (${placeholders})`).bind(...names).run();
}

async function deleteDeleteSession(env, sessionId) {
  await env.DB.prepare("DELETE FROM delete_key_session_items WHERE session_id = ?").bind(sessionId).run();
  await env.DB.prepare("DELETE FROM delete_key_sessions WHERE id = ?").bind(sessionId).run();
}

async function pruneExpiredDeleteSessions(env) {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare("DELETE FROM delete_key_session_items WHERE session_id IN (SELECT id FROM delete_key_sessions WHERE expires_at <= ?)")
    .bind(now)
    .run();
  await env.DB.prepare("DELETE FROM delete_key_sessions WHERE expires_at <= ?").bind(now).run();
}

async function deleteKeysMarkup(env, sessionId) {
  const result = await env.DB.prepare("SELECT id, key_name, selected FROM delete_key_session_items WHERE session_id = ? ORDER BY key_name")
    .bind(sessionId)
    .all();
  const keyRows = (result.results ?? []).map((row) => ([{
    text: `${row.selected ? "☑️" : "⬜"} ${row.key_name}`,
    callback_data: `delete:toggle:${row.id}`,
  }]));

  return {
    inline_keyboard: [
      ...keyRows,
      [
        { text: "✅ Delete selected", callback_data: `delete:confirm:${sessionId}` },
        { text: "🛡️ Cancel", callback_data: `delete:cancel:${sessionId}` },
      ],
    ],
  };
}

function deleteKeysPrompt() {
  return "🗑️ <b>Delete API Keys</b>\n\nTap keys to mark them like checkboxes, then confirm when your selection looks right. This keeps deletion deliberate and safe. ✨";
}

async function notifyAdminsForApproval(env, approval) {
  const text = `🚨 <b>API key request</b>\n🔑 <b>Name:</b> <code>${escapeHtml(approval.name)}</code>\n🌐 <b>IP:</b> <code>${escapeHtml(approval.requesterIp)}</code>\n⏳ <b>Expires:</b> <code>${new Date(approval.expiresAt * 1000).toISOString()}</code>`;
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
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", reply_markup }),
  });
}

async function editTelegramMessage(env, chat_id, message_id, text, reply_markup) {
  if (!chat_id || !message_id) return;
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/editMessageText`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ chat_id, message_id, text, parse_mode: "HTML", reply_markup }),
  });
}

async function deleteTelegramMessage(env, chat_id, message_id) {
  if (!chat_id || !message_id) return;
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/deleteMessage`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ chat_id, message_id }),
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
  return parseCommaSeparatedIds(env.TELEGRAM_ADMIN_CHAT_IDS ?? env.TELEGRAM_ADMIN_CHAT_ID);
}

function adminUserIds(env) {
  return parseCommaSeparatedIds(env.TELEGRAM_ADMIN_USER_IDS);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function parseCommaSeparatedIds(value) {
  return (value ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

function isAdmin(userId, env) {
  const normalizedUserId = String(userId ?? "");
  const configuredAdminUserIds = adminUserIds(env);
  const allowed = configuredAdminUserIds.includes(normalizedUserId);

  console.info("Telegram admin authorization checked.", {
    userId: normalizedUserId || "unknown",
    allowed,
    configuredAdminUserIds,
  });

  return allowed;
}

function logStartupConfig(env) {
  const startupConfig = {
    adminUserIds: adminUserIds(env),
    adminChatIds: adminChatIds(env),
  };
  const startupConfigSignature = JSON.stringify(startupConfig);
  if (startupConfigSignature === lastStartupConfigSignature) return;

  lastStartupConfigSignature = startupConfigSignature;
  console.info("Worker startup Telegram admin configuration.", startupConfig);
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}
