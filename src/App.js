import React, { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

// Simple taahAI-like clone in a single file (App.js)
// - One conversation pane
// - Input + Send button at the bottom
// - Posts to your API and renders Markdown
// - No TS, no extra installs; load small helpers from a CDN at runtime

function App() {
  // API endpoint for your backend. Update if needed.
  const API_URL = useMemo(() => {
    // Defaults to your provided webhook; can be overridden via env if desired
    return process.env.REACT_APP_API_URL || "https://n8n.taaha.in/webhook/taahAI";
  }, []);

  // Generate a fresh UUID v4 per page load for session tracking
  const sessionId = useMemo(() => {
    // Prefer native crypto.randomUUID when available
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    // RFC 4122 v4 fallback using crypto.getRandomValues if possible
    const bytes = new Uint8Array(16);
    if (window.crypto && typeof window.crypto.getRandomValues === "function") {
      window.crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < 16; i += 1) {
        bytes[i] = Math.floor(Math.random() * 256);
      }
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
    const toHex = (n) => n.toString(16).padStart(2, "0");
    const hex = Array.from(bytes, toHex).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }, []);

  // Conversation state: array of { role: "user" | "assistant", content: string }
  const [messages, setMessages] = useState([]);

  // Input box content
  const [input, setInput] = useState("");

  // UI state
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [loaderDots, setLoaderDots] = useState("");

  // Refs for auto-scroll and external libs
  const chatEndRef = useRef(null);
  const markedReadyRef = useRef(false);
  const purifyReadyRef = useRef(false);

  // Auto-scroll to the latest message
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, loading]);

  // Load a tiny Markdown parser and sanitizer from CDN (no installs)
  useEffect(() => {
    // Helper to add a script tag only once
    const addScript = (src, onLoad) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        if (onLoad) existing.addEventListener("load", onLoad);
        return;
      }
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      if (onLoad) s.addEventListener("load", onLoad);
      document.body.appendChild(s);
    };

    // Load marked for Markdown rendering
    addScript("https://cdn.jsdelivr.net/npm/marked/marked.min.js", () => {
      // Configure marked to avoid raw HTML by default
      if (window.marked && typeof window.marked.setOptions === "function") {
        window.marked.setOptions({ breaks: true, gfm: true });
      }
      markedReadyRef.current = true;
    });

    // Load DOMPurify for sanitization
    addScript(
      "https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.min.js",
      () => {
        purifyReadyRef.current = true;
      }
    );
  }, []);

  // Simple animated dots for a loader while waiting for API
  useEffect(() => {
    if (!loading) {
      setLoaderDots("");
      return undefined;
    }
    const id = setInterval(() => {
      setLoaderDots((prev) => (prev.length >= 3 ? "" : `${prev}.`));
    }, 400);
    return () => clearInterval(id);
  }, [loading]);

  // Suggested prompts: 3 categories, 3 examples each
  const suggestedPrompts = useMemo(
    () => [
      {
        category: "General & High-Level",
        items: [
          "Can you give me a brief overview of your professional experience?",
          "Tell me about yourself and your background.",
          "What are your key technical skills?",
        ],
      },
      {
        category: "Project Deep Dives",
        items: [
          "Can you walk me through a project you're particularly proud of?",
          "Tell me about the most technically challenging project you've worked on.",
          "What was the business impact or result working at recent company?",
        ],
      },
      {
        category: "Behavioral & Career Goals",
        items: [
          "What are you looking for in your next role?",
          "What kind of team environment do you thrive in?",
          "How do you handle tight deadlines or high-pressure situations?",
        ],
      },
    ],
    []
  );

  // Send quick prompt immediately
  const quickSend = (text) => {
    if (loading) return;
    setInput(text);
    void sendMessage(text);
  };

  // Safely render Markdown to HTML
  const renderMarkdown = (mdText) => {
    // Basic fallback: escape HTML if libraries are not ready yet
    const escapeHtml = (raw) =>
      raw
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");

    try {
      const parsed = markedReadyRef.current && window.marked
        ? window.marked.parse(mdText)
        : `<pre>\n${escapeHtml(mdText)}\n</pre>`;

      const sanitized = purifyReadyRef.current && window.DOMPurify
        ? window.DOMPurify.sanitize(parsed)
        : parsed;

      return { __html: sanitized };
    } catch (err) {
      // On any render error, return escaped plaintext
      return { __html: `<pre>\n${escapeHtml(mdText)}\n</pre>` };
    }
  };

  // Send message to your API
  const sendMessage = async (overrideText) => {
    // Trim whitespace and prevent empty submissions
    const textSource = typeof overrideText === "string" ? overrideText : input;
    const text = textSource.trim();
    if (text.length === 0 || loading) {
      return;
    }

    setErrorText("");
    setLoading(true);

    // Optimistically add the user message
    const nextMessages = [...messages, { role: "user", content: text }];
    setMessages(nextMessages);
    setInput("");

    try {
      // Prepare payload to match your cURL contract
      const payload = {
        session: sessionId,
        message: text,
      };

      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      // Handle non-OK HTTP status codes explicitly
      if (!response.ok) {
        const hint = `${response.status} ${response.statusText}`;
        throw new Error(`Request failed (${hint})`);
      }

      // Try to parse either JSON or raw text and extract human text only
      const contentType = response.headers.get("content-type") || "";
      let markdownReply = "";
      const extractText = (val) => {
        if (typeof val === "string") return val;
        if (Array.isArray(val) && val.length > 0) return extractText(val[0]);
        if (val && typeof val === "object") {
          const keys = [
            "output",
            "reply",
            "message",
            "content",
            "text",
            "result",
          ];
          for (const k of keys) {
            if (typeof val[k] === "string") return val[k];
          }
        }
        return undefined;
      };

      if (contentType.includes("application/json")) {
        const data = await response.json();
        markdownReply = extractText(data);
        if (typeof markdownReply !== "string") {
          markdownReply = JSON.stringify(data);
        }
      } else {
        const raw = await response.text();
        // Some servers send JSON with text/plain
        try {
          const maybe = JSON.parse(raw);
          const picked = extractText(maybe);
          markdownReply = typeof picked === "string" ? picked : raw;
        } catch (_e) {
          markdownReply = raw;
        }
      }

      // Append assistant reply
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: String(markdownReply) },
      ]);
    } catch (err) {
      // Show a friendly error message in the conversation
      const friendly = `Sorry, I could not reach the API. ${err.message}`;
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: friendly },
      ]);
      setErrorText(friendly);
    } finally {
      setLoading(false);
    }
  };

  // Handle Enter to send and Shift+Enter for newline
  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  };

  // Styling inspired by the screenshot: dark slate, subtle teal accents
  const styles = {
    app: {
      height: "100vh",
      width: "100vw",
      background: "#0e0f13",
      color: "#e5e7eb",
      display: "flex",
      flexDirection: "column",
    },
    topBar: {
      height: "56px",
      display: "flex",
      alignItems: "center",
      paddingLeft: "14px",
      color: "#e6e6e7",
      gap: "10px",
    },
    topBrand: {
      fontSize: "20px",
      fontWeight: 600,
      letterSpacing: "0.2px",
      opacity: 0.95,
    },
    favicon: {
      width: "20px",
      height: "20px",
      borderRadius: "4px",
    },
    chat: {
      flex: 1,
      overflowY: "auto",
      padding: "20px 16px 140px 16px",
    },
    chatInner: {
      width: "min(980px, 92vw)",
      margin: "0 auto",
    },
    hero: {
      flex: 1,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: "18px",
    },
    heroTitle: {
      fontSize: "36px",
      color: "#f2f3f5",
      textAlign: "center",
      fontWeight: 600,
    },
    suggestWrap: {
      width: "min(980px, 92vw)",
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
      gap: "10px",
    },
    suggestGroup: {
      background: "#1a1b20",
      border: "1px solid #2a2b31",
      borderRadius: "12px",
      padding: "12px",
    },
    suggestTitle: {
      fontSize: "12px",
      color: "#aeb1b5",
      marginBottom: "8px",
      textTransform: "uppercase",
      letterSpacing: "0.6px",
    },
    suggestItem: {
      display: "inline-block",
      margin: "4px 6px 0 0",
      padding: "8px 10px",
      background: "#22232a",
      border: "1px solid #2e2f37",
      borderRadius: "999px",
      fontSize: "13px",
      color: "#dee0e3",
      cursor: "pointer",
      userSelect: "none",
    },
    row: {
      width: "100%",
      display: "flex",
      marginBottom: "12px",
    },
    rowUser: {
      justifyContent: "flex-end",
    },
    rowAssistant: {
      justifyContent: "flex-start",
    },
    bubble: {
      display: "inline-block",
      maxWidth: "min(720px, 90vw)",
      width: "auto",
      whiteSpace: "pre-wrap",
      wordBreak: "break-word",
      borderRadius: "20px",
      padding: "12px 16px",
      boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
      lineHeight: 1.6,
      fontSize: "15px",
    },
    bubbleAssistant: {
      background: "#1f2024",
      border: "1px solid #2a2b31",
      display: "block",
      width: "100%",
      borderRadius: "16px",
    },
    bubbleUser: {
      background: "#2a2b31",
      border: "1px solid #3a3b41",
      color: "#f5f6f7",
    },
    inputBar: {
      position: "fixed",
      left: 0,
      right: 0,
      bottom: 0,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "16px 12px 20px 12px",
      background: "linear-gradient(180deg, rgba(14,15,19,0) 0%, #0e0f13 60%)",
    },
    pill: {
      width: "min(980px, 92vw)",
      display: "flex",
      alignItems: "center",
      gap: "10px",
      background: "#1f2024",
      border: "1px solid #2a2b31",
      borderRadius: "999px",
      padding: "16px 14px 10px 22px",
      boxShadow: "0 2px 12px rgba(0,0,0,0.35)",
    },
    iconCircle: {
      width: "28px",
      height: "28px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "#2a2b31",
      border: "1px solid #3a3b41",
      borderRadius: "999px",
      color: "#d7d9dc",
      fontSize: "14px",
      flexShrink: 0,
      userSelect: "none",
    },
    textarea: {
      flex: 1,
      resize: "none",
      minHeight: "28px",
      maxHeight: "200px",
      border: "none",
      outline: "none",
      padding: "8px 6px",
      fontSize: "15px",
      background: "transparent",
      color: "#e9eaeb",
    },
    sendIconBtn: {
      width: "36px",
      height: "36px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      borderRadius: "999px",
      border: "1px solid #3a3b41",
      background: loading ? "#3a3b41" : "#2a2b31",
      color: "#ffffff",
      cursor: loading ? "default" : "pointer",
      opacity: loading ? 0.7 : 1,
      flexShrink: 0,
    },
    helper: {
      color: "#9aa0a6",
      fontSize: "12px",
      marginTop: "2px",
      textAlign: "center",
    },
    markdown: {
      // Some basic markdown styling
    },
    error: {
      color: "#fca5a5",
      fontSize: "12px",
      marginTop: "4px",
      textAlign: "center",
    },
  };

  return (
    <div style={styles.app}>
      <div style={styles.topBar}>
        <img src={"https://taaha.in/favicon.ico"} alt="taahAI" style={styles.favicon} />
        <span style={styles.topBrand}>taahAI</span>
      </div>

      {messages.length === 0 ? (
        <div style={styles.hero}>
          <div style={styles.heroTitle}>What should we talk about?</div>
          <div style={styles.suggestWrap}>
            {suggestedPrompts.map((group, gi) => (
              <div key={`sg-${gi}`} style={styles.suggestGroup}>
                <div style={styles.suggestTitle}>{group.category}</div>
                <div>
                  {group.items.map((it, ii) => (
                    <span
                      key={`it-${gi}-${ii}`}
                      style={styles.suggestItem}
                      onClick={() => quickSend(it)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") quickSend(it);
                      }}
                    >
                      {it}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div style={styles.pill}>
            <textarea
              aria-label="Your message"
              placeholder="Ask anything"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              style={styles.textarea}
            />
            <button
              type="button"
              onClick={() => void sendMessage()}
              disabled={loading || input.trim().length === 0}
              style={styles.sendIconBtn}
              title={loading ? "Sending..." : "Send"}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M5 12h11" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                <path d="M12 5l7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
          {errorText ? <div style={styles.error}>{errorText}</div> : null}
          <div style={styles.helper}>{"Enter to send • Shift+Enter for newline"}</div>
        </div>
      ) : (
        <>
          <div style={styles.chat}>
            <div style={styles.chatInner}>
            {messages.map((m, idx) => {
              const isUser = m.role === "user";
              return (
                <div
                  key={`msg-${idx}`}
                  style={{
                    ...styles.row,
                    ...(isUser ? styles.rowUser : styles.rowAssistant),
                  }}
                >
                  <div
                    style={{
                      ...styles.bubble,
                      ...(isUser ? styles.bubbleUser : styles.bubbleAssistant),
                    }}
                  >
                    <div
                      style={styles.markdown}
                      dangerouslySetInnerHTML={renderMarkdown(m.content)}
                    />
                  </div>
                </div>
              );
            })}
            {loading ? (
              <div style={{ ...styles.row, ...styles.rowAssistant }}>
                <div style={{ ...styles.bubble, ...styles.bubbleAssistant }}>
                  {`Thinking${loaderDots}`}
                </div>
              </div>
            ) : null}
            <div ref={chatEndRef} />
            </div>
          </div>

          <div style={styles.inputBar}>
            <div style={styles.pill}>
              <textarea
                aria-label="Your message"
                placeholder={loading ? "Waiting for reply..." : "Message taahAI"}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                rows={1}
                style={styles.textarea}
              />
              <button
                type="button"
                onClick={() => void sendMessage()}
                disabled={loading || input.trim().length === 0}
                style={styles.sendIconBtn}
                title={loading ? "Sending..." : "Send"}
              >
                {/* simple arrow */}
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M5 12h11" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  <path d="M12 5l7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </div>
          </div>
          {errorText ? <div style={styles.error}>{errorText}</div> : null}
          <div style={styles.helper}>{"Enter to send • Shift+Enter for newline"}</div>
        </>
      )}
    </div>
  );
}

export default App;
