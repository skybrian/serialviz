'use strict';

const logLimit = 100;

type PortStatus = "start" | "connecting" | "reading" | "closing" | "closed" | "portGone";

export interface Log {
  key: number,
  lines: LogLine[]
}

export interface LogLine {
  key: number,
  value: string
}

export interface PortState {
  status: PortStatus;
  log: Log;
}

export class AppState extends EventTarget {
  #status = "connecting" as PortStatus;

  #log = { key: 0, lines: [] } as Log;
  #linesAdded = 0;

  constructor() {
    super();
  }

  get portState(): PortState {
    return { status: this.#status, log: this.log };
  }

  get status() {
    return this.#status;
  }

  get log(): Log {
    if (this.#log.lines.length > logLimit) {
      this.#log.lines = this.#log.lines.slice(-logLimit);
    }
    return this.#log;
  }

  canChangePort(request: PortStatus): boolean {
    switch (this.status) {
      case "start":
        return request == "connecting";
      case "connecting":
        return request == "reading" || request == "closing" || request == "portGone";
      case "reading":
        return request == "closing" || request == "portGone";
      case "closing":
        return request == "closed" || request == "portGone";
      case "closed":
        return request == "connecting" || request == "portGone";
      case "portGone":
      // terminal state
    }
    return false;
  }

  pushLog(line: string): void {
    this.#pushLog(line);
    this.#save();
  }

  #pushLog(line: string): void {
    this.#log.lines.push({ key: this.#linesAdded, value: line });
    this.#linesAdded++;
  }

  requestPortChange(request: PortStatus, options = {} as { message?: any, optional?: boolean }): boolean {
    if (!this.canChangePort(request)) {
      if (!options.optional) {
        console.log(`ignored port change: ${this.status} => ${request}`);
      }
      return false;
    }

    if (request == "connecting") {
      this.#log = { key: this.#log.key + 1, lines: [] };
      this.#linesAdded = 0;
    }

    if (options.message) {
      this.pushLog(`*** ${options.message} ***`);
    }

    this.#status = request;
    this.#save();
    return true;
  }

  fatal(message: any) {
    this.requestPortChange("portGone", { message: message });
  }

  #save() {
    this.dispatchEvent(new CustomEvent("save"));
  }
}
