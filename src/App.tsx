import {
  exportDataFromIndexedDB,
  importDataToIndexedDB,
  ImportedData,
} from "./db.ts";
import {
  ChatMessage,
  ChatSummary,
  setOpenAiApiKey,
  useGetChat,
  usePostMessage,
} from "./ai.ts";
import { MdDownload, MdSend, MdSettings, MdUpload } from "react-icons/md";
import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import TextareaAutosize from "react-textarea-autosize";
import { saveAs } from "file-saver";
import { useQueryClient } from "@tanstack/react-query";

const dateTimeFormat = new Intl.DateTimeFormat("ru", {
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

async function importData(file: File) {
  const jsonString = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e: ProgressEvent<FileReader>) => {
      if (e.target?.result) {
        resolve(e.target.result as string);
      }
    };
    reader.onerror = (error) => {
      reject(error);
    };
    reader.readAsText(file);
  });

  const importedData = JSON.parse(jsonString) as ImportedData;
  console.log("Импортированные данные:", importedData);
  await importDataToIndexedDB(importedData);
}

function useScroll(enabled: boolean) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!enabled) return;
    ref.current?.scrollIntoView({ behavior: "smooth" });
  }, [enabled]);

  return ref;
}

function MessageView({
  message,
  scroll,
}: {
  message: ChatMessage;
  scroll: boolean;
}) {
  const scrollRef = useScroll(scroll);

  return (
    <div ref={scrollRef}>
      <div className="px-2 py-2 bg-gray-50 border-b border-gray-300">
        <div className="pb-1 flex justify-between items-baseline">
          <span>USER </span>
          <span className="text-xs">
            {dateTimeFormat.format(message.timestamp)}
          </span>
        </div>
        <div className="whitespace-pre-wrap text-xs">{message.userContent}</div>
      </div>
      <div className="px-2 py-2 border-b border-gray-300">
        <div className="pb-1">ASSISTANT</div>
        <div className="whitespace-pre-wrap text-xs">
          {message.assistantContent}
        </div>
      </div>
    </div>
  );
}

function SummaryView({
  summary,
  scroll,
}: {
  summary: ChatSummary;
  scroll: boolean;
}) {
  const scrollRef = useScroll(scroll);

  return (
    <div
      className="px-2 py-2 border-b border-gray-300 bg-gray-50"
      ref={scrollRef}
    >
      <div className="pb-1 flex justify-between items-baseline">
        <span>SUMMARY </span>
        <span className="text-xs">
          {dateTimeFormat.format(summary.timestamp)}
        </span>
      </div>
      <div className="whitespace-pre-wrap text-xs">{summary.content}</div>
    </div>
  );
}

function HeaderView() {
  const queryClient = useQueryClient();

  const openSettings = () => {
    const key = prompt("OpenAI API Key");
    if (key) {
      setOpenAiApiKey(key);
    }
  };

  const importDb = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";

    input.onchange = async () => {
      try {
        const file = input.files?.item(0);
        if (file) await importData(file);
        await queryClient.invalidateQueries({
          queryKey: ["chat"],
        });
      } catch (error) {
        console.error("Failed to import data", error);
      }
    };

    try {
      document.body.appendChild(input);
      input.click();
    } finally {
      document.body.removeChild(input);
    }
  };

  const exportDb = async () => {
    const data = await exportDataFromIndexedDB();
    const str = JSON.stringify(data, null, 2);
    const blob = new Blob([str], { type: "application/json;charset=utf-8" });
    saveAs(blob, "journal.json");
  };

  return (
    <div className="sticky top-0 bg-white shadow px-2 py-1 flex items-center gap-2">
      <div className="flex-1">GPT Journal</div>
      <button
        className="p-2 bg-gray-100 rounded active:bg-gray-400"
        onClick={exportDb}
      >
        <MdDownload />
      </button>
      <button
        className="p-2 bg-gray-100 rounded active:bg-gray-400"
        onClick={importDb}
      >
        <MdUpload />
      </button>
      <button
        className="p-2 bg-gray-100 rounded active:bg-gray-400"
        onClick={openSettings}
      >
        <MdSettings />
      </button>
    </div>
  );
}

function ChatView() {
  const chat = useGetChat();

  return (
    <div className="min-h-screen">
      {chat.map((item, index) => {
        if (item.type === "message")
          return (
            <MessageView
              key={item.id}
              message={item}
              scroll={index === chat.length - 1}
            />
          );
        if (item.type === "summary")
          return (
            <SummaryView
              key={item.id}
              summary={item}
              scroll={index === chat.length - 1}
            />
          );
        return null;
      })}
    </div>
  );
}

function NewMessageView() {
  const [value, setValue] = useState("");
  const [isSending, setSending] = useState(false);
  const canSend = value.trim() !== "" && !isSending;

  const { execute: postMessage } = usePostMessage();

  const send = async () => {
    try {
      setSending(true);
      await postMessage(value);
      setValue("");
    } catch (e) {
      console.error("Failed to send message", e);
      alert("Ошибка при отправке сообщения");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="sticky bottom-0 bg-white px-2 py-2 flex gap-2 items-start">
      <TextareaAutosize
        className="flex-1 border border-gray-300 rounded px-2 py-1 text-base"
        placeholder="Сообщение"
        minRows={2}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button
        className={clsx({
          "flex-0 p-2 rounded": true,
          "bg-gray-300": !canSend,
          "bg-blue-300": canSend,
        })}
        disabled={!canSend}
        onClick={send}
      >
        <MdSend />
      </button>
    </div>
  );
}

function App() {
  return (
    <div>
      <HeaderView />
      <ChatView />
      <NewMessageView />
    </div>
  );
}

export default App;
