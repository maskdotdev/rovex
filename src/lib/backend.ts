import { invoke } from "@tauri-apps/api/core";

export type MessageRole = "system" | "user" | "assistant";

export type BackendHealth = {
  status: "ok" | string;
  databaseUrl: string;
  threadCount: number;
};

export type Thread = {
  id: number;
  title: string;
  workspace: string | null;
  createdAt: string;
};

export type Message = {
  id: number;
  threadId: number;
  role: MessageRole;
  content: string;
  createdAt: string;
};

export type CreateThreadInput = {
  title: string;
  workspace?: string | null;
};

export type AddThreadMessageInput = {
  threadId: number;
  role: MessageRole;
  content: string;
};

export function backendHealth() {
  return invoke<BackendHealth>("backend_health");
}

export function createThread(input: CreateThreadInput) {
  return invoke<Thread>("create_thread", { input });
}

export function listThreads(limit?: number) {
  return invoke<Thread[]>("list_threads", { limit });
}

export function addThreadMessage(input: AddThreadMessageInput) {
  return invoke<Message>("add_thread_message", { input });
}

export function listThreadMessages(threadId: number, limit?: number) {
  return invoke<Message[]>("list_thread_messages", { threadId, limit });
}
