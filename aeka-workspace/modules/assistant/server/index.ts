// Assistant server module: the actions of shared/contract.ts (tests check the two match). Every
// action works on the caller's own records; nobody else, administrators included, can reach them.
import type { ServerModule } from '../../../core/server/module.ts';
import { buildBrief } from './brief.ts';
import {
  conversationMessages,
  deleteConversation,
  getConversation,
  listConversations,
  renameConversation,
  sendMessage,
} from './chat.ts';
import {
  createReminder,
  createTodo,
  deleteMemory,
  deleteReminder,
  deleteTodo,
  listMemory,
  listReminders,
  listTodos,
  memoryFields,
  quickAdd,
  reminderFields,
  saveMemory,
  snoozeReminder,
  todoFields,
  todoToTask,
  updateReminder,
  updateTodo,
} from './records.ts';
import { meetingPrep, prepSummary, scheduleWeek, upcomingMeetings } from './meetings.ts';
import { getSettings, saveSettings, startLink, unlink } from './settings.ts';
import { notesToTodos } from './sources.ts';
import { assistantTick } from './tick.ts';
import { revision } from './validate.ts';

export const assistantServer: ServerModule = {
  id: 'assistant',
  actions: {
    'chat.list': { handler: (ctx) => listConversations(ctx) },
    'chat.get': {
      handler: async (ctx, p) => {
        const conversation = await getConversation(ctx, p.id);
        return { conversation, messages: await conversationMessages(ctx, conversation.id) };
      },
    },
    'chat.send': {
      handler: (ctx, p) => sendMessage(ctx, { conversationId: p.conversationId, text: p.text }),
    },
    'chat.rename': { handler: (ctx, p) => renameConversation(ctx, p.id, p.title) },
    'chat.delete': { handler: (ctx, p) => deleteConversation(ctx, p.id) },

    'todos.list': { handler: (ctx, p) => listTodos(ctx, p.includeDone === true) },
    'todo.create': { handler: (ctx, p) => createTodo(ctx, todoFields(p.todo)) },
    'todo.update': {
      handler: (ctx, p) => updateTodo(ctx, p.id, todoFields(p.todo), revision(p.baseRevision)),
    },
    'todo.delete': { handler: (ctx, p) => deleteTodo(ctx, p.id) },
    'todo.toTask': { handler: (ctx, p) => todoToTask(ctx, p) },
    'todo.quickAdd': { handler: (ctx, p) => quickAdd(ctx, p.text) },
    'notes.toTodos': { handler: (ctx, p) => notesToTodos(ctx, p.noteId) },

    'reminders.list': { handler: (ctx) => listReminders(ctx) },
    'reminder.create': { handler: (ctx, p) => createReminder(ctx, reminderFields(p.reminder)) },
    'reminder.update': {
      handler: (ctx, p) => updateReminder(ctx, p.id, reminderFields(p.reminder), revision(p.baseRevision)),
    },
    'reminder.snooze': {
      handler: (ctx, p) => snoozeReminder(ctx, p.id, p.minutes, revision(p.baseRevision)),
    },
    'reminder.delete': { handler: (ctx, p) => deleteReminder(ctx, p.id) },

    'memory.list': { handler: (ctx) => listMemory(ctx) },
    'memory.save': { handler: (ctx, p) => saveMemory(ctx, p.id, memoryFields(p.memory)) },
    'memory.delete': { handler: (ctx, p) => deleteMemory(ctx, p.id) },

    'brief.get': { handler: (ctx) => buildBrief(ctx, true) },

    'meetings.upcoming': { handler: (ctx, p) => upcomingMeetings(ctx, p.days) },
    'meetings.prep': { handler: (ctx, p) => meetingPrep(ctx, p.eventId) },
    'meetings.prepSummary': { handler: (ctx, p) => prepSummary(ctx, p.eventId, p.refresh) },
    'schedule.week': { handler: (ctx) => scheduleWeek(ctx) },

    'settings.get': { handler: (ctx) => getSettings(ctx) },
    'settings.save': { handler: (ctx, p) => saveSettings(ctx, p.settings) },
    'whatsapp.link': { handler: (ctx) => startLink(ctx) },
    'whatsapp.unlink': { handler: (ctx) => unlink(ctx) },
  },
  tick: assistantTick,
};
