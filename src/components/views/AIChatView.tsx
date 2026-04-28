import { useState, useRef, useEffect } from "react";
import { useAppStore } from "../../store";
import * as api from "../../api";
import type { ChatMessage, QuizQuestion } from "../../types";
import {
  Loader2,
  Send,
  Trash2,
  Lightbulb,
  HelpCircle,
  Bot,
  User,
  Sparkles,
} from "lucide-react";
import clsx from "clsx";

type ChatMode = "chat" | "trivia" | "quiz";

export function AIChatView() {
  const {
    chatMessages,
    addChatMessage,
    clearChatMessages,
    chatLoading,
    setChatLoading,
    currentTrack,
  } = useAppStore();

  const [input, setInput] = useState("");
  const [mode, setMode] = useState<ChatMode>("chat");
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>([]);
  const [quizIndex, setQuizIndex] = useState(0);
  const [quizAnswer, setQuizAnswer] = useState<number | null>(null);
  const [quizScore, setQuizScore] = useState(0);
  const [quizLoading, setQuizLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  const sendMessage = async () => {
    if (!input.trim() || chatLoading) return;
    const userMsg: ChatMessage = {
      role: "user",
      content: input.trim(),
      timestamp: new Date().toISOString(),
    };
    addChatMessage(userMsg);
    setInput("");
    setChatLoading(true);

    try {
      const response = await api.aiChatSend(userMsg.content, chatMessages);
      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: response,
        timestamp: new Date().toISOString(),
      };
      addChatMessage(assistantMsg);
    } catch (err) {
      const errorMsg: ChatMessage = {
        role: "assistant",
        content: `Error: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: new Date().toISOString(),
      };
      addChatMessage(errorMsg);
    } finally {
      setChatLoading(false);
    }
  };

  const loadTrivia = async () => {
    if (!currentTrack) return;
    setChatLoading(true);
    const title = currentTrack.title;
    const artist = currentTrack.artist;
    addChatMessage({
      role: "user",
      content: `Tell me trivia about "${title}" by ${artist}`,
      timestamp: new Date().toISOString(),
    });

    try {
      const trivia = await api.aiChatTrivia(title, artist);
      const triviaText = [
        `🎵 **${title}** by **${artist}**`,
        "",
        trivia.album ? `📀 Album: ${trivia.album}` : "",
        trivia.year_released ? `📅 Year: ${trivia.year_released}` : "",
        "",
        ...(trivia.facts || []).map((f: string) => `• ${f}`),
        "",
        trivia.fun_fact ? `🎉 Fun fact: ${trivia.fun_fact}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      addChatMessage({
        role: "assistant",
        content: triviaText,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      addChatMessage({
        role: "assistant",
        content: `Could not get trivia: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: new Date().toISOString(),
      });
    } finally {
      setChatLoading(false);
    }
  };

  const startQuiz = async () => {
    setMode("quiz");
    setQuizLoading(true);
    setQuizQuestions([]);
    setQuizIndex(0);
    setQuizAnswer(null);
    setQuizScore(0);

    try {
      const questions = await api.aiChatQuiz();
      setQuizQuestions(questions);
    } catch (err) {
      addChatMessage({
        role: "assistant",
        content: `Quiz error: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: new Date().toISOString(),
      });
      setMode("chat");
    } finally {
      setQuizLoading(false);
    }
  };

  const answerQuiz = (optionIndex: number) => {
    if (quizAnswer !== null) return; // already answered
    setQuizAnswer(optionIndex);
    const q = quizQuestions[quizIndex];
    if (optionIndex === q.correct) {
      setQuizScore((s) => s + 1);
    }
  };

  const nextQuizQuestion = () => {
    if (quizIndex < quizQuestions.length - 1) {
      setQuizIndex((i) => i + 1);
      setQuizAnswer(null);
    } else {
      // Quiz complete
      addChatMessage({
        role: "assistant",
        content: `🏆 Quiz complete! You scored **${quizScore + (quizAnswer === quizQuestions[quizIndex]?.correct ? 1 : 0)}/${quizQuestions.length}**`,
        timestamp: new Date().toISOString(),
      });
      setMode("chat");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="flex flex-col h-full max-h-[calc(100vh-12rem)]">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Bot className="w-6 h-6 text-ytm-accent" /> AI Chat
          </h2>
          <p className="text-ytm-text-secondary text-sm">
            Ask about music, get recommendations, trivia & quizzes
          </p>
        </div>
        <div className="flex items-center gap-2">
          {currentTrack && (
            <button
              onClick={loadTrivia}
              disabled={chatLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-ytm-surface text-sm rounded-lg hover:bg-ytm-surface-hover text-ytm-text-secondary hover:text-white transition-colors disabled:opacity-50"
              title="Get trivia about current track"
            >
              <Lightbulb className="w-4 h-4" />
              Trivia
            </button>
          )}
          <button
            onClick={startQuiz}
            disabled={chatLoading || quizLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-ytm-surface text-sm rounded-lg hover:bg-ytm-surface-hover text-ytm-text-secondary hover:text-white transition-colors disabled:opacity-50"
          >
            <HelpCircle className="w-4 h-4" />
            Quiz
          </button>
          <button
            onClick={clearChatMessages}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-ytm-surface text-sm rounded-lg hover:bg-ytm-surface-hover text-ytm-text-secondary hover:text-white transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            Clear
          </button>
        </div>
      </div>

      {/* Quiz mode */}
      {mode === "quiz" && (
        <div className="mb-4">
          {quizLoading ? (
            <div className="bg-ytm-surface rounded-xl p-8 border border-ytm-border flex items-center justify-center gap-3">
              <Loader2 className="w-5 h-5 animate-spin text-ytm-accent" />
              <span className="text-ytm-text-secondary">Generating quiz from your library...</span>
            </div>
          ) : quizQuestions.length > 0 && (
            <div className="bg-ytm-surface rounded-xl p-6 border border-ytm-border">
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs text-ytm-text-secondary">
                  Question {quizIndex + 1}/{quizQuestions.length}
                </span>
                <span className="text-xs text-ytm-accent">Score: {quizScore}</span>
              </div>
              <h3 className="text-lg font-semibold mb-4">{quizQuestions[quizIndex].question}</h3>
              <div className="grid grid-cols-1 gap-2 mb-4">
                {quizQuestions[quizIndex].options.map((opt, i) => (
                  <button
                    key={i}
                    onClick={() => answerQuiz(i)}
                    disabled={quizAnswer !== null}
                    className={clsx(
                      "text-left px-4 py-3 rounded-lg text-sm transition-colors border",
                      quizAnswer === null
                        ? "bg-ytm-bg border-ytm-border hover:border-ytm-accent hover:bg-ytm-surface-hover"
                        : i === quizQuestions[quizIndex].correct
                        ? "bg-green-500/20 border-green-500/50 text-green-400"
                        : i === quizAnswer
                        ? "bg-red-500/20 border-red-500/50 text-red-400"
                        : "bg-ytm-bg border-ytm-border opacity-50"
                    )}
                  >
                    {opt}
                  </button>
                ))}
              </div>
              {quizAnswer !== null && (
                <div className="space-y-3">
                  <p className="text-sm text-ytm-text-secondary">
                    {quizQuestions[quizIndex].explanation}
                  </p>
                  <button
                    onClick={nextQuizQuestion}
                    className="px-4 py-2 bg-ytm-accent text-white rounded-lg hover:bg-ytm-accent/80 text-sm"
                  >
                    {quizIndex < quizQuestions.length - 1 ? "Next Question" : "Finish Quiz"}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Chat messages */}
      <div className="flex-1 overflow-y-auto bg-ytm-surface rounded-xl border border-ytm-border p-4 mb-4 space-y-4">
        {chatMessages.length === 0 && mode === "chat" && (
          <div className="h-full flex flex-col items-center justify-center text-center text-ytm-text-secondary">
            <Sparkles className="w-12 h-12 mb-4 text-ytm-accent opacity-50" />
            <p className="text-lg font-semibold mb-2">Music AI Assistant</p>
            <p className="text-sm max-w-md">
              Ask me anything about music! Try "What genre is my library mostly?", "Recommend something new", or use the Trivia and Quiz buttons.
            </p>
            <div className="mt-4 flex flex-wrap gap-2 justify-center">
              {["What's trending in my library?", "Suggest a new artist", "Tell me a music fun fact"].map(
                (prompt) => (
                  <button
                    key={prompt}
                    onClick={() => {
                      setInput(prompt);
                    }}
                    className="px-3 py-1.5 bg-ytm-bg rounded-full text-xs hover:bg-ytm-surface-hover transition-colors"
                  >
                    {prompt}
                  </button>
                )
              )}
            </div>
          </div>
        )}

        {chatMessages.map((msg, i) => (
          <div
            key={i}
            className={clsx(
              "flex gap-3",
              msg.role === "user" ? "flex-row-reverse" : ""
            )}
          >
            <div
              className={clsx(
                "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
                msg.role === "user" ? "bg-ytm-accent" : "bg-ytm-bg"
              )}
            >
              {msg.role === "user" ? (
                <User className="w-4 h-4 text-white" />
              ) : (
                <Bot className="w-4 h-4 text-ytm-accent" />
              )}
            </div>
            <div
              className={clsx(
                "max-w-[75%] rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap",
                msg.role === "user"
                  ? "bg-ytm-accent text-white rounded-tr-sm"
                  : "bg-ytm-bg text-ytm-text rounded-tl-sm"
              )}
            >
              {msg.content}
            </div>
          </div>
        ))}

        {chatLoading && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-ytm-bg flex items-center justify-center shrink-0">
              <Bot className="w-4 h-4 text-ytm-accent" />
            </div>
            <div className="bg-ytm-bg rounded-2xl rounded-tl-sm px-4 py-3">
              <div className="flex items-center gap-2 text-ytm-text-secondary text-sm">
                <Loader2 className="w-4 h-4 animate-spin" />
                Thinking...
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about music, your library, or anything..."
          disabled={chatLoading}
          className="flex-1 bg-ytm-bg border border-ytm-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-ytm-accent placeholder:text-ytm-text-secondary disabled:opacity-50"
        />
        <button
          onClick={sendMessage}
          disabled={!input.trim() || chatLoading}
          className="px-4 py-3 bg-ytm-accent text-white rounded-xl hover:bg-ytm-accent/80 disabled:opacity-50 transition-colors"
        >
          <Send className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}
