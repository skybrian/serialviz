'use strict';

import { TableBuffer, Table, Row, parseRow } from './csv';

const logHeadLimit = 100;
const logTailLimit = 100;
const tableBufferLimit = 500;

export const livePlotLimit = 500;
const bottomColumnLimit = 4;

if (livePlotLimit > tableBufferLimit) {
  throw "can't plot more rows than in buffer";
}

type PortStatus = "start" | "connecting" | "reading" | "closing" | "closed" | "portGone";

export interface Log {
  key: number,
  head: LogLine[],
  tail: LogLine[]
}

export interface LogLine {
  key: number,
  value: string
}

export interface PortState {
  status: PortStatus;
  log: Log;
}

export type ColumnState = "top" | "bottom" | "hidden";

export interface PlotSettings {
  columnStates: ColumnStates;
}

export class ColumnStates {
  private states: Map<string, ColumnState>;

  constructor(states?: Map<string, ColumnState>) {
    this.states = states ?? new Map();
  }

  has = (name: string): boolean => this.states.has(name);

  get(name: string): ColumnState {
    return this.states.get(name) ?? "hidden";
  }

  get columns(): string[] {
    return [...this.states.keys()];
  }

  withColumns(tableColumns: string[]): ColumnStates {
    const newColumns = tableColumns.filter((c) => !this.has(c));
    const topColumns = this.columns.filter((c) => this.get(c) == "top");
    const bottomColumns = this.columns.filter((c) => this.get(c) == "bottom");

    if (newColumns.length == 0) return this;

    const next = new Map<string, ColumnState>();
    if (topColumns.length == 0) {
      next.set(newColumns.shift(), "top");
    }

    for (let i = 0; i < bottomColumnLimit - bottomColumns.length; i++) {
      const c = newColumns.shift();
      if (!c) break;
      next.set(c, "bottom");
    }

    while (newColumns.length > 0) {
      const c = newColumns.shift();
      next.set(c, "hidden");
    }

    for (let c of this.columns) {
      next.set(c, this.get(c));
    }

    return new ColumnStates(next);
  }

  withToggle(name: string): ColumnStates {
    const newStates = new Map(this.states);

    let toggled: ColumnState;
    switch (this.get(name)) {
      case "top": toggled = "bottom"; break;
      case "bottom": toggled = "hidden"; break;
      case "hidden": toggled = "top"; break;
    }

    newStates.set(name, toggled);
    return new ColumnStates(newStates);
  }
}

export interface AppProps {
  state: PortState;
  table: Table;
  plotSettings: PlotSettings;
  windowChanges: number;

  stop: () => void;
  restart: () => void;
  toggleColumn: (name: string) => void;
}

export interface DeviceOutput {
  deviceOpened(): boolean;
  deviceClosed(): void;
  deviceCrashed(message: any): void;
  pushDeviceOutput(line: string): void;
}

export class AppState extends EventTarget implements DeviceOutput {
  #status = "start" as PortStatus;

  #log = { key: 0, head: [], tail: [] } as Log;
  #linesAdded = 0;

  #rows = new TableBuffer(tableBufferLimit);
  #plotSettings = {columnStates: new ColumnStates()};

  #windowChanges = 0;

  constructor() {
    super();
  }

  // getters

  get props(): AppProps {
    return {
      state: { status: this.#status, log: this.#log },
      table: this.#rows.table,
      plotSettings: this.#plotSettings,
      windowChanges: this.#windowChanges,

      stop: this.requestClose,
      restart: this.requestRestart,
      toggleColumn: this.toggleColumn
    }
  }

  get status() {
    return this.#status;
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

  // device actions

  deviceOpened = (): boolean => this.requestChange("reading");

  deviceClosed(): void {
    this.requestChange("closed", { message: "Closed" });
  }

  deviceCrashed(message: any): void {
    this.requestChange("portGone", { message: message });
  }

  #saveRequested = false;

  pushDeviceOutput(line: string): void {
    this.#pushLog(line);
    const row = parseRow(line);
    if (row) {
      this.#pushRow(row);
    }
    if (!this.#saveRequested) {
      requestAnimationFrame(() => {
        this.#save();
        this.#saveRequested = false;
      });
      this.#saveRequested = true;
    }
  }

  // other actions

  pushLog(line: string): void {
    this.#pushLog(line);
    this.#save();
  }

  #pushRow(row: Row): void {
    const tableKey = this.#rows.table?.key;

    this.#rows.push(row);

    if (tableKey != this.#rows.table?.key) {
      const next = this.#plotSettings.columnStates.withColumns(this.#rows.table.columnNames);
      this.#plotSettings = {...this.#plotSettings, columnStates: next };
    }
  }

  #pushLog(line: string): void {
    const logLine = { key: this.#linesAdded, value: line };

    let  head = this.#log.head;
    if (head.length < logHeadLimit) {
      head = head.concat([logLine]);
    }

    let tail = this.#log.tail;
    if (tail.length < logTailLimit) {
      tail = tail.concat([logLine]);
    } else {
      tail = tail.slice(1).concat(logLine);
    }

    this.#log = { key: this.#log.key, head: head, tail: tail };
    this.#linesAdded++;
  }

  // other actions

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
      this.#log = { key: this.#log.key + 1, head: [], tail: [] };
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

  toggleColumn = (name: string): void => {
    const toggled = this.#plotSettings.columnStates.withToggle(name);
    this.#plotSettings = { columnStates:  toggled };
    this.#save();
  }

  windowChanged(): void {
    this.#windowChanges++;
    this.#save();
  }

  #save(): void {
    this.dispatchEvent(new CustomEvent("save"));
  }
}
