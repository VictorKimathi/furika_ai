export const CHAT_HISTORY_KEY = 'furika-recent-chats';
export const ACTIVE_CHAT_KEY = 'furika-active-chat-id';

function readHistory(storage) {
  try {
    const value = JSON.parse(storage.getItem(CHAT_HISTORY_KEY) || '[]');
    return Array.isArray(value) ? value.filter((chat) => chat && typeof chat.id === 'string' && Array.isArray(chat.messages)) : [];
  } catch { return []; }
}

function writeHistory(storage, chats) {
  try { storage.setItem(CHAT_HISTORY_KEY, JSON.stringify(chats)); } catch { /* Keep the current chat usable if browser storage is unavailable. */ }
}

export function restoreChatState(storage, initialMessage, createId = () => `chat-${Date.now()}`) {
  const recentChats = readHistory(storage);
  let storedId;
  try { storedId = storage.getItem(ACTIVE_CHAT_KEY); } catch { storedId = null; }
  const activeChatId = storedId || recentChats[0]?.id || createId();
  const active = recentChats.find((chat) => chat.id === activeChatId);
  return {
    activeChatId,
    recentChats,
    messages: active?.messages?.length ? active.messages : [initialMessage],
    offerContext: active?.offerContext || null,
  };
}

export function persistActiveChat(storage, chatId) {
  try { storage.setItem(ACTIVE_CHAT_KEY, chatId); } catch { /* Browser storage is optional. */ }
}

export function upsertChat(storage, entry) {
  const next = [entry, ...readHistory(storage).filter((chat) => chat.id !== entry.id)].slice(0, 12);
  writeHistory(storage, next);
  return next;
}

export function deleteChat(storage, chatId) {
  const next = readHistory(storage).filter((chat) => chat.id !== chatId);
  writeHistory(storage, next);
  return next;
}

export function finishChatRequest(storage, chatId, requestId, responseMessage, offerContext) {
  const chats = readHistory(storage);
  const chat = chats.find((item) => item.id === chatId);
  if (!chat) return null;
  const pending = chat.messages.find((message) => message.requestId === requestId && message.pending);
  if (!pending) return chat; // A retry or another tab already recorded the response.
  const messages = chat.messages.map((message) => message === pending ? { ...message, pending: false, request: undefined } : message);
  messages.push(responseMessage);
  const updated = { ...chat, messages, offerContext: offerContext === undefined ? chat.offerContext : offerContext, updatedAt: Date.now() };
  writeHistory(storage, [updated, ...chats.filter((item) => item.id !== chatId)].slice(0, 12));
  return updated;
}
