import {
  DBMessage,
  DBSummary,
  getActiveMessages,
  getActiveSummaries,
  updateData,
} from "./db.ts";
import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import axios from "axios";
import { v4 as uuidv4 } from "uuid";

export interface ChatMessage extends DBMessage {
  type: "message";
  timestamp: Date;
}

export interface ChatSummary extends DBSummary {
  type: "summary";
  timestamp: Date;
}

export type ChatItem = ChatMessage | ChatSummary;

async function getChat(): Promise<ChatItem[]> {
  const messages = await getActiveMessages();
  const summaries = await getActiveSummaries();

  const messageItems: ChatMessage[] = messages.map((message) => ({
    ...message,
    type: "message",
    timestamp: message.createdAt,
  }));

  const summaryItems: ChatSummary[] = summaries.map((summary) => ({
    ...summary,
    type: "summary",
    timestamp: summary.dateTo,
  }));

  return [...messageItems, ...summaryItems].sort(
    (a, b) => a.timestamp.valueOf() - b.timestamp.valueOf(),
  );
}

export function useGetChat(): ChatItem[] {
  const { data } = useQuery({
    queryKey: ["chat"],
    queryFn: getChat,
  });
  return data ?? [];
}

interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "developer";
  name?: string;
  content: string;
}

interface OpenAICompletion {
  choices: CompletionChoice[];
}

interface CompletionChoice {
  message: OpenAIMessage;
}

const OPENAI_BASE_URL = "https://api.proxyapi.ru/openai/v1";

const CHAT_SYSTEM_PROPMT = `You are ChatGPT, a supportive and empathetic assistant helping the user to maintain a personal journal. Your role is to encourage self-reflection, provide constructive feedback, and prompt the user with questions that deepen their understanding of their thoughts and emotions. Ensure confidentiality and create a safe, non-judgmental space for expression. Guide the user towards clarity and personal growth by suggesting insights and encouraging positive, actionable steps.`;

export function setOpenAiApiKey(key: string) {
  localStorage.setItem("OPENAI_API_KEY", key);
}

function getOpenAiApiKey() {
  return localStorage.getItem("OPENAI_API_KEY");
}

interface ChatCompletionRequest {
  model: string;
  messages: OpenAIMessage[];
  temperature: number;
}

async function createChatCompletion(
  request: ChatCompletionRequest,
): Promise<OpenAICompletion> {
  const body = {
    ...request,
    response_format: {
      type: "text",
    },
  };
  const { data } = await axios.post(
    `${OPENAI_BASE_URL}/chat/completions`,
    body,
    {
      headers: {
        Authorization: `Bearer ${getOpenAiApiKey()}`,
      },
    },
  );
  return data;
}

interface EmbeddingResponse {
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

async function createTextEmbedding(input: string): Promise<EmbeddingResponse> {
  const body = {
    model: "text-embedding-3-large",
    input,
  };
  const { data } = await axios.post(`${OPENAI_BASE_URL}/embeddings`, body, {
    headers: {
      Authorization: `Bearer ${getOpenAiApiKey()}`,
    },
  });
  return data;
}

async function createCompletion(
  chat: ChatItem[],
  text: string,
  timestamp: Date,
): Promise<ChatItem[]> {
  const messages: OpenAIMessage[] = [
    { role: "system", content: CHAT_SYSTEM_PROPMT },
  ];

  for (const item of chat) {
    if (item.type === "message") {
      const meta = `[${formatTimestamp(item.createdAt)}]`;
      messages.push({
        role: "user",
        content: `${meta}\n\n${item.userContent}`,
      });
      messages.push({
        role: "assistant",
        content: item.assistantContent,
      });
    }
    if (item.type === "summary") {
      const meta = `[${formatTimestamp(item.dateFrom)} - ${formatTimestamp(item.dateTo)}]`;
      messages.push({
        role: "developer",
        name: "summary",
        content: `${meta}\n\n${item.content}`,
      });
    }
  }

  const meta = `[${formatTimestamp(timestamp)}]`;
  messages.push({
    role: "user",
    content: `${meta}\n\n${text}`,
  });

  const resp = await createChatCompletion({
    model: "gpt-4o",
    temperature: 1,
    messages,
  });
  const respText = resp.choices[0].message.content;
  const embedding = await createTextEmbedding(`${text}\n\n${respText}`);
  const tokens = embedding.usage.total_tokens;

  const newMessage: ChatMessage = {
    type: "message",
    timestamp,
    id: uuidv4().toString(),
    createdAt: timestamp,
    userContent: text,
    assistantContent: respText,
    tokensCount: tokens,
    summaryId: "NULL",
  };
  await updateData([], [newMessage]);

  console.log({ messages, embedding, newMessage });

  return [...chat, newMessage];
}

async function compressChat(chat: ChatItem[]) {
  const messagesForSummary = selectMessagesForSummary(chat);
  if (messagesForSummary.length === 0) return;
  const summary = await compressMessages(messagesForSummary);
  await replaceMessages(messagesForSummary, summary);
}

async function replaceMessages(items: ChatItem[], summary: ChatSummary) {
  const messages: DBMessage[] = [];
  const summaries: DBSummary[] = [summary];

  for (const item of items) {
    if (item.type === "message") {
      messages.push({ ...item, summaryId: summary.id });
    }
    if (item.type === "summary") {
      summaries.push({ ...item, parentId: summary.id });
    }
  }

  await updateData(summaries, messages);
}

const COMPRESS_SYSTEM_MESSAGE = `
Твоя задача - выделить главную информацию из набора предоставленных сообщений в виде списка с указанием временных меток.

**Формат ответа:**

- [временная метка или диапазон] факт, событие, вывод.
- [временная метка или диапазон] факт, событие, вывод.
- [временная метка или диапазон] факт, событие, вывод.
`.trim();

const COMPRESS_SYSTEM_MESSAGE_2 = `
Выпиши главную информацию из предоставленных сообщений.
`.trim();

async function compressMessages(messages: ChatItem[]): Promise<ChatSummary> {
  const messagesText: string[] = [];
  let dateFrom: Date | null = null;
  let dateTo: Date | null = null;
  let level: number | null = null;

  for (const message of messages) {
    if (message.type === "message") {
      const userMeta = `[USER, ${formatTimestamp(message.createdAt)}]`;
      const userStr = `${userMeta}\n\n${message.userContent}`;
      const assistantMeta = `[ASSISTANT, ${formatTimestamp(message.createdAt)}]`;
      const assistantStr = `${assistantMeta}\n\n${message.assistantContent}`;
      const fullStr = `${userStr}\n\n${assistantStr}`;
      messagesText.push(fullStr);
      dateFrom = dateFrom ?? message.createdAt;
      dateTo = message.createdAt;
      level = 0;
    }
    if (message.type === "summary") {
      const meta = `[SUMMARY, ${formatTimestamp(message.dateFrom)} - ${formatTimestamp(message.dateTo)}]`;
      const fullStr = `${meta}\n\n${message.content}`;
      messagesText.push(fullStr);
      dateFrom = dateFrom ?? message.dateFrom;
      dateTo = message.dateTo;
      level = message.level;
    }
  }

  if (dateFrom === null || dateTo === null || level === null) {
    throw new Error("Empty summary");
  }

  const result = await createChatCompletion({
    model: "gpt-4o",
    messages: [
      { role: "system", content: COMPRESS_SYSTEM_MESSAGE },
      { role: "user", content: messagesText.join("\n\n") },
      { role: "system", content: COMPRESS_SYSTEM_MESSAGE_2 },
    ],
    temperature: 0.0,
  });
  const resultText = result.choices[0].message.content;
  const embedding = await createTextEmbedding(resultText);
  const resultTokens = embedding.usage.total_tokens;

  return {
    type: "summary",
    timestamp: dateTo,
    id: uuidv4().toString(),
    dateFrom,
    dateTo,
    content: resultText,
    level: level + 1,
    tokensCount: resultTokens,
    parentId: "NULL",
  };
}

const MIN_SUMMARY_TOKENS = 4000;

function selectMessagesForSummary(chat: ChatItem[]): ChatItem[] {
  let startIndex: number | null = null;
  let endIndex: number | null = null;
  let level: number | null = null;
  let tokens = 0;

  for (let index = 0; index < chat.length; ++index) {
    const item = chat[index];
    let currentLevel: number;
    let currentTokens: number;

    if (item.type === "message") {
      currentLevel = 0;
      currentTokens = item.tokensCount;
    } else if (item.type === "summary") {
      currentLevel = item.level;
      currentTokens = item.tokensCount;
    } else {
      throw new Error();
    }

    if (currentLevel === level) {
      tokens += currentTokens;
    } else {
      level = currentLevel;
      tokens = currentTokens;
      startIndex = index;
    }

    if (startIndex !== null && tokens >= MIN_SUMMARY_TOKENS * 2) {
      const fullCount = index - startIndex + 1;
      const summaryCount = Math.ceil(fullCount / 2);
      endIndex = startIndex + summaryCount;
      break;
    }
  }

  if (startIndex !== null && endIndex !== null) {
    console.log("summary", level, startIndex, endIndex);
    return chat.slice(startIndex, endIndex);
  }

  return [];
}

export function usePostMessage() {
  const client = useQueryClient();
  const chat = useGetChat();

  const execute = useCallback(
    async (text: string) => {
      const timestamp = new Date();
      const newChat = await createCompletion(chat, text, timestamp);
      await compressChat(newChat);
      await client.invalidateQueries({ queryKey: ["chat"] });
    },
    [client, chat],
  );

  return { execute };
}

function formatTimestamp(dt: Date) {
  return format(dt, "EEEE, MMMM d, yyyy 'at' H:mm");
}
