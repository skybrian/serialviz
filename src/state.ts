'use strict';

import { TableBuffer, Table, Row } from './csv';

const logLimit = 100;
const lineBufferSize = 500;

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
  #status = "start" as PortStatus;

  #log = { key: 0, lines: [] } as Log;
  #linesAdded = 0;

  #rows = new TableBuffer(lineBufferSize);

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

  get table(): Table {
    return this.#rows.table;
  }

  canChangeTo(request: PortStatus): boolean {
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

  requestClose = (): boolean => this.requestChange("closed", { optional: true }) || this.requestChange("closing");

  requestRestart = (): boolean => this.requestChange("connecting");

  requestChange(wanted: PortStatus, options = {} as { message?: any, optional?: boolean }): boolean {
    if (!this.canChangeTo(wanted)) {
      if (!options.optional) {
        console.log(`ignored port change: ${this.status} => ${wanted}`);
      }
      return false;
    }

    if (wanted == "connecting") {
      this.#log = { key: this.#log.key + 1, lines: [] };
      this.#linesAdded = 0;
      this.#rows.clear();
    }

    if (options.message) {
      this.pushLog(`*** ${options.message} ***`);
    }

    this.#status = wanted;
    this.dispatchEvent(new CustomEvent("status"));
    this.#save();
    return true;
  }

  pushRow(row: Row): void {
    this.#rows.push(row);
  }

  fatal(message: any): void {
    this.requestChange("portGone", { message: message });
  }

  #save(): void {
    this.dispatchEvent(new CustomEvent("save"));
  }
}
