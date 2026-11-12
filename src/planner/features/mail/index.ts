// src/planner/features/mail — each person's email, connected to Arvy. Settings › Email (MailSettings) is where a
// mailbox is connected, its to-dos switched on or off, and disconnected; MailTodos is the "From your email" card on
// Today, with what the half-hourly check is offering. mail.ts is what the app asks the planner-mail function
// (supabase/functions/planner-mail); todos.ts is what Add and Not needed do. Arvy's side of it (reading the inbox,
// writing an email that waits for Confirm) is features/arvy/email.ts.
import './mail.css';
export { MailSettings, MailTile } from './MailSettings';
export { MailTodos } from './MailTodos';
