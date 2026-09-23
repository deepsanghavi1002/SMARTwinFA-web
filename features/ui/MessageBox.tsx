"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

/**
 * The program's one message box (the desktop's CustomMessageBoxForm), for every screen.
 *
 *   await messageBox.ask("Save changes?", "Master Save", ["Yes", "No", "Cancel"])  -> "Yes" | "No" | "Cancel"
 *   await messageBox.confirm("Delete this row?")                                     -> true | false
 *   await messageBox.alert("Saved.", "Master Save")
 *   await messageBox.prompt("Enter Password", "Password", { password: true })       -> string | null
 *
 * <MessageBoxHost /> is mounted once in app/layout.tsx. Messages asked while one is open wait
 * their turn. Keys: Enter presses the focused button, Y / N / O / C press Yes / No / OK /
 * Cancel, Left / Right move between buttons, and Esc answers Cancel, else No, else OK. When the
 * box closes, the keyboard goes back to whatever had it before (an open cell editor, the grid).
 */

export type MessageButton = "OK" | "Yes" | "No" | "Cancel";
export type MessageKind = "info" | "question" | "warning" | "error";
export type MessageOptions = {
  title?: string;
  message: string;
  buttons?: MessageButton[];
  kind?: MessageKind;
  /** The button Enter presses (focused when the box opens); the first one when not given. */
  defaultButton?: MessageButton;
  /** Shows a text box; its text comes back with the answer. */
  input?: "text" | "password";
};
type Request = Required<Pick<MessageOptions, "title" | "message" | "buttons" | "kind">> & {
  id: number;
  input?: "text" | "password";
  defaultButton: MessageButton;
  returnFocus: HTMLElement | null;
  resolve: (answer: { button: MessageButton; text: string }) => void;
};

let queue: Request[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const publish = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const current = () => queue[0] ?? null;

/** A title that names a failure or a rule reads as an error or warning; Yes/No reads as a question. */
function guessKind(title: string, buttons: MessageButton[]): MessageKind {
  if (buttons.includes("Yes")) return "question";
  if (/error|fail|invalid/i.test(title)) return "error";
  if (/warn|validation|not allowed|duplicate|compulsory|length|range|must|positive|rights/i.test(title)) return "warning";
  return "info";
}

export function showMessage(options: MessageOptions): Promise<{ button: MessageButton; text: string }> {
  const buttons = options.buttons?.length ? options.buttons : ["OK" as const];
  const title = options.title ?? "Message";
  return new Promise((resolve) => {
    queue = [...queue, {
      id: nextId++,
      title,
      message: options.message,
      buttons,
      kind: options.kind ?? guessKind(title, buttons),
      input: options.input,
      defaultButton: options.defaultButton && buttons.includes(options.defaultButton) ? options.defaultButton : buttons[0],
      returnFocus: typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null),
      resolve,
    }];
    publish();
  });
}

/** Answers the message on show and lets the next one in; the keyboard goes back where it was. */
function answerCurrent(button: MessageButton, text: string) {
  const request = queue[0];
  if (!request) return;
  queue = queue.slice(1);
  publish();
  request.resolve({ button, text });
  // Give the keyboard back to what had it (the cell editor, the grid) unless the next message took it.
  const back = request.returnFocus;
  setTimeout(() => { if (queue.length === 0 && back && back.isConnected) back.focus({ preventScroll: true }); }, 0);
}

/** True while a message box is showing, so screens can leave its keys alone. */
export const isMessageBoxOpen = () => queue.length > 0;

export const messageBox = {
  ask: (message: string, title = "Message", buttons: MessageButton[] = ["OK"], options: { kind?: MessageKind; defaultButton?: MessageButton } = {}) =>
    showMessage({ message, title, buttons, ...options }).then((answer) => answer.button),
  confirm: (message: string, title = "Confirmation") =>
    showMessage({ message, title, buttons: ["Yes", "No"] }).then((answer) => answer.button === "Yes"),
  alert: (message: string, title = "Message", kind?: MessageKind) =>
    showMessage({ message, title, buttons: ["OK"], kind }).then(() => undefined),
  prompt: (message: string, title = "Input", options: { password?: boolean } = {}) =>
    showMessage({ message, title, buttons: ["OK", "Cancel"], input: options.password ? "password" : "text" })
      .then((answer) => (answer.button === "OK" ? answer.text : null)),
};

const ICON_PATH: Record<MessageKind, string> = {
  info: "M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20zM12 11v6M12 7h.01",
  question: "M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20zM9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4.5M12 17.5h.01",
  warning: "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01",
  error: "M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20zM15 9l-6 6M9 9l6 6",
};
const BUTTON_CLASS: Record<MessageButton, string> = { Yes: "msgbox-yes", OK: "msgbox-yes", No: "msgbox-no", Cancel: "msgbox-cancel" };
const BUTTON_KEY: Record<MessageButton, string> = { Yes: "y", No: "n", OK: "o", Cancel: "c" };

export function MessageBoxHost() {
  const request = useSyncExternalStore(subscribe, current, () => null);
  const box = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLInputElement>(null);

  // Focus the text box, else the first button, each time a new message shows; and take its
  // keys directly on the box, so none of them reaches the screen behind it (whose Esc asks to leave).
  useEffect(() => {
    const element = box.current;
    if (!request || !element) return;
    // A tick later, so the Enter that raised the message (Firefox clicks a button on keypress,
    // after keydown) cannot land on the new button and close it at once.
    const focusTimer = setTimeout(() => (text.current ?? element.querySelector<HTMLButtonElement>(".msgbox-default"))?.focus(), 0);
    const answer = (button: MessageButton) => answerCurrent(button, text.current?.value ?? "");
    const keys = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        answer(request.buttons.includes("Cancel") ? "Cancel" : request.buttons.includes("No") ? "No" : request.buttons[request.buttons.length - 1]);
        return;
      }
      if (event.key === "Enter" && event.target === text.current) { event.preventDefault(); answer(request.defaultButton); return; }
      if (event.key === "Tab" || event.key === "ArrowLeft" || event.key === "ArrowRight") {
        if (event.target === text.current && event.key !== "Tab") return;
        event.preventDefault();
        const stops = [...element.querySelectorAll<HTMLElement>("input, .msgbox-buttons button")];
        const at = stops.indexOf(document.activeElement as HTMLElement);
        const step = event.key === "ArrowLeft" || (event.key === "Tab" && event.shiftKey) ? -1 : 1;
        stops[(at + step + stops.length) % stops.length]?.focus();
        return;
      }
      if (event.target !== text.current && !event.ctrlKey && !event.metaKey && event.key.length === 1) {
        const button = request.buttons.find((candidate) => BUTTON_KEY[candidate] === event.key.toLowerCase());
        if (button) { event.preventDefault(); answer(button); }
      }
    };
    element.addEventListener("keydown", keys);
    return () => { clearTimeout(focusTimer); element.removeEventListener("keydown", keys); };
  }, [request]);

  if (!request) return null;

  return (
    <div className="msgbox-backdrop" role="presentation">
      <div ref={box} className={`msgbox msgbox-${request.kind}`} role="alertdialog" aria-modal="true" aria-labelledby={`msgbox-title-${request.id}`} aria-describedby={`msgbox-text-${request.id}`}>
        <div className="msgbox-title" id={`msgbox-title-${request.id}`}>{request.title}</div>
        <div className="msgbox-body">
          <svg className="msgbox-icon" viewBox="0 0 24 24" aria-hidden="true"><path d={ICON_PATH[request.kind]} /></svg>
          <div className="msgbox-text">
            <p id={`msgbox-text-${request.id}`}>{request.message}</p>
            {request.input && <input ref={text} key={request.id} type={request.input} aria-label={request.message} autoComplete="off" />}
          </div>
        </div>
        <div className="msgbox-buttons">
          {request.buttons.map((button) => (
            <button key={button} type="button" className={`${BUTTON_CLASS[button]} ${button === request.defaultButton ? "msgbox-default" : ""}`} onClick={() => answerCurrent(button, text.current?.value ?? "")}>
              <span><u>{button.charAt(0)}</u>{button.slice(1)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
