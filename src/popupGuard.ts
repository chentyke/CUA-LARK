import type { AgentEvent } from "./types.js";

const popupHints = [
  "If an update prompt appears, close or skip it before continuing.",
  "If a permission prompt appears, stop and report the missing permission instead of clicking unsafe choices.",
  "If a loading spinner stays for more than 10 seconds, wait once, refresh the current view if safe, then continue.",
  "If an element is not visible, use search/navigation instead of relying on fixed coordinates."
];

export class PopupGuard {
  augmentInstruction(instruction: string): string {
    return `${instruction}\n\nPopup and failure handling:\n${popupHints.map((hint) => `- ${hint}`).join("\n")}`;
  }

  inspectEvents(events: AgentEvent[]): string[] {
    const messages = events.map((event) => `${event.message} ${JSON.stringify(event.data ?? "")}`).join("\n");
    return popupHints.filter((hint) => messages.toLowerCase().includes(hint.slice(0, 16).toLowerCase()));
  }
}
