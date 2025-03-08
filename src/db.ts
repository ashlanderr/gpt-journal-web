import { openDB } from "idb";

export function initDB() {
  const request = indexedDB.open("gpt_journal", 1);

  request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
    const db = (event.target as IDBOpenDBRequest).result;

    if (!db.objectStoreNames.contains("summary")) {
      const summaryStore = db.createObjectStore("summary", { keyPath: "id" });
      summaryStore.createIndex("parentId", "parentId", { unique: false });
    }

    if (!db.objectStoreNames.contains("message")) {
      const messageStore = db.createObjectStore("message", { keyPath: "id" });
      messageStore.createIndex("summaryId", "summaryId", { unique: false });
    }
  };

  request.onsuccess = () => {
    console.log("IndexedDB successfully initialized");
  };

  request.onerror = (event) => {
    console.error("Error initializing IndexedDB:", (event.target as any).error);
  };
}

interface ImportedMessage {
  id: string;
  created_at: string;
  user_content: string;
  assistant_content: string;
  tokens_count: number;
  summary_id: string | null;
}

interface ImportedSummary {
  id: string;
  date_from: string;
  date_to: string;
  content: string;
  level: number;
  tokens_count: number;
  parent_id: string | null;
}

export interface ImportedData {
  version: string;
  data: {
    message: ImportedMessage[];
    summary: ImportedSummary[];
  };
}

export interface DBMessage {
  id: string;
  createdAt: Date;
  userContent: string;
  assistantContent: string;
  tokensCount: number;
  summaryId: string | "NULL";
}

export interface DBSummary {
  id: string;
  dateFrom: Date;
  dateTo: Date;
  content: string;
  level: number;
  tokensCount: number;
  parentId: string | "NULL";
}

export async function importDataToIndexedDB(
  importedData: ImportedData,
): Promise<void> {
  const convertedData = convertImportedData(importedData);
  const db = await openDB("gpt_journal", 1);
  const transaction = db.transaction(["summary", "message"], "readwrite");
  const summaryStore = transaction.objectStore("summary");
  const messageStore = transaction.objectStore("message");

  await summaryStore.clear();
  await messageStore.clear();

  for (const summary of convertedData.summary) {
    await summaryStore.put(summary);
  }

  for (const message of convertedData.message) {
    await messageStore.put(message);
  }
}

export async function exportDataFromIndexedDB(): Promise<ImportedData> {
  const db = await openDB("gpt_journal", 1);
  const transaction = db.transaction(["summary", "message"], "readonly");
  const summaryStore = transaction.objectStore("summary");
  const messageStore = transaction.objectStore("message");

  const result: ImportedData = {
    version: "1",
    data: {
      summary: [],
      message: [],
    },
  };

  for await (const cursor of summaryStore) {
    const summary = cursor.value as DBSummary;
    result.data.summary.push({
      id: summary.id,
      date_from: summary.dateFrom.toISOString(),
      date_to: summary.dateTo.toISOString(),
      content: summary.content,
      level: summary.level,
      tokens_count: summary.tokensCount,
      parent_id: summary.parentId !== "NULL" ? summary.parentId : null,
    });
  }

  for await (const cursor of messageStore) {
    const message = cursor.value as DBMessage;
    result.data.message.push({
      id: message.id,
      created_at: message.createdAt.toISOString(),
      user_content: message.userContent,
      assistant_content: message.assistantContent,
      tokens_count: message.tokensCount,
      summary_id: message.summaryId !== "NULL" ? message.summaryId : null,
    });
  }

  return result;
}

function convertImportedData(importedData: ImportedData): {
  message: DBMessage[];
  summary: DBSummary[];
} {
  const dbMessages: DBMessage[] = importedData.data.message.map((msg) => ({
    id: msg.id,
    createdAt: new Date(msg.created_at),
    userContent: msg.user_content,
    assistantContent: msg.assistant_content,
    tokensCount: msg.tokens_count,
    summaryId: msg.summary_id ?? "NULL",
  }));

  const dbSummaries: DBSummary[] = importedData.data.summary.map((sum) => ({
    id: sum.id,
    dateFrom: new Date(sum.date_from),
    dateTo: new Date(sum.date_to),
    content: sum.content,
    level: sum.level,
    tokensCount: sum.tokens_count,
    parentId: sum.parent_id ?? "NULL",
  }));

  return { message: dbMessages, summary: dbSummaries };
}

export function getActiveMessages(): Promise<DBMessage[]> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("gpt_journal", 1);

    request.onerror = () => {
      reject(request.error);
    };

    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction("message", "readonly");
      const store = transaction.objectStore("message");

      const index = store.index("summaryId");
      const keyRange = IDBKeyRange.only("NULL");
      const messages: DBMessage[] = [];

      const cursorRequest = index.openCursor(keyRange);
      cursorRequest.onerror = () => {
        reject(cursorRequest.error);
      };

      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (cursor) {
          messages.push(cursor.value);
          cursor.continue();
        } else {
          resolve(messages);
        }
      };
    };
  });
}

export function getActiveSummaries(): Promise<DBSummary[]> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("gpt_journal", 1);

    request.onerror = () => {
      reject(request.error);
    };

    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction("summary", "readonly");
      const store = transaction.objectStore("summary");

      const index = store.index("parentId");
      const keyRange = IDBKeyRange.only("NULL");
      const summaries: DBSummary[] = [];

      const cursorRequest = index.openCursor(keyRange);
      cursorRequest.onerror = () => {
        reject(cursorRequest.error);
      };

      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (cursor) {
          summaries.push(cursor.value);
          cursor.continue();
        } else {
          resolve(summaries);
        }
      };
    };
  });
}

export function updateData(
  summaries: DBSummary[],
  messages: DBMessage[],
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("gpt_journal", 1);

    request.onerror = () => {
      console.error("Ошибка открытия IndexedDB:", request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      const db = request.result;

      const transaction = db.transaction(["summary", "message"], "readwrite");

      transaction.onerror = () => {
        reject(transaction.error);
      };

      transaction.oncomplete = () => {
        resolve();
      };

      const summaryStore = transaction.objectStore("summary");
      const messageStore = transaction.objectStore("message");

      // Вставляем данные в хранилище summary
      summaries.forEach((summaryItem) => {
        summaryStore.put(summaryItem);
      });

      // Вставляем данные в хранилище message
      messages.forEach((messageItem) => {
        messageStore.put(messageItem);
      });
    };
  });
}
