import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTIVE_CHAT_KEY, CHAT_HISTORY_KEY, deleteChat, finishChatRequest, persistActiveChat, restoreChatState, upsertChat } from './chatPersistence.js';

function memoryStorage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
}

test('restores the active conversation and offer after a refresh', () => {
  const storage = memoryStorage();
  const first = { id: 'chat-1', messages: [{ role: 'user', content: 'One offer' }], offerContext: { kind: 'upload', uploadId: 'offer-1' } };
  const second = { id: 'chat-2', messages: [{ role: 'user', content: 'Portfolio' }] };
  upsertChat(storage, first);
  upsertChat(storage, second);
  persistActiveChat(storage, 'chat-1');
  const restored = restoreChatState(storage, { role: 'assistant', content: 'Welcome' });
  assert.equal(restored.activeChatId, 'chat-1');
  assert.deepEqual(restored.messages, first.messages);
  assert.deepEqual(restored.offerContext, first.offerContext);
});

test('a pending request survives refresh and its response is cached once', () => {
  const storage = memoryStorage();
  const question = { role: 'user', content: 'Review it', requestId: 'req-1', request: { message: 'Review it' }, pending: true };
  upsertChat(storage, { id: 'chat-1', messages: [question] });
  assert.equal(restoreChatState(storage, {}).messages[0].pending, true);
  finishChatRequest(storage, 'chat-1', 'req-1', { role: 'assistant', content: 'Review pending', workflow: { status: 'review' } });
  finishChatRequest(storage, 'chat-1', 'req-1', { role: 'assistant', content: 'Duplicate' });
  const messages = JSON.parse(storage.getItem(CHAT_HISTORY_KEY))[0].messages;
  assert.equal(messages.length, 2);
  assert.equal(messages[0].pending, false);
  assert.equal(messages[1].workflow.status, 'review');
  assert.equal(restoreChatState(storage, {}).messages[1].workflow.status, 'review');
  assert.equal(storage.getItem(ACTIVE_CHAT_KEY), null);
});

test('bad history is ignored without losing a new chat', () => {
  const storage = memoryStorage();
  storage.setItem(CHAT_HISTORY_KEY, '{not-json');
  const restored = restoreChatState(storage, { role: 'assistant', content: 'Welcome' }, () => 'fresh');
  assert.equal(restored.activeChatId, 'fresh');
  assert.equal(restored.messages[0].content, 'Welcome');
});

test('deleting a chat clears only that saved conversation', () => {
  const storage = memoryStorage();
  upsertChat(storage, { id: 'chat-1', messages: [{ role: 'user', content: 'Clear this' }] });
  upsertChat(storage, { id: 'chat-2', messages: [{ role: 'user', content: 'Keep this' }] });

  const remaining = deleteChat(storage, 'chat-1');

  assert.deepEqual(remaining.map((chat) => chat.id), ['chat-2']);
  assert.deepEqual(JSON.parse(storage.getItem(CHAT_HISTORY_KEY)).map((chat) => chat.id), ['chat-2']);
});
